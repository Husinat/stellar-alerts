import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ingestionCursor: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('../../lib/stellar', () => ({
  decodeHorizonAsset: vi.fn((record: any) => ({
    assetCode: record?.asset_type === 'native' ? 'XLM' : record?.asset_code || 'XLM',
    assetIssuer: record?.asset_issuer || null,
  })),
  stellar: {
    server: {},
    getRecentPayments: vi.fn().mockResolvedValue([]),
    getPaymentsSince: vi.fn(),
    getPaymentsSinceResult: vi.fn(),
    getLatestPagingToken: vi.fn(),
    openPaymentStream: vi.fn(),
  },
}));

vi.mock('../../lib/queue', () => ({
  enqueuePaymentAlert: vi.fn(),
}));

vi.mock('../../lib/lock', () => ({
  withWalletLock: vi.fn(async (_walletId: string, fn: () => Promise<any>) => fn()),
}));

import { prisma } from '../../lib/prisma';
import { stellar } from '../../lib/stellar';
import { enqueuePaymentAlert } from '../../lib/queue';
import {
  ensureCursor,
  processWalletPayments,
  saveCursor,
  handleStreamRecord,
  startHorizonSSEStream,
  type StreamConnector,
} from '../watcher.worker';

const wallet = {
  id: 'wallet-1',
  publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
};

const paymentRecord = (pagingToken: string, txHash: string) => ({
  id: pagingToken,
  paging_token: pagingToken,
  type: 'payment',
  amount: '10.5',
  asset_type: 'native',
  from: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSFMG4BVI',
  transaction_hash: txHash,
  created_at: '2026-08-24T10:00:00Z',
});

// TOID = ledgerSeq << 32 | txOrder << 12 | opOrder — matches lib/cursor-recovery.ts decoding.
const toid = (ledgerSeq: number, txOrder = 1, opOrder = 1): string =>
  ((BigInt(ledgerSeq) << 32n) | (BigInt(txOrder) << 12n) | BigInt(opOrder)).toString();

const okResult = (records: any[]) => ({ records, allNodesFailed: false, lastError: null });
const outageResult = (lastError: string) => ({ records: [], allNodesFailed: true, lastError });

describe('Watcher ingestion cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'payment-1' } as any);
  });

  describe('ensureCursor', () => {
    it('creates a cursor record seeded from the latest paging token on first sight', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue(null as any);
      vi.mocked(stellar.getLatestPagingToken).mockResolvedValue('4000');
      vi.mocked(prisma.ingestionCursor.create).mockResolvedValue({ pagingToken: '4000' } as any);

      const cursor = await ensureCursor(wallet);

      expect(prisma.ingestionCursor.create).toHaveBeenCalledWith({
        data: { walletId: wallet.id, pagingToken: '4000' },
      });
      expect(cursor).toBe('4000');
    });

    it('returns the persisted paging token without touching Horizon', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200' } as any);

      const cursor = await ensureCursor(wallet);

      expect(cursor).toBe('4200');
      expect(stellar.getLatestPagingToken).not.toHaveBeenCalled();
      expect(prisma.ingestionCursor.create).not.toHaveBeenCalled();
    });
  });

  describe('saveCursor', () => {
    it('upserts the paging token keyed by wallet, recording success health', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue(null as any);

      await saveCursor(wallet.id, toid(1000));

      expect(prisma.ingestionCursor.upsert).toHaveBeenCalledWith({
        where: { walletId: wallet.id },
        create: { walletId: wallet.id, pagingToken: toid(1000) },
        update: expect.objectContaining({
          pagingToken: toid(1000),
          status: 'active',
          consecutiveFailures: 0,
          lastError: null,
        }),
      });
    });
  });

  describe('processWalletPayments', () => {
    it('resumes the Horizon query from the persisted cursor (restart scenario)', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200', consecutiveFailures: 0 } as any);
      vi.mocked(stellar.getPaymentsSinceResult).mockResolvedValue(okResult([]));

      await processWalletPayments(wallet);

      expect(stellar.getPaymentsSinceResult).toHaveBeenCalledWith(wallet.publicKey, '4200', 50);
    });

    it('advances the cursor to the paging token of every processed record', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: toid(1000), consecutiveFailures: 0 } as any);
      vi.mocked(stellar.getPaymentsSinceResult).mockResolvedValue(
        okResult([paymentRecord(toid(1001), 'hash-a'), paymentRecord(toid(1002), 'hash-b')]),
      );

      await processWalletPayments(wallet);

      expect(vi.mocked(prisma.ingestionCursor.upsert).mock.calls.map((call) => call[0].update.pagingToken)).toEqual([
        toid(1001),
        toid(1002),
      ]);
    });

    it('pages through a backlog until Horizon returns a partial page', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: toid(1000), consecutiveFailures: 0 } as any);
      const fullPage = Array.from({ length: 50 }, (_, i) =>
        paymentRecord(toid(1001 + i), `hash-${i}`)
      );
      vi.mocked(stellar.getPaymentsSinceResult)
        .mockResolvedValueOnce(okResult(fullPage))
        .mockResolvedValueOnce(okResult([paymentRecord(toid(1051), 'hash-tail')]));

      await processWalletPayments(wallet);

      expect(stellar.getPaymentsSinceResult).toHaveBeenCalledTimes(2);
      expect(vi.mocked(stellar.getPaymentsSinceResult).mock.calls[1]).toEqual([wallet.publicKey, toid(1050), 50]);
    });

    it('skips wallets with an invalid public key', async () => {
      await processWalletPayments({ id: 'wallet-2', publicKey: 'not-a-key' });

      expect(prisma.ingestionCursor.findUnique).not.toHaveBeenCalled();
      expect(stellar.getPaymentsSinceResult).not.toHaveBeenCalled();
    });
  });

  describe('cursor recovery hardening', () => {
    it('ledger gap scenario: a large ledger jump triggers a bounded backfill and clears the gap flag', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: toid(1000), consecutiveFailures: 0 } as any);
      // The next record jumps from ledger 1000 to 1500 — far past the default gap threshold.
      vi.mocked(stellar.getPaymentsSinceResult).mockResolvedValueOnce(
        okResult([paymentRecord(toid(1500), 'hash-after-gap')]),
      );
      vi.mocked(stellar.getRecentPayments).mockResolvedValue([
        paymentRecord(toid(1499), 'hash-recent-2'),
        paymentRecord(toid(1500), 'hash-after-gap'),
      ] as any);

      await processWalletPayments(wallet);

      // Bounded backfill re-fetched recent payments instead of an unbounded replay.
      expect(stellar.getRecentPayments).toHaveBeenCalledWith(wallet.publicKey, expect.any(Number));

      const updateCalls = vi.mocked(prisma.ingestionCursor.upsert).mock.calls.map((c) => c[0].update);
      expect(updateCalls.some((u) => u.status === 'gap_detected')).toBe(true);

      // The final persisted state clears the gap flag once bounded backfill completes.
      expect(prisma.ingestionCursor.update).toHaveBeenCalledWith({
        where: { walletId: wallet.id },
        data: { status: 'active' },
      });
    });

    it('provider outage scenario: every Horizon node failing does not advance the cursor and is retried next poll', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: toid(1000), consecutiveFailures: 1 } as any);
      vi.mocked(stellar.getPaymentsSinceResult).mockResolvedValue(outageResult('All Horizon nodes unreachable'));

      await processWalletPayments(wallet);

      expect(prisma.ingestionCursor.upsert).not.toHaveBeenCalled();
      expect(prisma.ingestionCursor.update).toHaveBeenCalledWith({
        where: { walletId: wallet.id },
        data: { consecutiveFailures: 2, lastError: 'All Horizon nodes unreachable' },
      });
    });

    it('reorg-like duplicate scenario: a raced insert of the same txHash is treated as already-recorded, not an error', async () => {
      vi.mocked(prisma.payment.findUnique)
        .mockResolvedValueOnce(null as any) // first check: not seen yet
        .mockResolvedValueOnce({ id: 'payment-winner' } as any); // re-fetch after the race is lost
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      vi.mocked(prisma.payment.create).mockRejectedValueOnce(p2002);
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue(null as any);

      await expect(handleStreamRecord(wallet, paymentRecord(toid(2000), 'hash-race'))).resolves.not.toThrow();

      expect(enqueuePaymentAlert).not.toHaveBeenCalled();
      // The cursor still advances — the record was legitimately processed by the winner.
      expect(prisma.ingestionCursor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ pagingToken: toid(2000) }) }),
      );
    });
  });
});

describe('handleStreamRecord (live SSE message handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'payment-1' } as any);
  });

  it('persists a payment and advances the ingestion cursor', async () => {
    await handleStreamRecord(wallet, paymentRecord('5001', 'hash-hsr'));

    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    expect(prisma.ingestionCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ pagingToken: '5001' }) })
    );
  });

  it('does not re-ingest a payment that was already seen', async () => {
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({ id: 'existing' } as any);

    await handleStreamRecord(wallet, paymentRecord('5002', 'hash-dup'));

    // Payment is not re-created, but the cursor still advances past it.
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.ingestionCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ pagingToken: '5002' }) })
    );
  });
});

describe('Horizon SSE stream lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'payment-1' } as any);
    vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200' } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeConnector = () => {
    const connections: { handlers: any; close: ReturnType<typeof vi.fn> }[] = [];
    const connector: StreamConnector = (cursor, handlers) => {
      const close = vi.fn();
      connections.push({ handlers, close });
      return close;
    };
    return { connector, connections };
  };

  it('opens a stream from the persisted cursor and ingests live messages', async () => {
    const { connector, connections } = makeConnector();

    const close = await startHorizonSSEStream(wallet, { connector });

    expect(connections).toHaveLength(1);
    expect(connections[0].handlers.onmessage).toBeTypeOf('function');

    await connections[0].handlers.onmessage(paymentRecord('4201', 'hash-sse'));

    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    expect(prisma.ingestionCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ pagingToken: '4201' }) })
    );

    close();
  });

  it('automatically reconnects after a network drop', async () => {
    const { connector, connections } = makeConnector();

    const close = await startHorizonSSEStream(wallet, { connector, reconnectDelayMs: 10 });
    expect(connections).toHaveLength(1);

    // Simulate the underlying EventSource dropping.
    connections[0].handlers.onerror(new Error('network drop'));

    // The broken connection is torn down immediately...
    expect(connections[0].close).toHaveBeenCalledTimes(1);

    // ...and a fresh stream is opened after the backoff delay.
    await vi.advanceTimersByTimeAsync(10);
    expect(connections).toHaveLength(2);

    close();
  });

  it('stops reconnecting once maxReconnectAttempts is reached', async () => {
    const { connector, connections } = makeConnector();

    const close = await startHorizonSSEStream(wallet, {
      connector,
      reconnectDelayMs: 10,
      maxReconnectAttempts: 2,
    });
    expect(connections).toHaveLength(1);

    connections[0].handlers.onerror(new Error('drop-1'));
    await vi.advanceTimersByTimeAsync(10);
    expect(connections).toHaveLength(2);

    connections[1].handlers.onerror(new Error('drop-2'));
    await vi.advanceTimersByTimeAsync(10);
    // attempts has reached the limit: no further reconnect.
    expect(connections).toHaveLength(2);

    close();
  });

  it('close() cancels any pending reconnect', async () => {
    const { connector, connections } = makeConnector();

    const close = await startHorizonSSEStream(wallet, { connector, reconnectDelayMs: 10 });
    connections[0].handlers.onerror(new Error('drop'));
    close();

    await vi.advanceTimersByTimeAsync(10);
    expect(connections).toHaveLength(1);
  });

  it('does not open a stream for an invalid public key', async () => {
    const { connector, connections } = makeConnector();

    const close = await startHorizonSSEStream(
      { id: 'wallet-2', publicKey: 'not-a-key' },
      { connector }
    );

    expect(connections).toHaveLength(0);
    expect(typeof close).toBe('function');
  });
});
