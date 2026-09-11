import { describe, expect, it } from '@jest/globals';
import { parseSorobanMintBurnEvent } from '../soroban';

describe('parseSorobanMintBurnEvent', () => {
  it('should parse a mint event', () => {
    const event = {
      contractId: 'C...',
      topic: ['mint'],
      value: { to: 'G...', amount: '100000' },
      ledger: 12345,
    };
    const parsed = parseSorobanMintBurnEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.eventType).toBe('MINT');
    expect(parsed?.amount).toBe('100000');
    expect(parsed?.to).toBe('G...');
  });

  it('should parse a burn event', () => {
    const event = {
      contractId: 'C...',
      topic: ['burn'],
      value: { from: 'G...', amount: '50000' },
      ledger: 12346,
    };
    const parsed = parseSorobanMintBurnEvent(event);
    expect(parsed?.eventType).toBe('BURN');
    expect(parsed?.amount).toBe('50000');
    expect(parsed?.from).toBe('G...');
  });

  it('should return null for non mint/burn topics', () => {
    const event = {
      contractId: 'C...',
      topic: ['transfer'],
      value: { from: 'G...', to: 'G...', amount: '100' },
    };
    expect(parseSorobanMintBurnEvent(event)).toBENull();
  });

  it('should handle missing amount', () => {
    const event = {
      contractId: 'C...',
      topic: ['mint'],
      value: { to: 'G...' },
    };
    const parsed = parseSorobanMintBurnEvent(event);
    expect(parsed?.amount).toBe('0');
  });
});
