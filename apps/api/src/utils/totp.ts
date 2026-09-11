/**
 * TOTP (Time-based One-Time Password) Utility
 * 
 * Implements RFC 6238 TOTP for Multi-Factor Authentication using otplib.
 * Used to secure sensitive operations like modifying notification preferences.
 */

import { authenticator } from 'otplib';
import QRCode from 'qrcode';

/**
 * Generate a new TOTP secret for a user.
 * 
 * @returns Base32-encoded secret string
 */
export function generateTOTPSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Generate a QR code data URL for TOTP setup.
 * Users can scan this with authenticator apps (Google Authenticator, Authy, etc.)
 * 
 * @param email - User's email address
 * @param secret - TOTP secret
 * @param issuer - Application name (defaults to "Stellar Alerts")
 * @returns Promise<string> - Data URL for QR code image
 */
export async function generateTOTPQRCode(
  email: string,
  secret: string,
  issuer: string = 'Stellar Alerts'
): Promise<string> {
  const otpauth = authenticator.keyuri(email, issuer, secret);
  const qrCodeDataURL = await QRCode.toDataURL(otpauth);
  return qrCodeDataURL;
}

/**
 * Verify a TOTP token against a secret.
 * 
 * @param token - 6-digit TOTP code from user's authenticator app
 * @param secret - User's TOTP secret
 * @param window - Time window tolerance (default: 1 = ±30 seconds)
 * @returns boolean - True if token is valid
 */
export function verifyTOTPToken(
  token: string,
  secret: string,
  window: number = 1
): boolean {
  try {
    return authenticator.verify({
      token,
      secret,
      window,
    });
  } catch (error) {
    console.error('[TOTP] Token verification error:', error);
    return false;
  }
}

/**
 * Generate current TOTP token for a secret (for testing/debugging).
 * 
 * @param secret - TOTP secret
 * @returns string - 6-digit TOTP code
 */
export function generateTOTPToken(secret: string): string {
  return authenticator.generate(secret);
}
