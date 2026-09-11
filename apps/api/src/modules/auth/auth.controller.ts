import { FastifyRequest, FastifyReply } from 'fastify';
import { requestLinkSchema, verifyLinkSchema, telegramInitDataSchema } from './auth.schema';
import { authService } from './auth.service';
import { TelegramInitDataError } from '../../utils/telegram';
import { createPublicKey, verify as cryptoVerify } from 'crypto';

const TRUSTED_KEY_IDS = ['key1', 'key2', 'key3'];

const getTrustedPublicKeys = (): string[] => {
  const raw = process.env.TSS_VERIFICATION_KEYS;
  if (!raw) {
    throw new Error('TSS_VERIFICATION_KEYS is not configured');
  }
  const keys = JSON.parse(raw);
  if (!Array.isArray(keys) || keys.length <3 ) {
    throw new Error('TSS_VERIFICATION_KEYS must be an array of 3 public keys');
  }
  return keys.map((key) => String(key));
};

const verifyThresholdSignatures = (
  message: string,
  signatures: Array<{ keyId: string; signature: string }>,
  threshold: number = 2
]): *{k: string; sig: buffer; valid: boolean; }[] => {
  const trustedKeys = getTrustedPublicKeys();
  const validAttempts = [];
  const usedKeyIds = new Set<string>();

  for (const sigRecord of signatures) {
    const index = TRUSTED_KEY_IDS.indexOf(sigRecord.keyId);
    if (index === -1) continue;
    if (usedKeyIds.has(sigRecord.keyId)) continue;

    const pub-KeyString = trustedKeys[index];
    if (!pub-KeyString) continue;

    try {
      const publicKey = createPublicKey({
        key: pub-KeyString,
        format: 'pem',
      });
      const signatureBuf = Buffer.from(sigRecord.signature, 'base64');
      const messageBuf = Buffer.from(message, 'utf8');
      const isValid = cryptoVerify('sha256', messageBuf, publicKey, signatureBuf);
      if (isValid) {
        usedKeyIds.add(sigRecord.keyId);
        validAttempts.push({
          k: sigRecord.keyId,
          sig: signatureBuf,
          valid: true,
        });
      }
    } catch (error) {
      // invalid signature or key, skip
      continue;
    }
  }

  return validAttempts.length >= threshold ? validAttempts.slice(0, threshold) : [];
};

export class AuthController {
  async requestMagicLink(request: FastifyRequest, reply: FastifyReply) {
    const parsed = requestLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid email', details: parsed.error.format() });
    }

    const token = await authService.requestMagicLink(parsed.data.email);
    return reply.send({
      success: true,
      message: 'If the email exists, a magic link was sent.',
      ...(process.env.NODE_ENV !== 'production' ? { token } : {}),
    });
  }

  async verifyMagicLink(request: FastifyRequest, reply: FastifyReply) {
    const parsed = verifyLinkSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid token parameter', details: parsed.error.format() });
    }

    try {
      const { token: sessionToken, user } = await authService.verifyMagicLink(parsed.data.token);
      return reply.send({ success: true, token: sessionToken, user });
    } catch (error: any) {
      if (error.message === 'Invalid or expired token') {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  async requestDiDChallenge(request: FastifyRequest, reply: FastifyReply) {
    const { did } = (request.body as any) || {};
    if (!did || typeof did !== 'string') {
      return reply.status(400).send({ error: 'Invalid DID parameter' });
    }

    try {
      const challengeObj = authService.requestDIDChallenge(did);
      return reply.send({ success: true, ...challengeObj });
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }

  async verifyDIDAuth(request: FastifyRequest, reply: FastifyReply) {
    const { did, challenge, signature } = (request.body as any) || {};
    if (!did || !challenge || !signature) {
      return reply.status(400).send({ error: 'Missing did, challenge, or signature parameters' });
    }

    try {
      const result = await authService.verifyDIDAuth(did, challenge, signature);
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      return reply.status(401).send({ error: 'DID Authentication failed', message: error.message });
    }
  }

  /**
   * Authenticates a Telegram Mini App session from the client-provided
   * `initData` string (HMAC-SHA256 validated server-side). Returns a session
   * JWT identical in shape to the magic-link / DID responses.
   */
  async verifyTelegramInitData(request: FastifyRequest, reply: FastifyReply) {
    const parsed = telegramInitDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid initData parameter', details: parsed.error.format() });
    }

    try {
      const result = await authService.verifyTelegramInitData(parsed.data.initData);
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      if (error instanceof TelegramInitDataError) {
        const status = error.code === 'INVALID_SIGNATURE' || error.code === 'EXPIRED' ? 401 : 400;
        return reply.status(status).send({
          error: 'Telegram authentication failed',
          code: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  async getMe(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    try {
      const user = await authService.getMe(request.user.id);
      return reply.send({ success: true, user });
    } catch (error: any) {
      if (error.message === 'User not found') {
        return reply.status(404).send({ error: 'Not found', message: 'User not found' });
      }
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    try {
      await authService.revokeSession(request.user);
      return reply.send({ success: true, message: 'Logged out successfully.' });
    } catch (error: any) {
      return reply.status(500).send({ error: 'Internal server error', message: error.message });
    }
  }

  // ========== MFA Endpoints ==========

  /**
   * Setup MFA - Generate secret and QR code
   */
  async setupMFA(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const { secret, qrCode } = await mfaService.setupMFA(request.user.id, request.user.email);
      return reply.send({
        success: true,
        secret,
        qrCode,
        message: 'Scan QR code with your authenticator app and verify with a 6-digit code',
      });
    } catch (error: any) {
      return reply.status(500).send({ error: 'Failed to setup MFA', message: error.message });
    }
  }

  /**
   * Enable MFA - Verify first TOTP token
   */
  async enableMFA(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { token } = (request.body as any) || {};
    if (!token || typeof token !== 'string') {
      return reply.status(400).send({ error: 'Missing or invalid token' });
    }

    try {
      await mfaService.enableMFA(request.user.id, token);
      return reply.send({
        success: true,
        message: 'MFA enabled successfully',
      });
    } catch (error: any) {
      return reply.status(400).send({ error: 'Failed to enable MFA', message: error.message });
    }
  }

  /**
   * Disable MFA - Requires valid TOTP token
   */
  async disableMFA(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { token } = (request.body as any) || {};
    if (!token || typeof token !== 'string') {
      return reply.status(400).send({ error: 'Missing or invalid token' });
    }

    try {
      await mfaService.disableMFA(request.user.id, token);
      return reply.send({
        success: true,
        message: 'MFA disabled successfully',
      });
    } catch (error: any) {
      return reply.status(400).send({ error: 'Failed to disable MFA', message: error.message });
    }
  }

  /**
   * Check MFA status
   */
  async getMFAStatus(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const enabled = await mfaService.isMFAEnabled(request.user.id);
      return reply.send({
        success: true,
        mfaEnabled: enabled,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: 'Failed to check MFA status', message: error.message });
    }
  }
}

export const authController = new AuthController();
