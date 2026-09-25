import crypto from 'crypto';
import { prisma } from './prisma';
import { redis } from './redis';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  RefreshTokenPayload,
} from '../utils/jwt';

export class TokenReuseError extends Error {
  readonly code = 'TOKEN_REUSE_DETECTED';
  readonly statusCode = 401;

  constructor(message = 'Refresh token reuse detected. Session family has been revoked.') {
    super(message);
    this.name = 'TokenReuseError';
  }
}

export class SessionRevokedError extends Error {
  readonly code = 'SESSION_REVOKED';
  readonly statusCode = 401;

  constructor(message = 'Session has been revoked. Please sign in again.') {
    super(message);
    this.name = 'SessionRevokedError';
  }
}

export interface SessionTokenResult {
  accessToken: string;
  refreshToken: string;
  familyId: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface RotationContext {
  ip?: string;
  userAgent?: string;
}

const REDIS_FAMILY_PREFIX = 'auth:family:';
const REDIS_REUSED_PREFIX = 'auth:refresh_jti_used:';

/**
 * Initiates a new session family for a user upon successful authentication
 * (magic link, DID auth, Telegram Mini App).
 */
export async function createSessionFamily(params: {
  userId: string;
  email: string;
}): Promise<SessionTokenResult> {
  const familyId = crypto.randomUUID();
  const rotationCounter = 1;
  const { token: refreshToken, jti } = generateRefreshToken({
    userId: params.userId,
    familyId,
    rotationCounter,
  });

  const accessToken = generateAccessToken({
    id: params.userId,
    email: params.email,
    familyId,
  });

  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  // Store in database
  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.create({
      data: {
        familyId,
        userId: params.userId,
        currentJti: jti,
        rotationCounter,
        isRevoked: false,
        expiresAt,
      },
    });

    await tx.refreshTokenHistory.create({
      data: {
        familyId,
        jti,
        userId: params.userId,
        rotationCounter,
        isConsumed: false,
      },
    });
  });

  // Cache active session in Redis for sub-millisecond lookup
  try {
    await redis.set(
      `${REDIS_FAMILY_PREFIX}${familyId}:current_jti`,
      jti,
      'EX',
      REFRESH_TOKEN_TTL_SECONDS
    );
  } catch (err: any) {
    console.warn(`[SessionManager] Redis caching skipped: ${err?.message}`);
  }

  return {
    accessToken,
    refreshToken,
    familyId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    tokenType: 'Bearer',
  };
}

/**
 * Rotates a refresh token:
 * 1. Validates cryptographic signature and expiration.
 * 2. Checks if the session family has already been revoked.
 * 3. Inspects token history for reuse:
 *    - If reuse detected: immediately revokes the entire session family,
 *      logs a critical SecurityAuditLog entry, logs a replay alert, and throws TokenReuseError.
 *    - If valid: marks token consumed, issues a new rotating refresh token and access token.
 */
export async function rotateRefreshToken(
  refreshTokenString: string,
  context?: RotationContext
): Promise<SessionTokenResult> {
  let decoded: RefreshTokenPayload;
  try {
    decoded = verifyRefreshToken(refreshTokenString);
  } catch (err: any) {
    throw new Error('Invalid or expired refresh token');
  }

  const { familyId, userId, jti, rotationCounter } = decoded;

  // 1. Check family revocation status
  const revoked = await isFamilyRevoked(familyId);
  if (revoked) {
    throw new SessionRevokedError();
  }

  // 2. Fetch session and token history from DB
  const session = await prisma.refreshSession.findUnique({
    where: { familyId },
  });

  if (!session || session.isRevoked) {
    throw new SessionRevokedError();
  }

  const tokenRecord = await prisma.refreshTokenHistory.findUnique({
    where: { jti },
  });

  // 3. REUSE DETECTION:
  // If the presented token has already been marked as consumed, OR if the session's
  // current active JTI does not match this token's JTI, a replay/reuse attack occurred!
  const isAlreadyConsumed = tokenRecord?.isConsumed ?? false;
  const isOutdatedJti = session.currentJti !== jti;

  if (isAlreadyConsumed || isOutdatedJti) {
    console.error(
      `[SecurityAlert] 🚨 Refresh token reuse detected for family ${familyId}, user ${userId}. Immediate session family revocation!`
    );

    // Atomically revoke the entire session family
    await revokeFamily(familyId, 'REPLAY_ATTACK_DETECTED');

    // Persist critical security audit event
    try {
      await prisma.securityAuditLog.create({
        data: {
          eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
          severity: 'CRITICAL',
          details: {
            familyId,
            userId,
            replayedJti: jti,
            presentedCounter: rotationCounter,
            expectedCurrentJti: session.currentJti,
            isAlreadyConsumed,
            isOutdatedJti,
            ip: context?.ip,
            userAgent: context?.userAgent,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (auditErr: any) {
      console.error('[SessionManager] Failed to record SecurityAuditLog:', auditErr.message);
    }

    throw new TokenReuseError();
  }

  // 4. VALID ROTATION:
  // Advance rotation counter, issue new refresh token and access token
  const nextCounter = session.rotationCounter + 1;
  const { token: newRefreshToken, jti: newJti } = generateRefreshToken({
    userId,
    familyId,
    rotationCounter: nextCounter,
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const email = user?.email ?? '';
  const newAccessToken = generateAccessToken({
    id: userId,
    email,
    familyId,
  });

  // Update database transactionally
  await prisma.$transaction(async (tx) => {
    // Mark previous JTI as consumed
    await tx.refreshTokenHistory.update({
      where: { jti },
      data: {
        isConsumed: true,
        consumedAt: new Date(),
      },
    });

    // Register new JTI
    await tx.refreshTokenHistory.create({
      data: {
        familyId,
        jti: newJti,
        userId,
        rotationCounter: nextCounter,
        isConsumed: false,
      },
    });

    // Advance session active JTI and counter
    await tx.refreshSession.update({
      where: { familyId },
      data: {
        currentJti: newJti,
        rotationCounter: nextCounter,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
  });

  // Update Redis cache
  try {
    await redis.set(
      `${REDIS_REUSED_PREFIX}${jti}`,
      '1',
      'EX',
      REFRESH_TOKEN_TTL_SECONDS
    );
    await redis.set(
      `${REDIS_FAMILY_PREFIX}${familyId}:current_jti`,
      newJti,
      'EX',
      REFRESH_TOKEN_TTL_SECONDS
    );
  } catch (err: any) {
    console.warn(`[SessionManager] Redis rotation cache skipped: ${err?.message}`);
  }

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    familyId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    tokenType: 'Bearer',
  };
}

/**
 * Revokes a session family immediately (all access and refresh tokens bound to familyId).
 */
export async function revokeFamily(
  familyId: string,
  reason = 'USER_LOGOUT'
): Promise<void> {
  // Update DB
  await prisma.refreshSession.updateMany({
    where: { familyId },
    data: {
      isRevoked: true,
      revocationReason: reason,
    },
  });

  // Cache revocation in Redis
  try {
    await redis.set(
      `${REDIS_FAMILY_PREFIX}${familyId}:revoked`,
      '1',
      'EX',
      REFRESH_TOKEN_TTL_SECONDS
    );
  } catch (err: any) {
    console.warn(`[SessionManager] Redis family revocation cache skipped: ${err?.message}`);
  }
}

/**
 * Checks whether a given session family has been revoked.
 */
export async function isFamilyRevoked(familyId?: string): Promise<boolean> {
  if (!familyId) return false;

  try {
    const cached = await redis.get(`${REDIS_FAMILY_PREFIX}${familyId}:revoked`);
    if (cached === '1') return true;
  } catch {
    // Failover to DB check
  }

  const session = await prisma.refreshSession.findUnique({
    where: { familyId },
    select: { isRevoked: true },
  });

  return session ? session.isRevoked : false;
}
