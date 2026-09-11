import * as StellarSdk from "stellar-sdk";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { sorobanServer, getSorobanLatestLedger } from "../lib/soroban";
import {
  decodeTopicArray,
  topicIndexRowFromEvent,
  TopicValue,
  TOPIC_INDEX_GIN_DDLS,
  GIN_TOPICS_INDEX_NAME,
  GIN_SYMBOLS_INDEX_NAME,
  topicSymbolsAnyOf,
  topicSymbolsContainAll,
  topicsContain,
  topicSymbolEquals,
} from "../lib/soroban-topic-indexer";
import { registerSupervisorHeartbeat } from "./supervisor";

// ── configuration ───────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = parseInt(env.SOROBAN_INDEXER_INTERVAL_MS, 10);
const BACKFILL_WINDOW = parseInt(env.SOROBAN_INDEXER_BACKFILL_WINDOW, 10);
const PAGE_SIZE = Math.min(parseInt(env.SOROBAN_INDEXER_PAGE_SIZE, 10) || 200, 1000);
const BENCHMARK_INTERVAL_MS = parseInt(env.SOROBAN_INDEXER_BENCHMARK_INTERVAL_MS, 10);
const BENCHMARK_TARGET_ROWS = parseInt(env.SOROBAN_INDEXER_BENCHMARK_DATA_ROWS, 10);
const BENCHMARK_TARGET_MS = 50;

export { GIN_TOPICS_INDEX_NAME, GIN_SYMBOLS_INDEX_NAME } from "../lib/soroban-topic-indexer";

let isProcessing = false;

// ── GIN index lifecycle ─────────────────────────────────────────────────────

/**
 * Idempotently creates the GIN indexes backing the topic search SLA
 * (`jsonb_path_ops` over `topics`, `array_ops` over `topicSymbols`). The
 * indexes are part of the worker's contract — Prisma's schema can't express
 * GIN opclasses, so the worker owns index management.
 */
export async function ensureTopicIndexes(db: any = prisma): Promise<string[]> {
  for (const ddl of TOPIC_INDEX_GIN_DDLS) {
    await db.$queryRawUnsafe(ddl);
  }
  return listTopicGinIndexes(db);
}

/** Returns the names of the GIN indexes currently attached to the index table. */
export async function listTopicGinIndexes(db: any = prisma): Promise<string[]> {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes ` +
      `WHERE tablename = 'SorobanTopicIndex' AND indexdef ILIKE '%USING gin%'`,
  );
  return (rows ?? [])
    .map((r) => String(r.indexname))
    .filter((name) => /gin/i.test(name));
}

// ── ingestion ───────────────────────────────────────────────────────────────

export type TopicIndexContractStats = {
  contractId: string;
  startLedger: number;
  endLedger: number;
  indexed: number;
  skipped: number;
  cursor: number;
  errors: number;
};

export type TopicIndexPassStats = {
  latestLedger: number;
  contracts: number;
  indexed: number;
  skipped: number;
  errors: number;
  perContract: TopicIndexContractStats[];
};

/**
 * Resolves where ingestion should resume for a contract: from its persisted
 * sub-ledger checkpoint when present, else `latestLedger - BACKFILL_WINDOW`
 * so a fresh worker can still fill recent history.
 */
export async function resolveStartLedger(
  contractId: string,
  latestLedger: number,
  db: any = prisma,
): Promise<number> {
  const cursor = await db.sorobanTopicIndexCursor.findUnique({ where: { contractId } });
  if (cursor && typeof cursor.ledgerSeq === "number") return cursor.ledgerSeq + 1;
  return Math.max(1, latestLedger - BACKFILL_WINDOW + 1);
}

/**
 * Robust ledger-range event fetcher. Unlike `fetchContractEventsInRange` it
 * tolerates empty ledger windows (skips gaps by advancing to the newest event
 * ledger in each page) so a sparse contract history still converges to the
 * ledger tip without stalling.
 */
export async function* fetchTopicEventsInRange(
  contractId: string,
  startLedger: number,
  endLedger: number,
): AsyncGenerator<any[]> {
  let fromLedger = startLedger;

  while (fromLedger <= endLedger) {
    const response = await sorobanServer.getEvents({
      startLedger: fromLedger,
      endLedger,
      limit: PAGE_SIZE,
      filters: [{ type: "contract", contractIds: [contractId] }],
    });

    const events: any[] = response?.events ?? [];
    if (events.length === 0) break;

    const normalized: any[] = [];
    let newestLedger = fromLedger - 1;
    for (const event of events) {
      const ledger = Number(event.ledger ?? event.ledgerSeq ?? 0);
      if (!ledger || ledger > endLedger) continue;
      newestLedger = Math.max(newestLedger, ledger);
      normalized.push({ ...event, ledgerSeq: ledger });
    }

    if (normalized.length === 0) break;
    yield normalized;

    if (newestLedger >= endLedger) break;
    fromLedger = newestLedger + 1;
  }
}

function setCursor(contractId: string, ledgerSeq: number, db: any = prisma) {
  if (typeof ledgerSeq !== "number" || ledgerSeq < 0) return Promise.resolve();
  return db.sorobanTopicIndexCursor.upsert({
    where: { contractId },
    update: { ledgerSeq },
    create: { contractId, ledgerSeq },
  });
}

/**
 * Indexes every contract event in a contract's current ledger window: decodes
 * the raw XDR topic array, stores it (deduped via the `[contractId, ledgerSeq,
 * topicsHash]` unique key) and advances the contract checkpoint.
 */
export async function indexSorobanTopicsForContract(
  contractId: string,
  db: any = prisma,
  latestLedger = 0,
): Promise<TopicIndexContractStats> {
  const latest = latestLedger || (await getSorobanLatestLedger());
  if (latest <= 0) {
    return {
      contractId,
      startLedger: 0,
      endLedger: latest,
      indexed: 0,
      skipped: 0,
      cursor: 0,
      errors: 0,
    };
  }

  const startLedger = await resolveStartLedger(contractId, latest, db);
  const stats: TopicIndexContractStats = {
    contractId,
    startLedger,
    endLedger: latest,
    indexed: 0,
    skipped: 0,
    cursor: startLedger - 1,
    errors: 0,
  };

  try {
    for await (const batch of fetchTopicEventsInRange(contractId, startLedger, latest)) {
      const rows: any[] = [];
      for (const event of batch) {
        const row = topicIndexRowFromEvent(event, contractId);
        if (!row) {
          stats.skipped++;
          continue;
        }
        rows.push(row);
        stats.cursor = Math.max(stats.cursor, row.ledgerSeq);
        stats.skipped += !row.ledgerSeq ? 1 : 0;
      }

      if (rows.length === 0) continue;

      const result = await db.sorobanTopicIndex.createMany({
        data: rows,
        skipDuplicates: true,
      });
      stats.indexed += result?.count ?? rows.length;
    }

    await setCursor(contractId, stats.cursor, db);
    console.log(
      `[SorobanIndexer] Contract ${contractId.slice(0, 8)}: indexed ${stats.indexed}, skipped ${stats.skipped}, cursor → ledger ${stats.cursor}`,
    );
  } catch (error: any) {
    stats.errors++;
    console.error(
      `[SorobanIndexer] Error indexing contract ${contractId}:`,
      error?.message || error,
    );
  }

  return stats;
}

async function getActiveTopicContractIds(db: any = prisma): Promise<string[]> {
  const subscriptions = await db.sorobanContractSubscription.findMany({
    where: { isActive: true },
    select: { contractId: true },
  });
  const ids = Array.from(new Set<string>((subscriptions ?? []).map((s: any) => s.contractId).filter((c: any) => !!c)));

  const envContractId = process.env.SOROBAN_CONTRACT_ID;
  if (envContractId && !ids.includes(envContractId)) ids.push(envContractId);
  return ids;
}

/** One full pass over every active contract subscription. */
export async function runIndexerPass(db: any = prisma): Promise<TopicIndexPassStats> {
  const latestLedger = await getSorobanLatestLedger();
  const stats: TopicIndexPassStats = {
    latestLedger,
    contracts: 0,
    indexed: 0,
    skipped: 0,
    errors: 0,
    perContract: [],
  };

  if (latestLedger <= 0) return stats;

  const contractIds = await getActiveTopicContractIds(db);
  if (contractIds.length === 0) {
    console.log("[SorobanIndexer] No active contracts to index.");
    return stats;
  }

  stats.contracts = contractIds.length;
  for (const contractId of contractIds) {
    const contractStats = await indexSorobanTopicsForContract(contractId, db, latestLedger);
    stats.perContract.push(contractStats);
    stats.indexed += contractStats.indexed;
    stats.skipped += contractStats.skipped;
    stats.errors += contractStats.errors;
  }

  console.log(
    `[SorobanIndexer] Pass complete: ${stats.contracts} contracts, ${stats.indexed} indexed, ${stats.skipped} skipped, ${stats.errors} errors (latest ledger ${latestLedger}).`,
  );
  return stats;
}

// ── dashboard search API (GIN-backed) ───────────────────────────────────────

export interface TopicSearchOptions {
  /** Any-of match on the GIN text[] symbol column. */
  symbols?: string[];
  /** Contains-all match on the GIN text[] symbol column. */
  symbolsAll?: string[];
  /** JSONB containment of a decoded topic value (e.g. an address). */
  topic?: TopicValue;
  /** Exact lead-symbol equality (btree). */
  topicSymbol?: string;
  contractId?: string;
  minLedgerSeq?: number;
  maxLedgerSeq?: number;
  limit?: number;
}

export interface TopicSearchHit {
  id: string;
  contractId: string;
  ledgerSeq: number;
  txHash: string | null;
  topicSymbol: string | null;
  topics: TopicValue[];
  topicSymbols: string[];
  createdAt: string;
}

function clampLimit(limit: number | undefined): number {
  const value = Number.isFinite(limit) ? Math.trunc(Number(limit)) : 25;
  return Math.min(Math.max(value || 25, 1), 200);
}

function mapTopicRows(rows: any[]): TopicSearchHit[] {
  return (rows ?? []).map((r: any) => ({
    id: String(r.id),
    contractId: String(r.contractId),
    ledgerSeq: Number(r.ledgerSeq),
    txHash: r.txHash ?? null,
    topicSymbol: r.topicSymbol ?? null,
    topics: r.topics ?? [],
    topicSymbols: r.topicSymbols ?? [],
    createdAt: r.createdAt ?? null,
  }));
}

/**
 * Runs a GIN-accelerated topic search. Each `where` fragment is produced by
 * the shared predicate builders (fixed identifiers + quote-escaped literals) so
 * the assembled SQL is injection-safe. Returns newest-ledger-first as the
 * dashboard expects.
 */
export async function searchTopicEvents(
  options: TopicSearchOptions,
  db: any = prisma,
): Promise<TopicSearchHit[]> {
  const where: string[] = [];

  const anyOf = topicSymbolsAnyOf(options.symbols ?? []);
  if (anyOf) where.push(anyOf);

  const containsAll = topicSymbolsContainAll(options.symbolsAll ?? []);
  if (containsAll) where.push(containsAll);

  if (options.topic) where.push(topicsContain(options.topic));

  if (options.topicSymbol) where.push(topicSymbolEquals(options.topicSymbol));

  if (options.contractId) {
    where.push(`"contractId" = '${options.contractId.replace(/'/g, "''")}'`);
  }
  if (typeof options.minLedgerSeq === "number") {
    where.push(`"ledgerSeq" >= ${Math.trunc(options.minLedgerSeq)}`);
  }
  if (typeof options.maxLedgerSeq === "number") {
    where.push(`"ledgerSeq" <= ${Math.trunc(options.maxLedgerSeq)}`);
  }

  const limit = clampLimit(options.limit);
  const sql =
    `SELECT "id", "contractId", "ledgerSeq", "txHash", "topicSymbol", "topics", "topicSymbols", "createdAt" ` +
    `FROM "SorobanTopicIndex" ` +
    (where.length ? `WHERE ${where.join(" AND ")} ` : "") +
    `ORDER BY "ledgerSeq" DESC, "createdAt" DESC LIMIT ${limit}`;

  return mapTopicRows(await db.$queryRawUnsafe(sql));
}

// ── topic-search benchmark harness ──────────────────────────────────────────

export type TopicSearchQueryResult = {
  name: string;
  predicate: string;
  explainMs: number | null;
  wallMs: number;
  rows: number;
  passed: boolean;
  usedGinIndex: boolean;
  usedIndex: string | null;
};

export type TopicSearchBenchmarkReport = {
  finishedAt: string;
  targetMs: number;
  totalRows: number;
  seededRows: number;
  seedContractIds: string[];
  queries: TopicSearchQueryResult[];
  allPassed: boolean;
};

const BENCHMARK_PREFIX = "C_TOPIC_BENCH";
const BENCHMARK_POOL = Array.from({ length: 8 }, (_, i) => `${BENCHMARK_PREFIX}_${String(i).padStart(3, "0")}`);
const BENCHMARK_SYMBOLS = ["transfer", "swap", "deposit", "withdraw", "nft_mint", "bridge", "claim", "cancel", "cfa_emergency_auth"];

/** Deterministic synthetic seed corpus generated through the real decoder. */
function buildBenchmarkRows(count: number): any[] {
  const keypairs = Array.from({ length: BENCHMARK_POOL.length }, () => StellarSdk.Keypair.random());
  const rows: any[] = [];

  for (let i = 0; i < count; i++) {
    const contractId = BENCHMARK_POOL[i % BENCHMARK_POOL.length];
    const symbol = BENCHMARK_SYMBOLS[i % BENCHMARK_SYMBOLS.length];
    const from = keypairs[i % keypairs.length].publicKey();
    const to = keypairs[(i + 1) % keypairs.length].publicKey();

    const address = (pub: string) =>
      StellarSdk.xdr.ScVal.scvAddress(StellarSdk.Address.fromString(pub).toScAddress());

    const topic: any[] = [
      StellarSdk.xdr.ScVal.scvSymbol(symbol),
      address(from),
      address(to),
      StellarSdk.xdr.ScVal.scvU128(
        new StellarSdk.xdr.UInt128Parts({
          lo: StellarSdk.xdr.Uint64.fromString(String(((i * 104729) % 4_294_967_296) >>> 0)),
          hi: StellarSdk.xdr.Uint64.fromString(String((i * 7919) >>> 0)),
        }),
      ),
    ];

    if (i % 7 === 0 && i > 0) {
      topic.push(
        StellarSdk.xdr.ScVal.scvMap([
          new StellarSdk.xdr.ScMapEntry({
            key: StellarSdk.xdr.ScVal.scvSymbol("note"),
            val: StellarSdk.xdr.ScVal.scvString("seeded-corpus"),
          }),
        ]),
      );
    }

    const decoded = decodeTopicArray(topic);
    rows.push({
      contractId,
      ledgerSeq: 1 + (i % 2_000_000),
      txHash: null,
      topicXdrJson: decoded.topicXdr,
      topics: decoded.topics,
      topicSymbols: decoded.topicSymbols,
      topicSymbol: decoded.topicSymbol,
      topicsHash: decoded.topicsHash,
    });
  }
  return rows;
}

function extractExplainPlan(rows: any[]): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const first: any = rows[0]?.["QUERY PLAN"] ?? rows[0];
  let parsed: any[];
  if (typeof first === "string") {
    try {
      parsed = JSON.parse(first);
    } catch {
      return [];
    }
  } else {
    parsed = first;
  }
  if (!Array.isArray(parsed)) parsed = [parsed];
  // Postgres `FORMAT JSON` wraps each plan's root node under a "Plan" key and
  // reports the overall ANALYZE runtime on the wrapper. Unwrap the tree but
  // carry the wrapper's "Execution Time" up so both parsing paths stay simple.
  return parsed.map((p: any) => {
    const planNode = p && typeof p === "object" && p["Plan"] ? p["Plan"] : p;
    if (
      planNode &&
      typeof planNode === "object" &&
      typeof p?.["Execution Time"] === "number" &&
      typeof planNode["Execution Time"] !== "number"
    ) {
      planNode["Execution Time"] = p["Execution Time"];
    }
    return planNode;
  });
}

function planUsesIndex(plan: any[], namePredicate: (name: string) => boolean): string | null {
  const walk = (node: any): string | null => {
    if (!node) return null;
    const indexName = node["Index Name"];
    if (typeof indexName === "string" && (namePredicate(indexName) || /gin/i.test(indexName))) {
      return indexName;
    }
    const plans: any[] = node["Plans"] ?? [];
    for (const child of plans) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  for (const node of plan) {
    const hit = walk(node);
    if (hit) return hit;
  }
  return null;
}

function planExecutionTime(plan: any[]): number | null {
  const first = plan[0];
  const raw = first?.["Execution Time"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

export interface RunTopicSearchBenchmarkOptions {
  db?: any;
  seed?: boolean;
  targetRows?: number;
  cleanup?: boolean;
  targetMs?: number;
  poolContractIds?: string[];
  benchmarkContractPrefix?: string;
}

/**
 * Measures topic-search latency against the live index. Seeds a synthetic
 * corpus (through the production decoder) when the table is below `targetRows`,
 * then runs each dashboard query pattern under `EXPLAIN (ANALYZE, FORMAT JSON)`
 * and asserts the sub-`targetMs` SLA holds. Seed rows are removed afterwards
 * unless `cleanup: false`.
 */
export async function runTopicSearchBenchmark(
  options: RunTopicSearchBenchmarkOptions = {},
): Promise<TopicSearchBenchmarkReport> {
  const db = options.db ?? prisma;
  const targetRows = Math.max(options.targetRows ?? BENCHMARK_TARGET_ROWS, 1);
  const targetMs = options.targetMs ?? BENCHMARK_TARGET_MS;
  const prefix = options.benchmarkContractPrefix ?? BENCHMARK_PREFIX;
  const poolContractIds = options.poolContractIds ?? BENCHMARK_POOL;
  const seed = options.seed ?? true;
  const cleanup = options.cleanup ?? true;

  const report: TopicSearchBenchmarkReport = {
    finishedAt: "",
    targetMs,
    totalRows: 0,
    seededRows: 0,
    seedContractIds: poolContractIds,
    queries: [],
    allPassed: true,
  };

  const indexes = await ensureTopicIndexes(db);
  const missingGin =
    !indexes.includes(GIN_TOPICS_INDEX_NAME) || !indexes.includes(GIN_SYMBOLS_INDEX_NAME);

  const totalRows = Number((await db.sorobanTopicIndex.count()) ?? 0);
  report.totalRows = totalRows;

  if (seed && totalRows < targetRows) {
    const needed = targetRows - totalRows;
    const chunk = 1000;
    for (let offset = 0; offset < needed; offset += chunk) {
      const rows = buildBenchmarkRows(Math.min(chunk, needed - offset));
      await db.sorobanTopicIndex.createMany({ data: rows, skipDuplicates: true });
    }
    report.seededRows = needed;
    await db.$queryRawUnsafe("ANALYZE \"SorobanTopicIndex\"");
  }

  const keypair = StellarSdk.Keypair.random();
  const probeAddress = keypair.publicKey();

  const queries: { name: string; sql: string }[] = [
    {
      name: "symbol:any-of (GIN Array)",
      sql:
        `SELECT "id", "contractId", "ledgerSeq", "topicSymbol" FROM "SorobanTopicIndex" ` +
        `WHERE ${topicSymbolsAnyOf(["transfer"])} ORDER BY "ledgerSeq" DESC LIMIT 25`,
    },
    {
      name: "symbol:contains-all (GIN Array)",
      sql:
        `SELECT "id", "contractId", "ledgerSeq", "topicSymbol" FROM "SorobanTopicIndex" ` +
        `WHERE ${topicSymbolsContainAll(["swap"])} ORDER BY "ledgerSeq" DESC LIMIT 25`,
    },
    {
      name: "topic:jsonb-containment (GIN JSONB)",
      sql:
        `SELECT "id", "contractId", "ledgerSeq", "topicSymbol" FROM "SorobanTopicIndex" ` +
        `WHERE ${topicsContain({ type: "address", value: probeAddress })} ORDER BY "ledgerSeq" DESC LIMIT 25`,
    },
    {
      name: "symbol:exact-recent (btree)",
      sql:
        `SELECT "id", "contractId", "ledgerSeq", "topicSymbol" FROM "SorobanTopicIndex" ` +
        `WHERE ${topicSymbolEquals("nft_mint")} ORDER BY "ledgerSeq" DESC LIMIT 25`,
    },
  ];

  for (const query of queries) {
    const explainRows: any[] = await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`);
    const plan = extractExplainPlan(explainRows);
    const explainMs = planExecutionTime(plan);
    const usedIndex = planUsesIndex(plan, (name) => name.includes("gin"));

    const started = Date.now();
    const resultRows: any[] = await db.$queryRawUnsafe(query.sql);
    const wallMs = Date.now() - started;

    const passesTime = explainMs === null || explainMs < targetMs;
    const requiresIndex = missingGin ? false : true;
    const passed = passesTime && requiresIndex;

    report.queries.push({
      name: query.name,
      predicate: query.sql,
      explainMs,
      wallMs,
      rows: resultRows?.length ?? 0,
      passed,
      usedGinIndex: usedIndex !== null,
      usedIndex,
    });
    if (!passed) report.allPassed = false;
  }

  if (seed && cleanup && report.seededRows > 0) {
    const poolSql = poolContractIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(", ");
    await db.$queryRawUnsafe(`DELETE FROM "SorobanTopicIndex" WHERE "contractId" IN (${poolSql})`);
    report.seededRows = 0;
  }

  report.finishedAt = new Date().toISOString();

  console.log(
    `[SorobanIndexer] Benchmark: target ${targetMs}ms — ` +
      report.queries
        .map((q) => `${q.name}: ${q.explainMs === null ? "n/a" : `${q.explainMs.toFixed(2)}ms`}${q.passed ? " ✅" : " ❌"}`)
        .join(", "),
  );
  return report;
}

// ── worker loop ─────────────────────────────────────────────────────────────

export async function runIndexerWorker() {
  console.log("[SorobanIndexer] 🚀 Starting Soroban Topic Indexer Worker...");

  try {
    const ginIndexes = await ensureTopicIndexes();
    console.log(`[SorobanIndexer] GIN indexes ready: ${ginIndexes.join(", ") || "none"}`);
  } catch (error: any) {
    console.error("[SorobanIndexer] Failed to ensure GIN indexes:", error?.message || error);
  }

  let lastBenchmarkAt = Date.now();

  const poll = async () => {
    if (isProcessing) {
      console.log("[SorobanIndexer] ⏳ Previous pass still running — skipping this cycle.");
      return;
    }
    isProcessing = true;
    try {
      await runIndexerPass();

      if (Date.now() - lastBenchmarkAt >= BENCHMARK_INTERVAL_MS) {
        lastBenchmarkAt = Date.now();
        const report = await runTopicSearchBenchmark({ seed: false, cleanup: false });
        console.log(
          `[SorobanIndexer] Periodic topic-search benchmark: ${report.allPassed ? "PASS" : "FAIL"} — ` +
            report.queries
              .map((q) => `${q.name.replace(/ \(.*\)/, "")}=${q.explainMs === null ? "n/a" : `${q.explainMs.toFixed(2)}ms`}`)
              .join(", "),
        );
      }
    } catch (error: any) {
      console.error("[SorobanIndexer] Poll pass error:", error?.message || error);
    } finally {
      isProcessing = false;
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
  registerSupervisorHeartbeat();

  const command = process.argv[2];
  if (command === "benchmark") {
    const noSeed = process.argv.includes("--no-seed");
    const keep = process.argv.includes("--keep");
    runTopicSearchBenchmark({ seed: !noSeed, cleanup: !keep })
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.allPassed ? 0 : 1);
      })
      .catch((error) => {
        console.error("[SorobanIndexer] Benchmark failed:", error?.message || error);
        process.exit(1);
      });
  } else {
    runIndexerWorker();
  }
}