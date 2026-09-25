import crypto from 'crypto';

/**
 * Character set for recovery codes: uppercase alphanumeric, excluding ambiguous characters
 * (0, O, 1, I) to prevent user transcription errors.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_SEGMENT_LENGTH = 4;
const DEFAULT_CODE_COUNT = 10;

/**
 * Generates a single secure random recovery code formatted as XXXX-XXXX.
 */
export function generateSingleRecoveryCode(): string {
  const bytes = crypto.randomBytes(CODE_SEGMENT_LENGTH * 2);
  let part1 = '';
  let part2 = '';

  for (let i = 0; i < CODE_SEGMENT_LENGTH; i++) {
    part1 += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    part2 += CODE_ALPHABET[bytes[i + CODE_SEGMENT_LENGTH] % CODE_ALPHABET.length];
  }

  return `${part1}-${part2}`;
}

export const generateRecoveryCode = generateSingleRecoveryCode;

/**
 * Generates a batch of unique random recovery codes.
 */
export function generateRecoveryCodes(count = DEFAULT_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateSingleRecoveryCode());
  }
  return Array.from(codes);
}

/**
 * Normalizes a user-entered recovery code by removing hyphens/whitespace and uppercasing.
 */
export function normalizeRecoveryCode(code: string): string {
  return (code || '').replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Cryptographically hashes a normalized recovery code using SHA-256.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Constant-time comparison between entered recovery code and stored hash.
 */
export function verifyRecoveryCodeHash(enteredCode: string, storedHash: string): boolean {
  if (!enteredCode || !storedHash) return false;
  const computedHash = hashRecoveryCode(enteredCode);
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');

  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
