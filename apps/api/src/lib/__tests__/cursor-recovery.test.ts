import { describe, it, expect } from 'vitest';
import {
  ledgerSeqFromPagingToken,
  detectLedgerGap,
  buildCursorSuccessUpdate,
  buildCursorOutageUpdate,
  buildCursorGapUpdate,
  buildCursorGapClearedUpdate,
} from '../cursor-recovery';

// TOID = ledgerSeq << 32 | txOrder << 12 | opOrder
function toid(ledgerSeq: number, txOrder = 1, opOrder = 1): string {
  return ((BigInt(ledgerSeq) << 32n) | (BigInt(txOrder) << 12n) | BigInt(opOrder)).toString();
}

describe('ledgerSeqFromPagingToken', () => {
  it('decodes the ledger sequence encoded in a TOID paging token', () => {
    expect(ledgerSeqFromPagingToken(toid(1000))).toBe(1000);
    expect(ledgerSeqFromPagingToken(toid(4200))).toBe(4200);
  });

  it('returns null for the seed value, empty, or non-numeric input', () => {
    expect(ledgerSeqFromPagingToken('0')).toBeNull();
    expect(ledgerSeqFromPagingToken('')).toBeNull();
    expect(ledgerSeqFromPagingToken(null)).toBeNull();
    expect(ledgerSeqFromPagingToken(undefined)).toBeNull();
    expect(ledgerSeqFromPagingToken('not-a-number')).toBeNull();
  });
});

describe('detectLedgerGap', () => {
  it('reports no gap for consecutive or nearby ledgers', () => {
    expect(detectLedgerGap(toid(1000), toid(1001))).toEqual({ hasGap: false, ledgerDelta: 1 });
    expect(detectLedgerGap(toid(1000), toid(1005))).toEqual({ hasGap: false, ledgerDelta: 5 });
  });

  it('flags a gap when the ledger jump exceeds the threshold', () => {
    expect(detectLedgerGap(toid(1000), toid(1006))).toEqual({ hasGap: true, ledgerDelta: 6 });
    expect(detectLedgerGap(toid(1000), toid(2000))).toEqual({ hasGap: true, ledgerDelta: 1000 });
  });

  it('respects a custom maxLedgerJump threshold', () => {
    expect(detectLedgerGap(toid(1000), toid(1003), 10)).toEqual({ hasGap: false, ledgerDelta: 3 });
    expect(detectLedgerGap(toid(1000), toid(1003), 2)).toEqual({ hasGap: true, ledgerDelta: 3 });
  });

  it('never flags a gap when there is no previous token (first record ever seen)', () => {
    expect(detectLedgerGap(null, toid(5_000_000))).toEqual({ hasGap: false, ledgerDelta: 0 });
    expect(detectLedgerGap('0', toid(5_000_000))).toEqual({ hasGap: false, ledgerDelta: 0 });
  });

  it('fails safe (no gap) when a token cannot be decoded', () => {
    expect(detectLedgerGap('garbage', toid(1000))).toEqual({ hasGap: false, ledgerDelta: 0 });
  });
});

describe('IngestionCursor health update builders', () => {
  it('buildCursorSuccessUpdate clears failures and marks the cursor active', () => {
    const now = new Date('2026-09-23T00:00:00.000Z');
    expect(buildCursorSuccessUpdate(now)).toEqual({
      status: 'active',
      consecutiveFailures: 0,
      lastError: null,
      lastSuccessAt: now,
    });
  });

  it('buildCursorOutageUpdate increments the failure counter and records the error', () => {
    expect(buildCursorOutageUpdate('All Horizon nodes unreachable', 2)).toEqual({
      consecutiveFailures: 3,
      lastError: 'All Horizon nodes unreachable',
    });
  });

  it('buildCursorGapUpdate marks the cursor gap_detected with the ledger delta', () => {
    const now = new Date('2026-09-23T00:00:00.000Z');
    expect(buildCursorGapUpdate(42, now)).toEqual({
      status: 'gap_detected',
      gapDetectedAt: now,
      lastGapLedgerDelta: 42,
    });
  });

  it('buildCursorGapClearedUpdate returns the cursor to active', () => {
    expect(buildCursorGapClearedUpdate()).toEqual({ status: 'active' });
  });
});
