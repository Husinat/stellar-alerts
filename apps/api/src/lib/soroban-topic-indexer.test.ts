import { describe, it, expect } from "vitest";
import * as StellarSdk from "stellar-sdk";
import {
  decodeTopicArray,
  decodeScVal,
  collectTopicSymbols,
  leadTopicSymbol,
  canonicalJson,
  hashTopics,
  topicEntryToScVal,
  topicIndexRowFromEvent,
  topicSymbolsAnyOf,
  topicSymbolsContainAll,
  topicsContain,
  topicSymbolEquals,
  TopicValue,
} from "./soroban-topic-indexer";

const kp = StellarSdk.Keypair.random();
const ALICE = kp.publicKey();
const BOB = StellarSdk.Keypair.random().publicKey();

const toAddress = (pub: string) =>
  StellarSdk.xdr.ScVal.scvAddress(StellarSdk.Address.fromString(pub).toScAddress());

/** Serializes ScVals to the base64 string entries Horizon/RPC return raw. */
function toBase64Topics(...scvals: any[]): string[] {
  return scvals.map((s) => s.toXDR().toString("base64"));
}

function u128(value: string): any {
  const big = BigInt(value);
  const lo = BigInt.asUintN(64, big);
  const hi = BigInt.asUintN(64, big >> 64n);
  return StellarSdk.xdr.ScVal.scvU128(
    new StellarSdk.xdr.UInt128Parts({
      lo: StellarSdk.xdr.Uint64.fromString(lo.toString()),
      hi: StellarSdk.xdr.Uint64.fromString(hi.toString()),
    }),
  );
}

describe("decodeTopicArray — XDR topic array parser", () => {
  it("decodes a canonical SAC transfer topic from raw base64 XDR entries", () => {
    const raw = toBase64Topics(
      StellarSdk.xdr.ScVal.scvSymbol("transfer"),
      toAddress(ALICE),
      toAddress(BOB),
      u128("5000000"),
    );

    const decoded = decodeTopicArray(raw);

    expect(decoded.topicXdr).toEqual(raw);
    expect(decoded.topics).toEqual([
      { type: "symbol", value: "transfer" },
      { type: "address", value: ALICE },
      { type: "address", value: BOB },
      { type: "u128", value: "5000000" },
    ]);
    expect(decoded.topicSymbol).toBe("transfer");
    expect(decoded.topicSymbols).toEqual(["transfer"]);
    expect(decoded.topicsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("decodes already-parsed ScVal topic arrays (stellar-sdk getEvents shape)", () => {
    const topic: any[] = [StellarSdk.xdr.ScVal.scvSymbol("swap"), toAddress(ALICE)];

    const decoded = decodeTopicArray(topic);

    expect(decoded.topics).toEqual([
      { type: "symbol", value: "swap" },
      { type: "address", value: ALICE },
    ]);
    expect(decoded.topicXdr).toHaveLength(2);
    // re-parsing the stored base64 must round-trip to the same value
    const reparsed = StellarSdk.xdr.ScVal.fromXDR(Buffer.from(decoded.topicXdr[0], "base64"));
    expect(StellarSdk.scValToNative(reparsed)).toBe("swap");
  });

  it("handles scalar ScVal types faithfully", () => {
    const decoded = decodeTopicArray([
      StellarSdk.xdr.ScVal.scvBool(true),
      StellarSdk.xdr.ScVal.scvU32(12345),
      StellarSdk.xdr.ScVal.scvI32(-42),
      StellarSdk.xdr.ScVal.scvString("hello"),
      StellarSdk.xdr.ScVal.scvBytes(Buffer.from("hi")),
    ]);

    expect(decoded.topics).toEqual([
      { type: "bool", value: true },
      { type: "u32", value: 12345 },
      { type: "i32", value: -42 },
      { type: "string", value: "hello" },
      { type: "bytes", value: "aGk=" },
    ]);
  });

  it("renders 64/128/256-bit integers as lossless decimal strings", () => {
    const maxU64 = "18446744073709551615";
    const decoded = decodeTopicArray([
      StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(maxU64)),
      StellarSdk.xdr.ScVal.scvI64(StellarSdk.xdr.Int64.fromString("-5")),
      u128("340282366920938463463374607431768211455"),
      StellarSdk.xdr.ScVal.scvTimepoint(StellarSdk.xdr.Uint64.fromString("7777777")),
      StellarSdk.xdr.ScVal.scvDuration(StellarSdk.xdr.Uint64.fromString("8888888")),
    ]);

    expect(decoded.topics).toEqual([
      { type: "u64", value: maxU64 },
      { type: "i64", value: "-5" },
      { type: "u128", value: "340282366920938463463374607431768211455" },
      { type: "timepoint", value: "7777777" },
      { type: "duration", value: "8888888" },
    ]);
  });

  it("decodes nested vecs and maps and collects their symbols", () => {
    const topic: any[] = [
      StellarSdk.xdr.ScVal.scvSymbol("nft_mint"),
      StellarSdk.xdr.ScVal.scvVec([
        StellarSdk.xdr.ScVal.scvSymbol("collection"),
        StellarSdk.xdr.ScVal.scvSymbol("edition"),
      ]),
      StellarSdk.xdr.ScVal.scvMap([
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol("mint_to"),
          val: toAddress(ALICE),
        }),
      ]),
    ];

    const decoded = decodeTopicArray(topic);

    expect(decoded.topics[1]).toEqual({
      type: "vec",
      value: [
        { type: "symbol", value: "collection" },
        { type: "symbol", value: "edition" },
      ],
    });
    expect(decoded.topics[2]).toEqual({
      type: "map",
      value: [
        {
          key: { type: "symbol", value: "mint_to" },
          value: { type: "address", value: ALICE },
        },
      ],
    });
    // symbols flattened: lead first, then depth-first, deduplicated
    expect(decoded.topicSymbols).toEqual(["nft_mint", "collection", "edition", "mint_to"]);
  });

  it("treats unknown / non-ScVal ScVal kinds as opaque scv tags instead of throwing", () => {
    const nonce = StellarSdk.xdr.ScVal.scvLedgerKeyNonce(StellarSdk.xdr.Uint64.fromString("5"));
    const decoded = decodeTopicArray([nonce, StellarSdk.xdr.ScVal.scvVoid()]);

    expect(decoded.topics[0].type).toBe("scv");
    expect(decoded.topics[0].value).toContain("scvLedgerKeyNonce");
    expect(decoded.topics[1]).toEqual({ type: "void", value: null });
  });

  it("tags malformed base64 entries as raw instead of failing the whole array", () => {
    const decoded = decodeTopicArray([StellarSdk.xdr.ScVal.scvSymbol("transfer").toXDR().toString("base64"), "%%%not-xdr%%%"]);

    expect(decoded.topics).toEqual([
      { type: "symbol", value: "transfer" },
      { type: "raw", value: "%%%not-xdr%%%" },
    ]);
  });

  it("returns an empty-but-valid result for a missing/empty topic array", () => {
    const decoded = decodeTopicArray(null);

    expect(decoded.topics).toEqual([]);
    expect(decoded.topicSymbols).toEqual([]);
    expect(decoded.topicSymbol).toBeNull();
    expect(decoded.topicsHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("symbol extraction helpers", () => {
  const topic: TopicValue[] = [
    { type: "symbol", value: "transfer" },
    { type: "address", value: ALICE },
    {
      type: "vec",
      value: [
        { type: "symbol", value: "transfer" },
        { type: "map", value: [{ key: { type: "symbol", value: "extra" }, value: { type: "string", value: "x" } }] },
      ],
    },
  ];

  it("collects symbols depth-first, deduplicated, stable order", () => {
    expect(collectTopicSymbols(topic)).toEqual(["transfer", "extra"]);
  });

  it("prefers topic[0] as the lead symbol", () => {
    expect(leadTopicSymbol(topic)).toBe("transfer");
    expect(leadTopicSymbol([{ type: "address", value: ALICE }, { type: "symbol", value: "fallback" }])).toBe("fallback");
    expect(leadTopicSymbol([{ type: "vec", value: [] }])).toBeNull();
  });
});

describe("canonical topic hashing", () => {
  it("is deterministic for identical topic trees", () => {
    const a = decodeTopicArray(toBase64Topics(StellarSdk.xdr.ScVal.scvSymbol("transfer"), toAddress(ALICE)));
    const b = decodeTopicArray(toBase64Topics(StellarSdk.xdr.ScVal.scvSymbol("transfer"), toAddress(ALICE)));

    expect(a.topicsHash).toBe(b.topicsHash);
    expect(canonicalJson(a.topics)).toBe(canonicalJson(b.topics));
  });

  it("differs when the topic array changes", () => {
    const a = decodeTopicArray(toBase64Topics(StellarSdk.xdr.ScVal.scvSymbol("transfer"), toAddress(ALICE)));
    const b = decodeTopicArray(toBase64Topics(StellarSdk.xdr.ScVal.scvSymbol("transfer"), toAddress(BOB)));

    expect(a.topicsHash).not.toBe(b.topicsHash);
  });

  it("canonicalize orders object keys so built-form differs from hand-written form identically", () => {
    const plain = [{ value: "transfer", type: "symbol" }];
    const built: TopicValue[] = [{ type: "symbol", value: "transfer" }];
    expect(canonicalJson(plain)).toBe(canonicalJson(built));
  });
});

describe("topicEntryToScVal", () => {
  it("round-trips a base64 XDR entry into a ScVal", () => {
    const b64 = StellarSdk.xdr.ScVal.scvSymbol("transfer").toXDR().toString("base64");
    const scv = topicEntryToScVal(b64);

    expect(scv).not.toBeNull();
    expect(StellarSdk.scValToNative(scv)).toBe("transfer");
  });

  it("returns the ScVal itself for parsed entries and null for junk", () => {
    const parsed = StellarSdk.xdr.ScVal.scvSymbol("transfer");
    expect(topicEntryToScVal(parsed)).toBe(parsed);
    expect(topicEntryToScVal("junk")).toBeNull();
    expect(topicEntryToScVal(null)).toBeNull();
    expect(topicEntryToScVal(42)).toBeNull();
  });
});

describe("topicIndexRowFromEvent", () => {
  const transferScVal = StellarSdk.xdr.ScVal.scvSymbol("transfer");

  it("builds a persistable row from an RPC event", () => {
    const event = {
      contractId: "C2",
      ledger: 42,
      txHash: "deadbeef",
      topic: toBase64Topics(transferScVal, toAddress(ALICE)),
    };

    const row = topicIndexRowFromEvent(event);

    expect(row).not.toBeNull();
    expect(row?.contractId).toBe("C2");
    expect(row?.ledgerSeq).toBe(42);
    expect(row?.txHash).toBe("deadbeef");
    expect(row?.topicSymbol).toBe("transfer");
    expect(row?.topicSymbols).toEqual(["transfer"]);
  });

  it("honours an explicit contractId override and prefers ledgerSeq", () => {
    const event = {
      ledgerSeq: 7,
      topic: toBase64Topics(transferScVal),
    };

    const row = topicIndexRowFromEvent(event, "C_OVERRIDE");

    expect(row?.contractId).toBe("C_OVERRIDE");
    expect(row?.ledgerSeq).toBe(7);
  });

  it("returns null for events with no topic array", () => {
    expect(topicIndexRowFromEvent({ contractId: "C", ledger: 1 })).toBeNull();
    expect(topicIndexRowFromEvent({ topic: [] })).toBeNull();
    expect(topicIndexRowFromEvent(null)).toBeNull();
  });
});

describe("GIN predicate builders", () => {
  it("builds the text[] any-of predicate with escaped literals", () => {
    expect(topicSymbolsAnyOf(["transfer", "swap"])).toBe(
      "\"topicSymbols\" && ARRAY['transfer', 'swap']::text[]",
    );
    expect(topicSymbolsAnyOf([])).toBeNull();
    expect(topicSymbolsAnyOf(["it's"])).toBe("\"topicSymbols\" && ARRAY['it''s']::text[]");
  });

  it("builds the text[] contains-all predicate", () => {
    expect(topicSymbolsContainAll(["a", "b"])).toBe("\"topicSymbols\" @> ARRAY['a', 'b']::text[]");
    expect(topicSymbolsContainAll([])).toBeNull();
  });

  it("builds the jsonb containment predicate", () => {
    expect(topicsContain({ type: "address", value: ALICE })).toBe(
      `"topics" @> '[{"type":"address","value":"${ALICE}"}]'::jsonb`,
    );
  });

  it("builds the btree equality predicate", () => {
    expect(topicSymbolEquals("swap")).toBe("\"topicSymbol\" = 'swap'");
  });
});