import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSessionFamily,
  rotateRefreshToken,
  revokeFamily,
  isFamilyRevoked,
  TokenReuseError,
  SessionRevokedError,
} from '../../../lib/session-manager';
import {
  generateRefreshToken,
  generateAccessToken,
  verifyToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../../../utils/jwt';

const mockRedisStore = new Map<string, string>();

const mockRedis = vi.hoisted(() => ({
  set: vi.fn(async (key: string, val: string) => {
    mockRedisStore.set(key, val);
    return 'OK';
  }),
  get: vi.fn(async (key: string) => {
    return mockRedisStore.get(key) ?? null;
  }),
  del: vi.fn(async (key: string) => {
    mockRedisStore.delete(key);
    return 1;
  }),
}));

vi.mock('../../../config/env', () => ({
  env: {
    JWT_SECRET: 'test-super-secret-jwt-key-rotation-32-chars!!',
  },
}));

// In-memory mock database state
let mockRefreshSessions: any[] = [];
let mockTokenHistories: any[] = [];
let mockAuditLogs: any[] = [];
const mockUsers = [
  { id: 'user_1', email: 'alice@stellar.org' },
  { id: 'user_2', email: 'bob@stellar.org' },
];

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (cb) => {
      const tx = {
        refreshSession: {
          create: vi.fn(async ({ data }) => {
            const row = { id: `rs_${Date.now()}`, ...data };
            mockRefreshSessions.push(row);
            return row;
          }),
          update: vi.fn(async ({ where, data }) => {
            const index = mockRefreshSessions.findIndex((s) => s.familyId === where.familyId);
            if (index !== -1) {
              mockRefreshSessions[index] = { ...mockRefreshSessions[index], ...data };
              return mockRefreshSessions[index];
            }
            return null;
          }),
        },
        refreshTokenHistory: {
          create: vi.fn(async ({ data }) => {
            const row = { id: `th_${Date.now()}`, ...data };
            mockTokenHistories.push(row);
            return row;
          }),
          update: vi.fn(async ({ where, data }) => {
            const index = mockTokenHistories.findIndex((h) => h.jti === where.jti);
            if (index !== -1) {
              mockTokenHistories[index] = { ...mockTokenHistories[index], ...data };
              return mockTokenHistories[index];
            }
            return null;
          }),
        },
      };
      return cb(tx);
    }),
    refreshSession: {
      findUnique: vi.fn(async ({ where }) => {
        return mockRefreshSessions.find((s) => s.familyId === where.familyId) || null;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0;
        mockRefreshSessions = mockRefreshSessions.map((s) => {
          if (s.familyId === where.familyId) {
            count++;
            return { ...s, ...data };
          }
          return s;
        });
        return { count };
      }),
    },
    refreshTokenHistory: {
      findUnique: vi.fn(async ({ where }) => {
        return mockTokenHistories.find((h) => h.jti === where.jti) || null;
      }),
    },
    securityAuditLog: {
      create: vi.fn(async ({ data }) => {
        const row = { id: `audit_${Date.now()}`, ...data, createdAt: new Date() };
        mockAuditLogs.push(row);
        return row;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }) => {
        return mockUsers.find((u) => u.id === where.id) || null;
      }),
    },
  },
}));

vi.mock('../../../lib/redis', () => ({
  redis: mockRedis,
}));

describe('Access-Token Rotation and Refresh-Token Reuse Detection (#315)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
    mockRefreshSessions = [];
    mockTokenHistories = [];
    mockAuditLogs = [];
  });

  describe('Session Family Creation', () => {
    it('creates a session family with short-lived access token and 7d refresh token', async () => {
      const session = await createSessionFamily({
        userId: 'user_1',
        email: 'alice@stellar.org',
      });

      expect(session.accessToken).toBeDefined();
      expect(session.refreshToken).toBeDefined();
      expect(session.familyId).toBeDefined();
      expect(session.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
      expect(session.tokenType).toBe('Bearer');

      // Verify access token claims
      const accessDecoded = verifyToken<any>(session.accessToken);
      expect(accessDecoded.id).toBe('user_1');
      expect(accessDecoded.email).toBe('alice@stellar.org');
      expect(accessDecoded.familyId).toBe(session.familyId);

      // Verify DB records
      expect(mockRefreshSessions).toHaveLength(1);
      expect(mockRefreshSessions[0].familyId).toBe(session.familyId);
      expect(mockRefreshSessions[0].rotationCounter).toBe(1);
      expect(mockRefreshSessions[0].isRevoked).toBe(false);

      expect(mockTokenHistories).toHaveLength(1);
      expect(mockTokenHistories[0].familyId).toBe(session.familyId);
      expect(mockTokenHistories[0].rotationCounter).toBe(1);
      expect(mockTokenHistories[0].isConsumed).toBe(false);

      // Verify Redis cache
      const cachedJti = mockRedisStore.get(`auth:family:${session.familyId}:current_jti`);
      expect(cachedJti).toBe(mockRefreshSessions[0].currentJti);
    });
  });

  describe('Refresh Token Rotation (Happy Path)', () => {
    it('rotates refresh token, increments counter, consumes old JTI, and issues new token pair', async () => {
      const initial = await createSessionFamily({
        userId: 'user_1',
        email: 'alice@stellar.org',
      });

      const rotated = await rotateRefreshToken(initial.refreshToken, {
        ip: '127.0.0.1',
        userAgent: 'VitestAgent/1.0',
      });

      expect(rotated.familyId).toBe(initial.familyId);
      expect(rotated.accessToken).not.toBe(initial.accessToken);
      expect(rotated.refreshToken).not.toBe(initial.refreshToken);

      // Verify database updates
      const session = mockRefreshSessions.find((s) => s.familyId === initial.familyId);
      expect(session.rotationCounter).toBe(2);

      // Old token must be marked as consumed
      const oldHistory = mockTokenHistories.find((h) => h.rotationCounter === 1);
      expect(oldHistory.isConsumed).toBe(true);
      expect(oldHistory.consumedAt).toBeInstanceOf(Date);

      // New token must be recorded as unconsumed
      const newHistory = mockTokenHistories.find((h) => h.rotationCounter === 2);
      expect(newHistory.isConsumed).toBe(false);
      expect(session.currentJti).toBe(newHistory.jti);

      // Redis must have updated active JTI
      expect(mockRedisStore.get(`auth:family:${initial.familyId}:current_jti`)).toBe(newHistory.jti);
      expect(mockRedisStore.get(`auth:refresh_jti_used:${oldHistory.jti}`)).toBe('1');
    });

    it('supports multiple sequential rotations in the same session family', async () => {
      let current = await createSessionFamily({
        userId: 'user_1',
        email: 'alice@stellar.org',
      });

      for (let i = 2; i <= 5; i++) {
        current = await rotateRefreshToken(current.refreshToken);
        const session = mockRefreshSessions.find((s) => s.familyId === current.familyId);
        expect(session.rotationCounter).toBe(i);
      }

      // Check all 4 previous tokens are consumed and the 5th is active
      const consumed = mockTokenHistories.filter((h) => h.isConsumed);
      expect(consumed).toHaveLength(4);

      const active = mockTokenHistories.find((h) => !h.isConsumed);
      expect(active.rotationCounter).toBe(5);
    });
  });

  describe('Refresh Token Reuse Detection (Replay Attacks)', () => {
    it('detects replay of an already consumed refresh token and revokes entire family', async () => {
      // 1. Initial login (Token 1)
      const initial = await createSessionFamily({
        userId: 'user_1',
        email: 'alice@stellar.org',
      });
      const token1 = initial.refreshToken;

      // 2. Legitimate user rotates Token 1 -> receives Token 2
      const rotation1 = await rotateRefreshToken(token1);
      expect(rotation1.refreshToken).toBeDefined();

      // 3. Attacker replays Token 1!
      await expect(
        rotateRefreshToken(token1, {
          ip: '198.51.100.42',
          userAgent: 'MaliciousBrowser/2.0',
        })
      ).rejects.toThrow(TokenReuseError);

      // 4. Session family must be immediately and permanently revoked
      const session = mockRefreshSessions.find((s) => s.familyId === initial.familyId);
      expect(session.isRevoked).toBe(true);
      expect(session.revocationReason).toBe('REPLAY_ATTACK_DETECTED');

      // Redis cache must reflect family revocation
      expect(mockRedisStore.get(`auth:family:${initial.familyId}:revoked`)).toBe('1');

      // 5. Critical security audit log entry must be created
      expect(mockAuditLogs).toHaveLength(1);
      expect(mockAuditLogs[0].eventType).toBe('REFRESH_TOKEN_REUSE_DETECTED');
      expect(mockAuditLogs[0].severity).toBe('CRITICAL');
      expect(mockAuditLogs[0].details.familyId).toBe(initial.familyId);
      expect(mockAuditLogs[0].details.userId).toBe('user_1');
      expect(mockAuditLogs[0].details.ip).toBe('198.51.100.42');

      // 6. Legitimate user trying to rotate Token 2 is now ALSO rejected because family is revoked
      await expect(rotateRefreshToken(rotation1.refreshToken)).rejects.toThrow(
        SessionRevokedError
      );
    });

    it('rejects an outdated JTI that does not match current active JTI', async () => {
      const initial = await createSessionFamily({
        userId: 'user_1',
        email: 'alice@stellar.org',
      });

      // Craft an unconsumed token with mismatched JTI
      const forgedRefresh = generateRefreshToken({
        userId: 'user_1',
        familyId: initial.familyId,
        rotationCounter: 1,
      });

      await expect(rotateRefreshToken(forgedRefresh.token)).rejects.toThrow(TokenReuseError);

      const session = mockRefreshSessions.find((s) => s.familyId === initial.familyId);
      expect(session.isRevoked).toBe(true);
      expect(session.revocationReason).toBe('REPLAY_ATTACK_DETECTED');
    });
  });

  describe('Session Family Revocation & Middleware Checks', () => {
    it('revokes session family and halts subsequent rotations', async () => {
      const session = await createSessionFamily({
        userId: 'user_2',
        email: 'bob@stellar.org',
      });

      await revokeFamily(session.familyId, 'USER_LOGOUT');

      expect(await isFamilyRevoked(session.familyId)).toBe(true);

      await expect(rotateRefreshToken(session.refreshToken)).rejects.toThrow(
        SessionRevokedError
      );
    });

    it('rejects malformed or tampered refresh tokens', async () => {
      await expect(rotateRefreshToken('invalid.jwt.token')).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });
  });
});
