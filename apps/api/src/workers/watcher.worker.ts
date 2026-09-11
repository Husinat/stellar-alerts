import * as StellarSdk from 'stellar-sdk';
import { prisma, connectWithRetry } from '../lib/prisma';
import { stellar, decodeHorizonAsset, parseSacTransferEvent } from '../lib/stellar';
import { enqueuePaymentAlert } from '../lib/queue';
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
import { trace, SpanStatusCode, TraceFlags } from '@opentelemetry/api';

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
  record: any
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
      if (!existing) {
        const payment = await prisma.payment.create({
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

export async function saveCursor(walletId: string, pagingToken: string) {
  await prisma.ingestionCursor.upsert({
    where: { walletId },
    create: { walletId, pagingToken },
    update: { pagingToken },
  });
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
        const records = (await stellar.getPaymentsSince(
          wallet.publicKey,
          cursor,
          CURSOR_PAGE_SIZE,
        )) as any[];
        if (records.length === 0) {
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return;
        }

        for (const record of records) {
          await processPaymentRecord(wallet, record);
          if (record.paging_token) {
            cursor = record.paging_token;
            await saveCursor(wallet.id, cursor);
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

export async function startHorizonSSEStream(wallet: { id: string; publicKey: string; userId?: string }) {
  return tracer.startActiveSpan('watcher.startHorizonSSEStream', async (span) => {
    try {
      console.log(`[WatcherWorker] 📡 Opening Horizon SSE payment stream for wallet ${wallet.publicKey.substring(0, 8)}...`);

      let timeoutId: NodeJS.Timeout;
      let closeStream: (() => void) | undefined;

      const resetHeartbeat = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          console.warn(`[WatcherStream] ⚠️ Heartbeat timeout for ${wallet.publicKey.substring(0, 8)}... Reconnecting...`);
          if (closeStream) closeStream();
          startHorizonSSEStream(wallet);
        }, 60000);
      };

      try {
        const cursor = await ensureCursor(wallet);
        resetHeartbeat();

        closeStream = stellar.server
          .payments()
          .forAccount(wallet.publicKey)
          .cursor(cursor)
          .stream({
            onmessage: async (record: any) => {
              console.log(
                `[WatcherStream] ⚡ Live SSE stream message received: ${record.type}`,
              );
              await processPaymentRecord(wallet, record);
              if (record.paging_token) {
                await saveCursor(wallet.id, record.paging_token);
              }
            },
            onerror: (error: any) => {
              console.error(
                `[WatcherStream] SSE stream error for ${wallet.publicKey.substring(0, 8)}...:`,
                error,
              );
            },
          }) as unknown as () => void;

        const originalClose = closeStream;
        closeStream = () => {
          clearTimeout(timeoutId);
          if (originalClose) originalClose();
        };

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return closeStream;
      } catch (err: any) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        span.end();
        console.error(`[WatcherStream] Failed to open SSE stream: ${err.message}`);
        clearTimeout(timeoutId!);
        return null;
      }
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.end();
      throw err;
    }
  });
}

let memoryMonitor: MemoryMonitor | null = null;

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
          `[WatcherWorker] Checking ${wallets.length} registered wallet(s)...`,
        );
        for (const wallet of wallets) {
          await processWalletPayments({ id: wallet.id, publicKey: wallet.publicKey, userId: wallet.userId });
        }

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
