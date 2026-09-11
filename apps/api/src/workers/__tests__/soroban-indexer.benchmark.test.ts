import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    sorobanTopicIndex: {
      createMany: vi.fn(),
      count: vi.fn(),
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
import { runTopicSearchBenchmark, GIN_TOPICS_INDEX_NAME, GIN_SYMBOLS_INDEX_NAME } from "../soroban-indexer.worker";

const GIN_INDEXES = [
  { indexname: GIN_TOPICS_INDEX_NAME },
  { indexname: GIN_SYMBOLS_INDEX_NAME },
];

function fakePlan(executionTimeMs: number): any[] {
  return [
    {
      "Execution Time": executionTimeMs,
      "Node Type": "Limit",
      "Plans": [
        {
          "Node Type": "Index Scan",
          "Index Name": GIN_SYMBOLS_INDEX_NAME,
          "Index Cond": `("topicSymbols" && '{swap}'::text[])`,
          "Plans": [],
        },
      ],
    },
  ];
}

function mockQueryRaw(executionTimeMs: number) {
  vi.mocked(prisma.$queryRawUnsafe).mockImplementation(async (sql: string) => {
    if (/^CREATE INDEX/.test(sql)) return [];
    if (/pg_indexes/.test(sql)) return GIN_INDEXES;
    if (/^ANALYZE/.test(sql)) return [];
    if (/^DELETE FROM/.test(sql)) return [];
    if (/^EXPLAIN/.test(sql)) {
      return [{ "QUERY PLAN": JSON.stringify(fakePlan(executionTimeMs)) }];
    }
    return [
      { id: "hit-1", contractId: "C_TOPIC_BENCH_000", ledgerSeq: 900, topicSymbol: "transfer" },
      { id: "hit-2", contractId: "C_TOPIC_BENCH_001", ledgerSeq: 850, topicSymbol: "swap" },
    ];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.sorobanTopicIndex.count).mockResolvedValue(20_000);
  vi.mocked(prisma.sorobanTopicIndex.createMany).mockResolvedValue({ count: 1000 });
  mockQueryRaw(3.25);
});

describe("runTopicSearchBenchmark — DB index query performance benchmark", () => {
  it("reports sub-50ms explain times for every dashboard query pattern", async () => {
    const report = await runTopicSearchBenchmark({
      db: prisma,
      seed: false,
      targetRows: 10_000,
      targetMs: 50,
      cleanup: false,
    });

    expect(report.targetMs).toBe(50);
    expect(report.totalRows).toBe(20_000);
    expect(report.seededRows).toBe(0);
    expect(report.allPassed).toBe(true);
    expect(report.queries).toHaveLength(4);

    for (const query of report.queries) {
      expect(query.explainMs).toBe(3.25);
      expect(query.explainMs!).toBeLessThan(50);
      expect(query.passed).toBe(true);
      expect(query.usedGinIndex).toBe(true);
      expect(query.usedIndex).toBe(GIN_SYMBOLS_INDEX_NAME);
      expect(query.wallMs).toBeGreaterThanOrEqual(0);
      expect(query.rows).toBe(2);
    }
    // No seeding happened, so no data writes and no cleanup deletes.
    expect(prisma.sorobanTopicIndex.createMany).not.toHaveBeenCalled();
    const deletes = vi.mocked(prisma.$queryRawUnsafe).mock.calls.filter(([sql]) => /^DELETE FROM/.test(sql));
    expect(deletes).toHaveLength(0);
  });

  it("seeds a synthetic corpus through the production decoder when the table is thin", async () => {
    vi.mocked(prisma.sorobanTopicIndex.count).mockResolvedValueOnce(1000);

    const report = await runTopicSearchBenchmark({
      db: prisma,
      seed: true,
      targetRows: 10_000,
      cleanup: false,
    });

    expect(report.seededRows).toBe(9_000);
    // 9000 rows in chunks of 1000
    expect(prisma.sorobanTopicIndex.createMany).toHaveBeenCalledTimes(9);
    const firstCall = vi.mocked(prisma.sorobanTopicIndex.createMany).mock.calls[0][0];
    expect(firstCall.skipDuplicates).toBe(true);
    expect(firstCall.data).toHaveLength(1000);
    expect(firstCall.data[0]).toMatchObject({
      contractId: "C_TOPIC_BENCH_000",
      topicSymbols: ["transfer"],
      topicSymbol: "transfer",
    });
    expect(firstCall.data[0].topicsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstCall.data[0].topics[0]).toEqual({ type: "symbol", value: "transfer" });

    // ANALYZE was refreshed before measurement
    expect(vi.mocked(prisma.$queryRawUnsafe).mock.calls.some(([sql]) => /^ANALYZE/.test(sql))).toBe(true);
  });

  it("cleans up seeded rows by default", async () => {
    vi.mocked(prisma.sorobanTopicIndex.count).mockResolvedValueOnce(500);

    const report = await runTopicSearchBenchmark({ db: prisma, seed: true, targetRows: 10_000 });

    expect(report.seededRows).toBe(0); // reset after cleanup
    const deletes = vi.mocked(prisma.$queryRawUnsafe).mock.calls.filter(([sql]) => /^DELETE FROM/.test(sql));
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0] as string).toContain("C_TOPIC_BENCH");
  });

  it("fails the report when any query exceeds the timing SLA", async () => {
    mockQueryRaw(120.5);

    const report = await runTopicSearchBenchmark({ db: prisma, seed: false });

    expect(report.allPassed).toBe(false);
    for (const query of report.queries) {
      expect(query.passed).toBe(false);
      expect(query.explainMs).toBe(120.5);
    }
  });
});