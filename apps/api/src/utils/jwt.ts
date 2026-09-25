import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import crypto from 'crypto';

export const ACCESS_TOKEN_EXPIRATION = '15m';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 900 seconds
export const REFRESH_TOKEN_EXPIRATION = '7d';
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800 seconds

export interface UserPayload {
  id: string;
  email: string;
  familyId?: string;
  jti?: string;
  exp?: number;
}

export interface RefreshTokenPayload {
  userId: string;
  familyId: string;
  rotationCounter: number;
  jti: string;
  exp?: number;
  tokenType?: 'refresh';
}

export interface MagicLinkPayload {
  email: string;
  jti: string;
}

export function generateMagicToken(email: string): string {
  return jwt.sign({ email }, env.JWT_SECRET, { expiresIn: '15m', jwtid: crypto.randomUUID() });
}

/**
 * Generates a short-lived access token (default: 15 minutes).
 * Bound to a specific session family (`familyId`) for instantaneous revocation.
 */
export function generateAccessToken(
  user: { id: string; email: string; familyId?: string },
  expiresIn: string | number = ACCESS_TOKEN_EXPIRATION
): string {
  return jwt.sign(
    { id: user.id, email: user.email, ...(user.familyId ? { familyId: user.familyId } : {}) },
    env.JWT_SECRET,
    { expiresIn: expiresIn as any, jwtid: crypto.randomUUID() }
  );
}

/**
 * Generates a rotating refresh token (default: 7 days) bound to a session family.
 * Returns both the signed JWT and its unique JTI.
 */
export function generateRefreshToken(
  params: { userId: string; familyId: string; rotationCounter: number },
  expiresIn: string | number = REFRESH_TOKEN_EXPIRATION
): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      userId: params.userId,
      familyId: params.familyId,
      rotationCounter: params.rotationCounter,
      tokenType: 'refresh',
    },
    env.JWT_SECRET,
    { expiresIn: expiresIn as any, jwtid: jti }
  );
  return { token, jti };
}

/**
 * Backward-compatible session token generator (defaults to short-lived access token).
 */
export function generateSessionToken(
  user: Omit<UserPayload, 'jti' | 'exp'>,
  expiresIn: string | number = ACCESS_TOKEN_EXPIRATION
): string {
  return generateAccessToken(user, expiresIn);
}

export function verifyToken<T>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET) as T;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = verifyToken<RefreshTokenPayload>(token);
  if (!decoded || !decoded.userId || !decoded.familyId || !decoded.jti) {
    throw new Error('Invalid refresh token payload');
  }
  return decoded;
}
