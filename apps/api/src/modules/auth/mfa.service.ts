/**
 * MFA Service
 * 
 * Handles Multi-Factor Authentication setup, verification, and
 * secure one-time recovery codes enrollment and account recovery (#317).
 */

import { prisma } from '../../lib/prisma';
import { generateTOTPSecret, generateTOTPQRCode, verifyTOTPToken } from '../../utils/totp';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCodeHash,
  normalizeRecoveryCode,
} from '../../utils/recovery-codes';
import { generateSessionToken } from '../../utils/jwt';

export interface MFASetupResponse {
  secret: string;
  qrCode: string; // Data URL
}

export interface MFAEnableResponse {
  enabled: boolean;
  recoveryCodes: string[];
}

interface RecoveryRateLimit {
  attempts: number;
  firstAttemptAt: number;
}

// In-memory rate limiter: max 3 attempts per 15 minutes
const recoveryRateLimits = new Map<string, RecoveryRateLimit>();
const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

export class MFAService {
  /**
   * Setup MFA for a user - generates secret and QR code.
   */
  async setupMFA(userId: string, email: string): Promise<MFASetupResponse> {
    const secret = generateTOTPSecret();

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecret: secret,
        mfaEnabled: false,
      },
    });

    const qrCode = await generateTOTPQRCode(email, secret);

    console.log(`[MFAService] 🔐 MFA setup initiated for user ${userId}`);
    
    return {
      secret,
      qrCode,
    };
  }

  /**
   * Enable MFA after user successfully scans QR and verifies first token.
   * Also generates one-time recovery codes for account recovery (#317).
   */
  async enableMFA(userId: string, token: string): Promise<MFAEnableResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaSecret) {
      throw new Error('MFA not set up. Please setup MFA first.');
    }

    if (user.mfaEnabled) {
      throw new Error('MFA already enabled');
    }

    const isValid = verifyTOTPToken(token, user.mfaSecret);

    if (!isValid) {
      console.error(`[MFAService] ❌ Invalid token during MFA enable for user ${userId}`);
      throw new Error('Invalid TOTP token');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    // Auto-generate initial recovery codes
    const recoveryCodes = await this.generateRecoveryCodes(userId);

    console.log(`[MFAService] ✅ MFA enabled for user ${userId} with recovery codes`);
    
    return {
      enabled: true,
      recoveryCodes,
    };
  }

  /**
   * Disable MFA for a user (requires valid TOTP token or administrative recovery).
   */
  async disableMFA(userId: string, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new Error('MFA not enabled');
    }

    const isValid = verifyTOTPToken(token, user.mfaSecret);

    if (!isValid) {
      console.error(`[MFAService] ❌ Invalid token during MFA disable for user ${userId}`);
      throw new Error('Invalid TOTP token');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });

    // Invalidate any existing recovery codes when MFA is disabled
    await prisma.mfaRecoveryCode.deleteMany({
      where: { userId },
    });

    console.log(`[MFAService] 🔓 MFA disabled for user ${userId}`);
    
    return true;
  }

  /**
   * Generates or regenerates one-time hashed recovery codes for a user.
   * Any prior unused recovery codes are replaced.
   */
  async generateRecoveryCodes(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, mfaEnabled: true, mfaSecret: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Invalidate existing recovery codes
    await prisma.mfaRecoveryCode.deleteMany({
      where: { userId },
    });

    const plainCodes = generateRecoveryCodes(10);
    const records = plainCodes.map((code) => ({
      userId,
      codeHash: hashRecoveryCode(code),
    }));

    await prisma.mfaRecoveryCode.createMany({
      data: records,
    });

    // Audit log
    await prisma.securityAuditLog.create({
      data: {
        eventType: 'MFA_RECOVERY_CODES_GENERATED',
        severity: 'MEDIUM',
        details: {
          userId,
          email: user.email,
          codesCount: plainCodes.length,
        },
      },
    });

    return plainCodes;
  }

  /**
   * Returns counts of total and remaining unused recovery codes.
   */
  async getRecoveryCodeStatus(userId: string): Promise<{ total: number; remaining: number }> {
    const [total, remaining] = await Promise.all([
      prisma.mfaRecoveryCode.count({ where: { userId } }),
      prisma.mfaRecoveryCode.count({ where: { userId, used: false } }),
    ]);
    return { total, remaining };
  }

  /**
   * Recovers account using a one-time recovery code for lost devices.
   * Enforces strict rate limiting, marks code as used, resets MFA, and emits audit event.
   */
  async recoverAccountWithCode(
    email: string,
    recoveryCode: string,
    ipAddress?: string,
  ): Promise<{ token: string; user: { id: string; email: string }; message: string }> {
    const rateLimitKey = email.toLowerCase().trim();
    const now = Date.now();
    const rateLimit = recoveryRateLimits.get(rateLimitKey);

    if (rateLimit) {
      if (now - rateLimit.firstAttemptAt < RECOVERY_WINDOW_MS) {
        if (rateLimit.attempts >= MAX_RECOVERY_ATTEMPTS) {
          const remainingSec = Math.ceil((RECOVERY_WINDOW_MS - (now - rateLimit.firstAttemptAt)) / 1000);
          throw new Error(`Too many recovery attempts. Please try again in ${remainingSec} seconds.`);
        }
      } else {
        // Window expired, reset
        recoveryRateLimits.set(rateLimitKey, { attempts: 0, firstAttemptAt: now });
      }
    } else {
      recoveryRateLimits.set(rateLimitKey, { attempts: 0, firstAttemptAt: now });
    }

    const currentLimit = recoveryRateLimits.get(rateLimitKey)!;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        mfaRecoveryCodes: {
          where: { used: false },
        },
      },
    });

    if (!user || !user.mfaEnabled || user.mfaRecoveryCodes.length === 0) {
      currentLimit.attempts++;
      await prisma.securityAuditLog.create({
        data: {
          eventType: 'MFA_RECOVERY_FAILED',
          severity: 'HIGH',
          details: { email, ipAddress, reason: 'User not found or MFA not configured' },
        },
      });
      throw new Error('Invalid recovery code or account does not have MFA configured');
    }

    const matchedCode = user.mfaRecoveryCodes.find((rc) =>
      verifyRecoveryCodeHash(recoveryCode, rc.codeHash),
    );

    if (!matchedCode) {
      currentLimit.attempts++;
      await prisma.securityAuditLog.create({
        data: {
          eventType: 'MFA_RECOVERY_FAILED',
          severity: 'HIGH',
          details: { email, userId: user.id, ipAddress, reason: 'Code hash mismatch' },
        },
      });
      throw new Error('Invalid recovery code');
    }

    // Success! Clear rate limit
    recoveryRateLimits.delete(rateLimitKey);

    // Consume the one-time code
    await prisma.mfaRecoveryCode.update({
      where: { id: matchedCode.id },
      data: {
        used: true,
        usedAt: new Date(),
      },
    });

    // Safe lost-device recovery: reset MFA so the user can re-enroll a new device
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });

    // Security audit log for successful recovery
    await prisma.securityAuditLog.create({
      data: {
        eventType: 'MFA_RECOVERY_SUCCESS',
        severity: 'HIGH',
        details: {
          userId: user.id,
          email: user.email,
          usedCodeId: matchedCode.id,
          ipAddress,
        },
      },
    });

    const sessionToken = generateSessionToken({ id: user.id, email: user.email });

    return {
      token: sessionToken,
      user: { id: user.id, email: user.email },
      message: 'Account successfully recovered. MFA has been reset for your lost device. Please set up MFA again.',
    };
  }

  /**
   * Verify TOTP token for a user.
   */
  async verifyMFAToken(userId: string, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      return true;
    }

    const isValid = verifyTOTPToken(token, user.mfaSecret);

    if (!isValid) {
      console.error(`[MFAService] ❌ Invalid MFA token for user ${userId}`);
    }

    return isValid;
  }

  /**
   * Check if MFA is enabled for a user.
   */
  async isMFAEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });

    return user?.mfaEnabled || false;
  }

  /**
   * Resets internal rate limit state (for testing).
   */
  resetRateLimits(): void {
    recoveryRateLimits.clear();
  }
}

export const mfaService = new MFAService();
