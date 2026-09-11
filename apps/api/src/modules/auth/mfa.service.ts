/**
 * MFA Service
 * 
 * Handles Multi-Factor Authentication setup and verification for sensitive operations.
 */

import { prisma } from '../../lib/prisma';
import { generateTOTPSecret, generateTOTPQRCode, verifyTOTPToken } from '../../utils/totp';

export interface MFASetupResponse {
  secret: string;
  qrCode: string; // Data URL
}

export class MFAService {
  /**
   * Setup MFA for a user - generates secret and QR code.
   * 
   * @param userId - User ID
   * @param email - User email
   * @returns MFASetupResponse with secret and QR code
   */
  async setupMFA(userId: string, email: string): Promise<MFASetupResponse> {
    // Generate new TOTP secret
    const secret = generateTOTPSecret();

    // Store secret in database (not enabled yet until verified)
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecret: secret,
        mfaEnabled: false, // Not enabled until first successful verification
      },
    });

    // Generate QR code
    const qrCode = await generateTOTPQRCode(email, secret);

    console.log(`[MFAService] 🔐 MFA setup initiated for user ${userId}`);
    
    return {
      secret,
      qrCode,
    };
  }

  /**
   * Enable MFA after user successfully scans QR and verifies first token.
   * 
   * @param userId - User ID
   * @param token - 6-digit TOTP token
   * @returns boolean - True if MFA enabled successfully
   */
  async enableMFA(userId: string, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaSecret) {
      throw new Error('MFA not set up. Please setup MFA first.');
    }

    if (user.mfaEnabled) {
      throw new Error('MFA already enabled');
    }

    // Verify token
    const isValid = verifyTOTPToken(token, user.mfaSecret);

    if (!isValid) {
      console.error(`[MFAService] ❌ Invalid token during MFA enable for user ${userId}`);
      throw new Error('Invalid TOTP token');
    }

    // Enable MFA
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    console.log(`[MFAService] ✅ MFA enabled for user ${userId}`);
    
    return true;
  }

  /**
   * Disable MFA for a user (requires valid TOTP token).
   * 
   * @param userId - User ID
   * @param token - 6-digit TOTP token
   * @returns boolean - True if MFA disabled successfully
   */
  async disableMFA(userId: string, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new Error('MFA not enabled');
    }

    // Verify token before disabling
    const isValid = verifyTOTPToken(token, user.mfaSecret);

    if (!isValid) {
      console.error(`[MFAService] ❌ Invalid token during MFA disable for user ${userId}`);
      throw new Error('Invalid TOTP token');
    }

    // Disable MFA and clear secret
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });

    console.log(`[MFAService] 🔓 MFA disabled for user ${userId}`);
    
    return true;
  }

  /**
   * Verify TOTP token for a user.
   * Used to protect sensitive operations like updating notification preferences.
   * 
   * @param userId - User ID
   * @param token - 6-digit TOTP token
   * @returns boolean - True if token is valid
   */
  async verifyMFAToken(userId: string, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      // MFA not enabled - token verification not required
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
   * 
   * @param userId - User ID
   * @returns boolean - True if MFA is enabled
   */
  async isMFAEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });

    return user?.mfaEnabled || false;
  }
}

export const mfaService = new MFAService();
