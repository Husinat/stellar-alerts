import * as StellarSdk from 'stellar-sdk';
import { env } from '../config/env';
import { prisma, connectWithRetry } from '../lib/prisma';
import { stellar, decodeHorizonAsset, parseSacTransferEvent } from '../lib/stellar';
import { enqueuePaymentAlert } from '../lib/queue';
import { publishPaymentEvent } from '../lib/realtime';
import {
  getSorobanLatestLedger,
  loadContractRegistry,
  getActiveContractIds,
  parseSorobanTransferEvent,
  routeEventToUsers,
} from '../lib/soroban';
import { withWalletLock } from '../lib/lock';
import { shouldAlert, PaymentContext } from '../lib/rules-engine';
import { MemoryMonitor, MemorySnapshot } from '../utils/memory-monitor';
import { createLogger } from '../lib/logger';
import { trace, SpanStatusCode, TraceFlags } from '@opentelemetry/api';
import {
  BOUNDED_BACKFILL_LIMIT,
  buildCursorGapClearedUpdate,
  buildCursorGapUpdate,
  buildCursorOutageUpdate,
  buildCursorSuccessUpdate,
  detectLedgerGap,
} from '../lib/cursor-recovery';

const tracer = trace.getTracer('watcher-worker');


let memoryMonitor: MemoryMonitor | null = null;

const log = createLogger({ module: 'WatcherWorker' });

/**
 * Replies to the supervisor's IPC pings so the worker is not considered
 * frozen and killed (see workers/supervisor.ts heartbeat logic).
 */
function registerSupervisorHeartbeat() {
  process.on('message', (message: any) => {
    if (message?.type === 'ping') {
      process.send?.({ type: 'pong' });
    }
  });
}

export async function processPaymentRecord(
  wallet: { id: string; publicKey: string; userId?: string },
  record: any,
  options: { skipGapCheck?: boolean; previousPagingToken?: string | null } = {}
) {
  return tracer.startActiveSpan('watcher.processPaymentRecord', async (span) => {
    try {
      let amount: string | undefined;
      let asset: string = "XLM";
      let assetIssuer: string | null = null;
      let fromAddress: string = '';
      let memo: string | null = null;
      const txHash: string = record.transaction_hash || record.hash || '';
      const receivedAt: Date = new Date(record.created_at || Date.now());

      if (record.type === "payment") {
        const decodedAsset = decodeHorizonAsset(record);
        amount = record.amount;
        asset = decodedAsset.assetCode;
        assetIssuer = decodedAsset.assetIssuer;
        fromAddress = record.from || '';
        memo = record.memo || null;
      } else if (record.type === 'create_account') {
        amount = record.starting_balance;
        asset = "XLM";
        assetIssuer = null;
        fromAddress = record.funder || "";
      } else {
        const sacTransfer = parseSacTransferEvent(record);
        if (!sacTransfer) {
          span.end();
          return;
        }

        amount = sacTransfer.amount;
        asset = sacTransfer.assetCode ?? sacTransfer.contractId ?? "Unknown";
        assetIssuer = sacTransfer.assetIssuer;
        fromAddress = sacTransfer.from;
      }

      if (!amount || !txHash) {
        span.end();
        return;
      }

      span.setAttribute('payment.txHash', txHash);
      span.setAttribute('payment.walletId', wallet.id);
      span.setAttribute('payment.asset', asset);

      const existing = await prisma.payment.findUnique({ where: { txHash } });
      let payment: { id: string } | null = existing;
      let isNewPayment = false;

      if (!existing) {
        try {
          payment = await prisma.payment.create({
            data: {
              walletId: wallet.id,
              txHash,
              fromAddress,
              amount: Number(amount),
              asset,
              assetIssuer,
              memo,
              receivedAt,
            },
          });
          isNewPayment = true;
        } catch (err: any) {
          if (err.code === 'P2002') {
            // A concurrent processor (SSE stream + poll loop, or two
            // overlapping bounded-backfill passes) inserted this payment
            // first — reorg-like duplicate delivery, not a real error.
            // Treat it as already recorded: don't re-alert.
            log.info({ txHash }, '🔁 Duplicate payment insert raced and lost, skipping (already recorded)');
            payment = await prisma.payment.findUnique({ where: { txHash } });
          } else {
            throw err;
          }
        }
      }

      if (isNewPayment && payment) {
        if (wallet.userId) {
          await publishPaymentEvent(wallet.userId, payment);
        }

        let shouldSendAlert = true;

        if (wallet.userId) {
          const notifyPrefs = await prisma.notificationPreference.findUnique({
            where: { userId: wallet.userId },
          });

          if ((notifyPrefs as any)?.filterRules) {
            const paymentContext: PaymentContext = {
              amount: Number(amount),
              asset,
              fromAddress,
              memo,
            };

            shouldSendAlert = shouldAlert((notifyPrefs as any)?.filterRules, paymentContext);

            if (!shouldSendAlert) {
              console.log(
                `[WatcherWorker] 🔕 Payment filtered by rules for wallet (${wallet.publicKey.substring(
                  0,
                  8
                )}...): ${amount} ${asset}`
              );
            }
          }
        }

        if (shouldSendAlert) {
          await enqueuePaymentAlert({
            paymentId: payment.id,
            txHash,
            walletId: wallet.id,
            amount,
            asset,
            assetIssuer,
            fromAddress,
            receivedAt: receivedAt.toISOString(),
          });
          span.setAttribute('payment.enqueued', true);
        } else {
          span.setAttribute('payment.enqueued', false);
        }
      }

      const pagingToken = record.paging_token || record.pagingToken;
      if (pagingToken) {
        const gap = await saveCursor(wallet.id, pagingToken, {
          skipGapCheck: options.skipGapCheck,
          previousPagingToken: options.previousPagingToken,
        });
        if (gap.hasGap) {
          span.setAttribute('cursor.gapDetected', true);
          span.setAttribute('cursor.gapLedgerDelta', gap.ledgerDelta);
          await recoverFromLedgerGap(wallet);
        }
      }

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

// Number of operations pulled from Horizon per cursor page
const CURSOR_PAGE_SIZE = 50;

// Upper bound on pages walked in a single catch-up pass, so a long outage
// cannot stall the catch-up run indefinitely
const MAX_CATCHUP_PAGES = 20;

/**
 * Persists the wallet's latest processed paging token. Unless
 * `skipGapCheck` is set (used internally while a bounded backfill is
 * already recovering from a previously detected gap), compares the new
 * token's ledger sequence against the currently persisted one and flags an
 * abnormally large jump as a ledger gap (see lib/cursor-recovery.ts) —
 * surfaced both to the caller (who triggers bounded backfill) and on the
 * IngestionCursor row itself for operator visibility.
 */
export async function saveCursor(
  walletId: string,
  pagingToken: string,
  options: { skipGapCheck?: boolean; previousPagingToken?: string | null } = {},
) {
  if (options.skipGapCheck) {
    await prisma.ingestionCursor.upsert({
      where: { walletId },
      create: { walletId, pagingToken },
      update: { pagingToken, ...buildCursorSuccessUpdate() },
    });
    return { hasGap: false, ledgerDelta: 0 };
  }

  // Callers that already track the wallet's in-flight cursor (the
  // catch-up/SSE loops) pass it explicitly to avoid a redundant read; other
  // callers (e.g. a bare processPaymentRecord() call) fall back to reading
  // the currently persisted token.
  const previousPagingToken =
    options.previousPagingToken !== undefined
      ? options.previousPagingToken
      : (await prisma.ingestionCursor.findUnique({ where: { walletId } }))?.pagingToken ?? null;

  const gap = detectLedgerGap(previousPagingToken, pagingToken);

  await prisma.ingestionCursor.upsert({
    where: { walletId },
    create: { walletId, pagingToken },
    update: {
      pagingToken,
      ...(gap.hasGap ? buildCursorGapUpdate(gap.ledgerDelta) : buildCursorSuccessUpdate()),
    },
  });

  if (gap.hasGap) {
    log.warn({ walletId, ledgerDelta: gap.ledgerDelta }, '⚠️ Ledger gap detected in ingestion cursor');
  }

  return gap;
}

/**
 * Recovers from a detected ledger gap with a bounded backfill: reprocesses
 * the most recent `BOUNDED_BACKFILL_LIMIT` payments for the wallet (rather
 * than an unbounded replay of unknown gap size), then clears the
 * gap_detected status. Already-recorded payments within that window are
 * skipped via the same duplicate-protected insert path as normal ingestion.
 */
async function recoverFromLedgerGap(wallet: { id: string; publicKey: string; userId?: string }) {
  log.warn(
    { walletId: wallet.id, publicKey: wallet.publicKey.substring(0, 8), limit: BOUNDED_BACKFILL_LIMIT },
    '🩹 Running bounded backfill to recover from detected ledger gap',
  );

  const recent = (await stellar.getRecentPayments(wallet.publicKey, BOUNDED_BACKFILL_LIMIT)) as any[];
  const ascending = [...recent].reverse();

  for (const record of ascending) {
    await processPaymentRecord(wallet, record, { skipGapCheck: true });
  }

  await prisma.ingestionCursor.update({
    where: { walletId: wallet.id },
    data: buildCursorGapClearedUpdate(),
  });

  log.info(
    { walletId: wallet.id, recovered: ascending.length },
    '✅ Bounded backfill complete, ingestion cursor gap cleared',
  );
}

/**
 * Returns the persisted paging token for a wallet, creating the cursor record
 * on first sight. A fresh cursor is seeded from the wallet's latest Horizon
 * paging token so that registering a wallet does not replay its whole history.
 */
export async function ensureCursor(wallet: {
  id: string;
  publicKey: string;
}): Promise<string> {
  const existing = await prisma.ingestionCursor.findUnique({
    where: { walletId: wallet.id },
  });
  if (existing) return existing.pagingToken;

  const pagingToken = await stellar.getLatestPagingToken(wallet.publicKey);
  const created = await prisma.ingestionCursor.create({
    data: { walletId: wallet.id, pagingToken },
  });
  log.info(
    { walletPublicKey: wallet.publicKey.substring(0, 8), pagingToken },
    '🔖 Seeded ingestion cursor'
  );
  return created.pagingToken;
}

export async function processWalletPayments(wallet: { id: string; publicKey: string; userId?: string }) {
  return tracer.startActiveSpan('watcher.processWalletPayments', async (span) => {
    try {
      if (!wallet.publicKey || !StellarSdk.StrKey.isValidEd25519PublicKey(wallet.publicKey)) {
        console.warn(`[WatcherWorker] Skipping invalid public key checksum: "${wallet.publicKey}"`);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return;
      }

      span.setAttribute('wallet.id', wallet.id);
      span.setAttribute('wallet.publicKey', wallet.publicKey);

      let cursor = await ensureCursor(wallet);

      for (let page = 0; page < MAX_CATCHUP_PAGES; page++) {
        const result = await stellar.getPaymentsSinceResult(wallet.publicKey, cursor, CURSOR_PAGE_SIZE);

        if (result.allNodesFailed) {
          // Provider outage: every Horizon failover node errored. Record it
          // on the cursor for operator visibility and stop this pass without
          // advancing the cursor — the next poll retries from the same
          // point, so no data is lost once Horizon recovers.
          const currentCursor = await prisma.ingestionCursor.findUnique({ where: { walletId: wallet.id } });
          await prisma.ingestionCursor.update({
            where: { walletId: wallet.id },
            data: buildCursorOutageUpdate(result.lastError || 'All Horizon nodes unreachable', currentCursor?.consecutiveFailures ?? 0),
          });
          console.warn(
            `[WatcherWorker] Provider outage for ${wallet.publicKey.substring(0, 8)}...: ${result.lastError}. Will retry next poll.`,
          );
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return;
        }

        const records = result.records;
        if (records.length === 0) {
          await prisma.ingestionCursor.update({
            where: { walletId: wallet.id },
            data: buildCursorSuccessUpdate(),
          });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return;
        }

        for (const record of records) {
          await processPaymentRecord(wallet, record, { previousPagingToken: cursor });
          if (record.paging_token) {
            cursor = record.paging_token;
          }
        }

        if (records.length < CURSOR_PAGE_SIZE) {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return;
        }
      }

      console.warn(
        `[WatcherWorker] Catch-up page limit reached for ${wallet.publicKey.substring(0, 8)}..., resuming next poll from ${cursor}`,
      );
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.end();
      throw err;
    }
  });
}

export const handleStreamRecord = processPaymentRecord;

export type StreamHandlerOptions = {
  onmessage: (record: any) => Promise<void>;
  onerror: (error: any) => void;
};

export type StreamConnector = (
  cursor: string,
  handlers: StreamHandlerOptions
) => () => void;

export type StartHorizonSSEStreamOptions = {
  connector?: StreamConnector;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
};

export async function startHorizonSSEStream(
  wallet: { id: string; publicKey: string; userId?: string },
  options: StartHorizonSSEStreamOptions = {}
): Promise<() => void> {
  return tracer.startActiveSpan('watcher.startHorizonSSEStream', async (span) => {
    let isClosed = false;
    let attempts = 1;
    let currentClose: (() => void) | null = null;
    let heartbeatTimeout: NodeJS.Timeout | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const noopClose = () => {};

    if (!wallet.publicKey || !wallet.publicKey.startsWith('G')) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid public key' });
      span.end();
      return noopClose;
    }

    const maxAttempts = options.maxReconnectAttempts ?? Infinity;
    const reconnectDelay = options.reconnectDelayMs ?? 1000;

    const defaultConnector: StreamConnector = (cursor, handlers) => {
      return stellar.server
        .payments()
        .forAccount(wallet.publicKey)
        .cursor(cursor)
        .stream(handlers) as unknown as () => void;
    };

    const connector = options.connector ?? defaultConnector;

    const cleanupCurrent = () => {
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (currentClose) {
        try {
          currentClose();
        } catch {}
        currentClose = null;
      }
    };

    const resetHeartbeat = () => {
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(() => {
        console.warn(`[WatcherStream] ⚠️ Heartbeat timeout for ${wallet.publicKey.substring(0, 8)}... Reconnecting...`);
        connect();
      }, 60000);
    };

    const connect = async () => {
      if (isClosed) return;
      cleanupCurrent();

      try {
        const cursor = await ensureCursor(wallet);
        let lastPagingToken: string | null = cursor;
        resetHeartbeat();

        const handlers: StreamHandlerOptions = {
          onmessage: async (record: any) => {
            resetHeartbeat();
            attempts = 1;
            console.log(`[WatcherStream] ⚡ Live SSE stream message received: ${record.type}`);
            await processPaymentRecord(wallet, record, { previousPagingToken: lastPagingToken });
            if (record.paging_token) {
              lastPagingToken = record.paging_token;
            }
          },
          onerror: (error: any) => {
            console.error(`[WatcherStream] SSE stream error for ${wallet.publicKey.substring(0, 8)}...:`, error);
            cleanupCurrent();
            if (isClosed) return;
            if (attempts < maxAttempts) {
              attempts++;
              reconnectTimeout = setTimeout(() => {
                connect();
              }, reconnectDelay);
            }
          },
        };

        currentClose = connector(cursor, handlers);
      } catch (err: any) {
        console.error(`[WatcherStream] Failed to open SSE stream: ${err.message}`);
      }
    };

    try {
      await connect();
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    } catch (err: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
    }

    return () => {
      isClosed = true;
      cleanupCurrent();
    };
  });
}

/**
 * Logs the reason, stops the memory monitor's own timer, and exits the
 * process so the supervisor (workers/supervisor.ts) respawns it fresh with
 * a clean heap — a controlled exit chosen before the OS OOM-kills the
 * process mid-request, not an uncontrolled crash.
 */
export function gracefulRestart(reason: string, snapshot: MemorySnapshot): void {
  console.error(
    `[WatcherWorker] 💥 Initiating graceful restart: ${reason} ` +
      `(heap ${(snapshot.usageRatio * 100).toFixed(1)}%, ${Math.round(snapshot.heapUsed / 1024 / 1024)}MB used)`,
  );
  memoryMonitor?.stop();
  // setImmediate gives the error log above a turn of the event loop to
  // flush to stdout/stderr before the process exits.
  setImmediate(() => process.exit(1));
}

export function startMemoryMonitor(): MemoryMonitor {
  const monitor = new MemoryMonitor({
    onCleanup: (snapshot, gcRan) => {
      console.warn(
        `[WatcherWorker] Heap cleanup pass ${gcRan ? "ran" : "skipped (start with --expose-gc to enable it)"} ` +
          `at ${(snapshot.usageRatio * 100).toFixed(1)}% usage.`,
      );
    },
    onRestartRequired: (snapshot) => gracefulRestart("sustained high heap usage", snapshot),
  });
  monitor.start();
  memoryMonitor = monitor;
  return monitor;
}

/**
 * Concurrently processes wallets using a bounded worker pool to prevent starvation (#309).
 */
export async function processWalletsConcurrently(
  wallets: Array<{ id: string; publicKey: string; userId?: string }>,
  concurrency = env.WATCHER_WALLET_CONCURRENCY,
): Promise<void> {
  const queue = [...wallets];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const wallet = queue.shift();
      if (!wallet) break;
      try {
        await processWalletPayments({ id: wallet.id, publicKey: wallet.publicKey, userId: wallet.userId });
      } catch (err: any) {
        console.error(`[WatcherWorker] Error processing wallet ${wallet.publicKey}:`, err.message || err);
      }
    }
  });
  await Promise.all(workers);
}

export async function pollOnce() {
  return tracer.startActiveSpan('watcher.pollOnce', async (pollSpan) => {
    try {
      const wallets = await prisma.wallet.findMany();
      if (wallets.length === 0) {
        pollSpan.setStatus({ code: SpanStatusCode.OK });
        pollSpan.end();
        return;
      }
      await processWalletsConcurrently(wallets, env.WATCHER_WALLET_CONCURRENCY);
      const contractIds = getActiveContractIds();
      if (contractIds.length > 0) {
        for (const contractId of contractIds) {
          try {
            await processSorobanContractEvents(contractId);
          } catch (err: any) {
            console.error(`[WatcherWorker] Error processing contract ${contractId}:`, err.message || err);
          }
        }
      }
      pollSpan.setStatus({ code: SpanStatusCode.OK });
    } catch (err: any) {
      console.error('[WatcherWorker] Error in pollOnce:', err.message || err);
      pollSpan.setStatus({ code: SpanStatusCode.OK });
    } finally {
      pollSpan.end();
    }
  });
}

export async function runWatcher() {
  console.log("[WatcherWorker] 🚀 Starting Stellar Testnet Watcher Worker...");

  startMemoryMonitor();

  await loadContractRegistry();

  const poll = async () => {
    return tracer.startActiveSpan('watcher.poll', async (pollSpan) => {
      try {
        const wallets = await prisma.wallet.findMany();
        if (wallets.length === 0) {
          console.log(
            "[WatcherWorker] No wallets registered in DB to watch. Waiting for next poll...",
          );
          pollSpan.setStatus({ code: SpanStatusCode.OK });
          pollSpan.end();
          return;
        }

        console.log(
          `[WatcherWorker] Checking ${wallets.length} registered wallet(s) with concurrency=${env.WATCHER_WALLET_CONCURRENCY}...`,
        );
        await processWalletsConcurrently(wallets, env.WATCHER_WALLET_CONCURRENCY);

        const contractIds = getActiveContractIds();
        if (contractIds.length > 0) {
          console.log(
            `[WatcherWorker] Processing ${contractIds.length} Soroban contract subscriptions...`,
          );
          for (const contractId of contractIds) {
            await processSorobanContractEvents(contractId);
          }
        }
        pollSpan.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        pollSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        pollSpan.end();
      }
    });
  };

  await poll();

  setInterval(poll, 30000);

  setInterval(() => {
    loadContractRegistry();
  }, 300000);
}

async function processSorobanContractEvents(contractId: string) {
  return tracer.startActiveSpan('watcher.processSorobanContractEvents', async (span) => {
    try {
      span.setAttribute('contract.id', contractId);
      const latestLedger = await getSorobanLatestLedger();
      if (latestLedger === 0) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return;
      }

      const lastSnapshot = await prisma.sorobanEventSnapshot.findFirst({
        where: { contractId },
        orderBy: { ledgerSeq: "desc" },
        select: { ledgerSeq: true },
      });

      const startLedger = lastSnapshot
        ? lastSnapshot.ledgerSeq + 1
        : latestLedger - 1000;
      if (startLedger > latestLedger) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return;
      }

      const { fetchContractEventsInRange } = await import("../lib/soroban");

      for await (const eventBatch of fetchContractEventsInRange(
        contractId,
        startLedger,
        latestLedger,
      )) {
        for (const event of eventBatch) {
          const parsed = parseSacTransferEvent(event);
          if (!parsed) continue;

          const routes = routeEventToUsers(event);

          for (const route of routes) {
            console.log(
              `[SorobanRouter] Event ${route.topic} from ${contractId.substring(0, 8)}... routed to ${route.userIds.length} user(s)`,
            );

            try {
              await prisma.sorobanEventSnapshot.upsert({
                where: {
                  contractId_ledgerSeq_from_to_amount: {
                    contractId: parsed.contractId,
                    ledgerSeq: (parsed as any).ledgerSeq || event.ledgerSeq || 0,
                    from: parsed.from,
                    to: parsed.to,
                    amount: parsed.amount,
                  },
                },
                create: {
                  contractId: parsed.contractId,
                  from: parsed.from,
                  to: parsed.to,
                  amount: parsed.amount,
                  ledgerSeq: (parsed as any).ledgerSeq || event.ledgerSeq || 0,
                },
                update: {},
              });
            } catch (err: any) {
              if (err.code !== "P2025") {
                console.warn(
                  "[SorobanRouter] Error storing event snapshot:",
                  err.message,
                );
              }
            }
          }
        }
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error: any) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      console.error(
        `[SorobanRouter] Error processing contract ${contractId}:`,
        error.message,
      );
    } finally {
      span.end();
    }
  });
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  startMemoryMonitor();
  runWatcher();
}
