/**
 * Lightweight, dependency-free StrKey format check for Stellar Ed25519
 * public keys, used for immediate client-side feedback. This mirrors the
 * shape Stellar public keys must have (56 chars, starts with 'G', base32
 * alphabet) but does NOT verify the embedded CRC16 checksum — the server
 * (apps/api wallets.schema.ts) performs the authoritative check via
 * StellarSdk.StrKey.isValidEd25519PublicKey before persisting anything.
 */
const BASE32_ALPHABET = /^[A-Z2-7]+$/;

export function looksLikeStellarPublicKey(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length !== 56) return false;
  if (!trimmed.startsWith('G')) return false;
  return BASE32_ALPHABET.test(trimmed);
}

export function truncateAddress(address: string, head = 6, tail = 6): string {
  if (address.length <= head + tail) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
