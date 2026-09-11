import { describe, it, expect, vi, beforeEach } from "vitest";
import * as StellarSdk from "stellar-sdk";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    sorobanTopicIndex: {
      createMany: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    sorobanTopicIndexCursor: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    sorobanContractSubscription: {
      findMany: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("../../lib/soroban", () => ({
  sorobanServer: { getEvents: vi.fn() },
  getSorobanLatestLedger: vi.fn(),
}));

import { prisma } from "../../lib/prisma";
import { sorobanServer, getSorobanLatestLedger } from "../../lib/soroban";
import {
  ensureTopicIndexes,
  listTopicGinIndexes,
  resolveStartLedger,
  indexSorobanTopicsForContract,
  runIndexerPass,
  fetchTopicEventsInRange,
  searchTopicEvents,
  GIN_TOPICS_INDEX_NAME,
  GIN_SYMBOLS_INDEX_NAME,
} from "../soroban-indexer.worker";

const ALICE = StellarSdk.Keypair.random().publicKey();
const toAddress = (pub: string) =>
  StellarSdk.xdr.ScVal.scvAddress(StellarSdk.Address.fromString(pub).toScAddress());
const symbol = (s: string) => StellarSdk.xdr.ScVal.scvSymbol(s);

function topicBase64(...scvs: any[]): any[] {
  return scvs.map((s) => s.toXDR().toString("base64"));
}

describe("ensureTopicIndexes / listTopicGinIndexes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the GIN DDL statements and reports installed GIN indexes", async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([]) // CREATE INDEX topics
      .mockResolvedValueOnce([]) // CREATE INDEX symbols
      .mockResolvedValueOnce([{ indexname: GIN_TOPICS_INDEX_NAME }, { indexname: GIN_SYMBOLS_INDEX_NAME }]);

    const indexes = await ensureTopicIndexes(prisma);

    expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(1, `CREATE INDEX IF NOT EXISTS "${GIN_TOPICS_INDEX_NAME}" ON "SorobanTopicIndex" USING gin ("topics" jsonb_path_ops)`);
    expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(2, `CREATE INDEX IF NOT EXISTS "${GIN_SYMBOLS_INDEX_NAME}" ON "SorobanTopicIndex" USING gin ("topicSymbols")`);
    expect(indexes).toEqual([GIN_TOPICS_INDEX_NAME, GIN_SYMBOLS_INDEX_NAME]);
  });

  it("listTopicGinIndexes filters to gin indexes only", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      { indexname: GIN_TOPICS_INDEX_NAME },
      { indexname: "SorobanTopicIndex_topicSymbol_idx" },
      { indexname: GIN_SYMBOLS_INDEX_NAME },
    ]);

    expect(await listTopicGinIndexes(prisma)).toEqual([GIN_TOPICS_INDEX_NAME, GIN_SYMBOLS_INDEX_NAME]);
  });
});

describe("resolveStartLedger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes from a persisted cursor + 1", async () => {
    vi.mocked(prisma.sorobanTopicIndexCursor.findUnique).mockResolvedValueOnce({ contractId: "C1", ledgerSeq: 250 });

    expect(await resolveStartLedger("C1", 1000, prisma)).toBe(251);
  });

  it("falls back to a backfill window when no cursor exists", async () => {
    vi.mocked(prisma.sorobanTopicIndexCursor.findUnique).mockResolvedValueOnce(null);

    expect(await resolveStartLedger("C1", 1000, prisma)).toBe(801); // 1000 - 200 + 1? window default
  });
});

describe("fetchTopicEventsInRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("paginates with getEvents and advances past empty gaps to the ledger tip", async () => {
    const eventsA = [
      { ledger: 10, topic: topicBase64(symbol("transfer")), contractId: "C1" },
      { ledger: 10, topic: topicBase64(symbol("transfer")), contractId: "C1" },
    ];
    const eventsB = [
      { ledger: 5000, topic: topicBase64(symbol("swap")), contractId: "C1" },
    ];

    vi.mocked(sorobanServer.getEvents)
      .mockResolvedValueOnce({ events: eventsA })
      .mockResolvedValueOnce({ events: eventsB });

    const batches: any[][] = [];
    for await (const batch of fetchTopicEventsInRange("C1", 1, 5000)) {
      batches.push(batch);
    }

    expect(sorobanServer.getEvents).toHaveBeenCalledTimes(2);
    expect(sorobanServer.getEvents).toHaveBeenNthCalledWith(1, {
      startLedger: 1,
      endLedger: 5000,
      limit: 200,
      filters: [{ type: "contract", contractIds: ["C1"] }],
    });
    expect(sorobanServer.getEvents).toHaveBeenNthCalledWith(2, {
      startLedger: 11,
      endLedger: 5000,
      limit: 200,
      filters: [{ type: "contract", contractIds: ["C1"] }],
    });
    expect(batches).toHaveLength(2);
    expect(batches[0].map((e) => e.ledgerSeq)).toEqual([10, 10]);
    expect(batches[1].map((e) => e.ledgerSeq)).toEqual([5000]);
  });

  it("stops when the server returns no further events", async () => {
    vi.mocked(sorobanServer.getEvents).mockResolvedValueOnce({ events: [] });

    const batches: any[][] = [];
    for await (const batch of fetchTopicEventsInRange("C1", 1, 100)) batches.push(batch);

    expect(batches).toEqual([]);
    expect(sorobanServer.getEvents).toHaveBeenCalledTimes(1);
  });
});

describe("indexSorobanTopicsForContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes + stores indexed rows and advances the cursor", async () => {
    vi.mocked(prisma.sorobanTopicIndexCursor.findUnique).mockResolvedValueOnce(null);
    const events = [
      { ledger: 301, txHash: "tx-1", topic: topicBase64(symbol("transfer"), toAddress(ALICE)) },
      { ledger: 302, txHash: "tx-2", topic: topicBase64(symbol("swap"), toAddress(ALICE)) },
    ];
    vi.mocked(sorobanServer.getEvents).mockResolvedValueOnce({ events });
    vi.mocked(prisma.sorobanTopicIndex.createMany).mockResolvedValueOnce({ count: 2 });
    vi.mocked(prisma.sorobanTopicIndexCursor.upsert).mockResolvedValueOnce({ contractId: "C1", ledgerSeq: 302 });

    const stats = await indexSorobanTopicsForContract("C1", prisma, 500);

    expect(stats.indexed).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stats.cursor).toBe(302);
    expect(prisma.sorobanTopicIndex.createMany).toHaveBeenCalledTimes(1);

    const { data, skipDuplicates } = vi.mocked(prisma.sorobanTopicIndex.createMany).mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0].contractId).toBe("C1");
    expect(data[0].ledgerSeq).toBe(301);
    expect(data[0].txHash).toBe("tx-1");
    expect(data[0].topicSymbol).toBe("transfer");
    expect(data[0].topicSymbols).toEqual(["transfer"]);
    expect(data[0].topicsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.sorobanTopicIndexCursor.upsert).toHaveBeenCalledWith({
      where: { contractId: "C1" },
      update: { ledgerSeq: 302 },
      create: { contractId: "C1", ledgerSeq: 302 },
    });
  });

  it("skips events with no topic array and still persists a cursor", async () => {
    vi.mocked(prisma.sorobanTopicIndexCursor.findUnique).mockResolvedValueOnce({ contractId: "C1", ledgerSeq: 50 });
    const events = [
      { ledger: 60, topic: topicBase64(symbol("transfer")) },
      { ledger: 61, topic: [] },
      { ledger: 62 }, // no topic field at all
    ];
    vi.mocked(sorobanServer.getEvents).mockResolvedValueOnce({ events });
    vi.mocked(prisma.sorobanTopicIndex.createMany).mockResolvedValueOnce({ count: 1 });
    vi.mocked(prisma.sorobanTopicIndexCursor.upsert).mockResolvedValueOnce({ contractId: "C1", ledgerSeq: 60 });

    const stats = await indexSorobanTopicsForContract("C1", prisma, 100);

    expect(stats.indexed).toBe(1);
    expect(prisma.sorobanTopicIndex.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(prisma.sorobanTopicIndexCursor.upsert).toHaveBeenCalled();
  });

  it("tolerates RPC failure without throwing but records the error", async () => {
    vi.mocked(prisma.sorobanTopicIndexCursor.findUnique).mockResolvedValueOnce(null);
    vi.mocked(sorobanServer.getEvents).mockRejectedValueOnce(new Error("boom"));

    const stats = await indexSorobanTopicsForContract("C1", prisma, 500);

    expect(stats.errors).toBe(1);
    expect(prisma.sorobanTopicIndexCursor.upsert).not.toHaveBeenCalled();
  });
});

describe("runIndexerPass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("indexes every active contract and aggregates stats", async () => {
    vi.mocked(getSorobanLatestLedger).mockResolvedValueOnce(1000);
    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce([
      { contractId: "C1" },
      { contractId: "C1" },
      { contractId: "C2" },
    ]);
    vi.mocked(prisma.sorobanTopicIndexCursor.findUnique).mockResolvedValueOnce(null);
    vi.mocked(sorobanServer.getEvents).mockResolvedValueOnce({ events: [] });
    vi.mocked(prisma.sorobanTopicIndex.createMany).mockResolvedValue({ count: 0 });

    const stats = await runIndexerPass(prisma);

    expect(stats.latestLedger).toBe(1000);
    expect(stats.contracts).toBe(2); // deduplicated
    expect(stats.perContract.map((s) => s.contractId).sort()).toEqual(["C1", "C2"]);
  });

  it("short-circuits cleanly when there are no active subscriptions", async () => {
    vi.mocked(getSorobanLatestLedger).mockResolvedValueOnce(1000);
    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce([]);

    const stats = await runIndexerPass(prisma);

    expect(stats.contracts).toBe(0);
    expect(sorobanServer.getEvents).not.toHaveBeenCalled();
  });
});

describe("searchTopicEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("composes GIN-backed predicates and maps rows newest-first", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      { id: "a", contractId: "C1", ledgerSeq: 900, txHash: "tx", topicSymbol: "transfer", topics: [], topicSymbols: ["transfer"], createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const hits = await searchTopicEvents(
      { symbols: ["transfer"], topic: { type: "address", value: ALICE }, contractId: "C1", maxLedgerSeq: 1000, limit: 3 },
      prisma,
    );

    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(sql).toContain('"topicSymbols" && ARRAY[\'transfer\']::text[]');
    expect(sql).toContain(`"topics" @> '[{"type":"address","value":"${ALICE}"}]'::jsonb`);
    expect(sql).toContain(`"contractId" = 'C1'`);
    expect(sql).toContain(`"ledgerSeq" <= 1000`);
    expect(sql).toContain(`ORDER BY "ledgerSeq" DESC, "createdAt" DESC LIMIT 3`);
    expect(hits).toHaveLength(1);
    expect(hits[0].ledgerSeq).toBe(900);
  });

  it("escapes single quotes in symbol literals", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]);

    await searchTopicEvents({ symbols: ["it's_a_symbol"] }, prisma);

    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(sql).toContain("ARRAY['it''s_a_symbol']::text[]");
  });
});