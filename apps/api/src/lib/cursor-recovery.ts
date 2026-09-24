/**
 * Pure helpers for hardening Horizon/Soroban ingestion cursor recovery:
 * ledger-gap detection from Horizon paging tokens, and the IngestionCursor
 * health fields (status/consecutiveFailures/lastError/gapDetectedAt) an
 * operator visibility endpoint reads. No I/O here — callers (watcher.worker.ts)
 * own persistence and network calls, which keeps this module trivially unit
 * testable and keeps DB/Horizon mocking out of the gap-math tests.
 */

/**
 * Number of most-recent records to reprocess when a ledger gap is detected.
 * Bounded so a large or unknown-size gap never triggers an unbounded replay —
 * this recovers what Horizon's "recent payments" window still has, logs the
 * gap for operator visibility, and moves on rather than stalling ingestion.
 */
export const BOUNDED_BACKFILL_LIMIT = 200;

/**
 * A ledger-to-ledger jump larger than this (in a wallet's own payment
 * stream) is treated as a possible gap — e.g. a reconnect that resumed from
 * a cursor older than expected, or Horizon skipping records for that account
 * across several ledgers. Small jumps (the account simply had no activity
 * for a few ledgers) are normal and not flagged.
 */
export const DEFAULT_MAX_LEDGER_JUMP = 5;

/**
 * Decodes the ledger sequence encoded in a Horizon TOID paging token
 * (ledger_seq << 32 | tx_order << 12 | op_order). Returns null for a token
 * that isn't a valid TOID (e.g. the seed value "0").
 */
export function ledgerSeqFromPagingToken(pagingToken: string | null | undefined): number | null {
  if (!pagingToken) return null;
  try {
    const value = BigInt(pagingToken);
    if (value <= 0n) return null;
    return Number(value >> 32n);
  } catch {
    return null;
  }
}

export interface GapDetectionResult {
  hasGap: boolean;
  ledgerDelta: number;
}

/**
 * Compares the ledger sequence of two consecutive paging tokens for the same
 * wallet and flags a gap when the jump exceeds `maxLedgerJump`. A missing or
 * undecodable previous token (first record ever seen) never counts as a gap.
 */
export function detectLedgerGap(
  previousPagingToken: string | null | undefined,
  nextPagingToken: string | null | undefined,
  maxLedgerJump: number = DEFAULT_MAX_LEDGER_JUMP,
): GapDetectionResult {
  const previousLedger = ledgerSeqFromPagingToken(previousPagingToken);
  const nextLedger = ledgerSeqFromPagingToken(nextPagingToken);

  if (previousLedger === null || nextLedger === null) {
    return { hasGap: false, ledgerDelta: 0 };
  }

  const ledgerDelta = nextLedger - previousLedger;
  return { hasGap: ledgerDelta > maxLedgerJump, ledgerDelta };
}

export interface IngestionCursorHealthUpdate {
  status?: string;
  consecutiveFailures?: number;
  lastError?: string | null;
  lastSuccessAt?: Date;
  gapDetectedAt?: Date;
  lastGapLedgerDelta?: number;
}

/** Update payload after a fully successful poll: clears any failure/gap state. */
export function buildCursorSuccessUpdate(now: Date = new Date()): IngestionCursorHealthUpdate {
  return {
    status: 'active',
    consecutiveFailures: 0,
    lastError: null,
    lastSuccessAt: now,
  };
}

/** Update payload when every Horizon failover node errored (provider outage). Cursor position is left untouched by the caller. */
export function buildCursorOutageUpdate(error: string, previousFailures: number): IngestionCursorHealthUpdate {
  return {
    consecutiveFailures: previousFailures + 1,
    lastError: error,
  };
}

/** Update payload when a ledger gap is detected, before bounded backfill runs. */
export function buildCursorGapUpdate(ledgerDelta: number, now: Date = new Date()): IngestionCursorHealthUpdate {
  return {
    status: 'gap_detected',
    gapDetectedAt: now,
    lastGapLedgerDelta: ledgerDelta,
  };
}

/** Update payload once bounded backfill has recovered from a detected gap. */
export function buildCursorGapClearedUpdate(): IngestionCursorHealthUpdate {
  return { status: 'active' };
}
