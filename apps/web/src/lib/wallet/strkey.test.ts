import { describe, it, expect } from 'vitest';
import { looksLikeStellarPublicKey, truncateAddress } from './strkey';

describe('looksLikeStellarPublicKey', () => {
  it('accepts a well-formed 56-char public key starting with G', () => {
    expect(
      looksLikeStellarPublicKey('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
    ).toBe(false); // 58 chars, intentionally wrong length to sanity-check the length gate
    expect(
      looksLikeStellarPublicKey('GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI')
    ).toBe(true);
  });

  it('rejects addresses that do not start with G', () => {
    expect(
      looksLikeStellarPublicKey('SBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI')
    ).toBe(false);
  });

  it('rejects malformed input safely', () => {
    expect(looksLikeStellarPublicKey('')).toBe(false);
    expect(looksLikeStellarPublicKey('not-a-key')).toBe(false);
    expect(looksLikeStellarPublicKey('G'.repeat(56).toLowerCase())).toBe(false);
    // @ts-expect-error deliberate non-string input
    expect(looksLikeStellarPublicKey(null)).toBe(false);
    // @ts-expect-error deliberate non-string input
    expect(looksLikeStellarPublicKey(undefined)).toBe(false);
  });

  it('rejects characters outside the base32 alphabet (e.g. 0, 1, 8, 9)', () => {
    const withInvalidChar = `G${'A'.repeat(54)}1`;
    expect(looksLikeStellarPublicKey(withInvalidChar)).toBe(false);
  });
});

describe('truncateAddress', () => {
  it('truncates a long address to head...tail', () => {
    const address = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';
    expect(truncateAddress(address)).toBe('GBZXN7...DNMADI');
  });

  it('leaves short strings untouched', () => {
    expect(truncateAddress('short')).toBe('short');
  });
});
