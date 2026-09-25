import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import {
  generateMagicToken,
  generateSessionToken,
  verifyToken,
  MagicLinkPayload,
  UserPayload,
} from '../../utils/jwt';
import { revokeToken } from '../../lib/tokenBlocklist';
import {
  createSessionFamily,
  rotateRefreshToken,
  revokeFamily,
  SessionTokenResult,
  RotationContext,
} from '../../lib/session-manager';
import {
  parseDID,
  generateDIDChallenge,
  verifyDIDSignature,
  isDIDChallengeExpired,
  DIDChallenge,
} from '../../utils/did';
import {
  validateTelegramInitData,
  TelegramInitDataError,
  TelegramUser,
} from '../../utils/telegram';
import jwt from 'jsonwebtoken';
import { redis } from '../../lib/redis';

const DID_CHALLENGE_TTL_SECONDS = 5 * 60;
// In-memory fallback when Redis is unavailable (degraded mode)
const degradedAuthStore = new Map<string, { value: string; expiresAt: number }>();

export interface AuthSessionResponse {
  token: string;
  accessToken: string;
  refreshToken: string;
  familyId: string;
  expiresIn: number;
  user: { id: string; email: string; did?: string };
  telegram?: TelegramUser;
}

export class AuthService {
  /**
   * Helper to issue a full token pair (access + rotating refresh token)
   * bound to a session family (#315).
   */
  async issueSession(userId: string, email: string): Promise<SessionTokenResult> {
    try {
      if (prisma.refreshSession && typeof prisma.$transaction === 'function') {
        return await createSessionFamily({ userId, email });
      }
    } catch (err: any) {
      console.warn(`[AuthService] Session family creation fallback: ${err.message}`);
    }
    const token = generateSessionToken({ id: userId, email });
    return {
      accessToken: token,
      refreshToken: token,
      familyId: 'legacy',
      expiresIn: 900,
      tokenType: 'Bearer',
    };
  }

  async requestMagicLink(email: string): Promise<string> {
    const token = generateMagicToken(email);
    const decoded = jwt.decode(token) as MagicLinkPayload;
    if (decoded && decoded.jti) {
      try {
        await redis.set(`magic_token:${decoded.jti}`, 'valid', 'EX', 15 * 60);
      } catch (err: any) {
        console.warn(`[AuthService] Redis magic token cache skipped: ${err?.message}`);
      }
    }
    console.log(`[AuthService] ✉️ Magic link generated: http://localhost:3000/verify?token=${token}`);
    return token;
  }

  async verifyMagicLink(token: string): Promise<AuthSessionResponse> {
    let decoded: MagicLinkPayload;
    try {
      decoded = verifyToken<MagicLinkPayload>(token);
    } catch (err: any) {
      console.error('[AuthService] Token verification failed:', err.message);
      throw new Error('Invalid or expired token');
    }

    if (!decoded || !decoded.email || !decoded.jti) {
      console.error('[AuthService] Token payload missing email or jti:', decoded);
      throw new Error('Invalid or expired token');
    }

    const redisKey = `magic_token:${decoded.jti}`;
    let tokenStatus: string | null = 'valid';
    try {
      tokenStatus = await redis.get(redisKey);
    } catch {
      // Redis offline: proceed with verification in test/dev
    }

    if (!tokenStatus) {
      console.error('[AuthService] Token already used or expired (jti not found in Redis):', decoded.jti);
      throw new Error('Invalid or expired token');
    }

    try {
      await redis.del(redisKey);
    } catch {}

    try {
      const user = await prisma.user.upsert({
        where: { email: decoded.email },
        update: {},
        create: { email: decoded.email },
      });

      const session = await this.issueSession(user.id, user.email);

      console.log(`[AuthService] Magic link verified for: ${decoded.email}`);
      return {
        token: session.accessToken,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        familyId: session.familyId,
        expiresIn: session.expiresIn,
        user: { id: user.id, email: user.email },
      };
    } catch (dbError: any) {
      console.error('[AuthService] Database error during magic link verification:', dbError);
      throw dbError;
    }
  }

  /**
   * Generates a signed challenge for W3C Decentralized Identity (DID)
   * authentication. The issued challenge is persisted in Redis under a 5
   * minute TTL so `verifyDIDAuth` can enforce that only the exact challenge we
   * issued — and an unexpired one — can complete sign-in (#270). Each DID can
   * hold at most one outstanding challenge; requesting a new one invalidates
   * the previous.
   */
  async requestDIDChallenge(did: string): Promise<DIDChallenge> {
    const challenge = generateDIDChallenge(did);
    try {
      await redis.set(
        `did:challenge:${did}`,
        challenge.challenge,
        'EX',
        Math.ceil(DID_CHALLENGE_TTL_SECONDS),
      );
    } catch (err: any) {
      console.warn(`[AuthService] Redis challenge cache skipped: ${err?.message}`);
    }
    console.log(`[AuthService] 🆔 Requesting DID challenge for: ${did}`);
    return challenge;
  }

  /**
   * Verifies signed DID challenge payload and issues a valid session JWT bound
   * to the DID user identity. The challenge must be the exact unexpired one
   * issued by `requestDIDChallenge` (Redis-backed, single use) before the
   * wallet signature is checked — a stale, replayed, or never-issued challenge
   * is rejected up front.
   */
  async verifyDIDAuth(
    did: string,
    challenge: string,
    signature: string
  ): Promise<AuthSessionResponse> {
    const challengeKey = `did:challenge:${did}`;
    let storedChallenge: string | null = null;
    try {
      storedChallenge = await redis.get(challengeKey);
    } catch {}

    if (!storedChallenge) {
      throw new Error('DID challenge expired or not requested');
    }
    if (storedChallenge !== challenge) {
      throw new Error('DID challenge does not match the one that was issued');
    }
    if (isDIDChallengeExpired(challenge)) {
      try {
        await redis.del(challengeKey);
      } catch {}
      throw new Error('DID challenge expired or not requested');
    }

    const parsed = parseDID(did);
    const isValid = verifyDIDSignature(did, challenge, signature);

    if (!isValid) {
      console.error(`[AuthService] ❌ DID signature verification failed for ${did}`);
      throw new Error('Invalid DID challenge signature');
    }

    try {
      await redis.del(challengeKey);
    } catch {}

    const syntheticEmail = `${parsed.address.toLowerCase().substring(0, 20)}@did.stellar-alerts.org`;

    const user = await prisma.user.upsert({
      where: { email: syntheticEmail },
      update: {},
      create: { email: syntheticEmail },
    });

    const session = await this.issueSession(user.id, user.email);

    console.log(`[AuthService] 🔑 DID Authentication successful for ${did}. Session JWT issued.`);
    return {
      token: session.accessToken,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      familyId: session.familyId,
      expiresIn: session.expiresIn,
      user: {
        id: user.id,
        email: user.email,
        did,
      },
    };
  }

  /**
   * Authenticates a Telegram Mini App user from the signed `initData` string
   * handed to the web app by the Telegram client. The HMAC-SHA256 signature is
   * verified against TELEGRAM_BOT_TOKEN before a session JWT is issued, bound to
   * the Telegram user id via a synthetic email (mirrors the DID auth flow).
   */
  async verifyTelegramInitData(
    initData: string,
  ): Promise<AuthSessionResponse & { telegram: TelegramUser }> {
    let data;
    try {
      data = validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
    } catch (err) {
      if (err instanceof TelegramInitDataError) throw err;
      throw new TelegramInitDataError('MALFORMED', (err as Error).message);
    }

    if (!data.user?.id) {
      throw new TelegramInitDataError('MALFORMED', 'initData did not contain a Telegram user');
    }

    const syntheticEmail = `tg_${data.user.id}@telegram.stellar-alerts.org`;
    const user = await prisma.user.upsert({
      where: { email: syntheticEmail },
      update: {},
      create: { email: syntheticEmail },
    });

    const session = await this.issueSession(user.id, user.email);
    console.log(`[AuthService] 📲 Telegram Mini App auth OK for tg user ${data.user.id}. Session JWT issued.`);

    return {
      token: session.accessToken,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      familyId: session.familyId,
      expiresIn: session.expiresIn,
      user: { id: user.id, email: user.email },
      telegram: data.user,
    };
  }

  /**
   * Rotates a refresh token, issuing a new short-lived access token and a new
   * rotating refresh token while detecting and halting token reuse (#315).
   */
  async rotateRefreshToken(
    refreshToken: string,
    context?: RotationContext
  ): Promise<SessionTokenResult> {
    return rotateRefreshToken(refreshToken, context);
  }

  /**
   * Revokes an active session family and blocklists individual token JTI.
   */
  async revokeSession(user: UserPayload): Promise<void> {
    if (user.familyId && user.familyId !== 'legacy') {
      try {
        await revokeFamily(user.familyId, 'USER_LOGOUT');
      } catch (err: any) {
        console.warn(`[AuthService] Revoke family error: ${err?.message}`);
      }
    }
    if (user.jti && user.exp) {
      await revokeToken(user.jti, user.exp);
    }
    console.log(`[AuthService] 🔓 Session revoked for user ${user.id}`);
  }

  /**
   * Explicitly revokes a session family by ID.
   */
  async revokeSessionFamily(familyId: string, reason = 'USER_REVOKED_FAMILY'): Promise<void> {
    await revokeFamily(familyId, reason);
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: true,
        notifyPrefs: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }
}

export const authService = new AuthService();
