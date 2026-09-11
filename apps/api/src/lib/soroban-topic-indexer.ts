import * as StellarSdk from "stellar-sdk";
import { createHash } from "crypto";

// ─── Soroban Topic Indexer core ─────────────────────────────────────────────
//
// Pure decoder + index-helper module for the WASM sub-ledger event filter.
// It turns the nested base64-XDR ScVal topic array attached to every Soroban
// contract event into:
//
//   • a fully decoded, type-tagged JSON tree (`topics`)  → JSONB GIN index
//   • a flat, deduplicated text[] of every symbol found (`topicSymbols`)
//     → GIN array_ops index
//   • the lead event-name symbol (`topicSymbol`)        → btree equality
//   • a deterministic canonical sha256 (`topicsHash`)   → dedupe/upsert key
//
// No network or database access happens here; callers (the indexer worker and
// its tests) own those concerns. The GIN index DDL and SQL predicate builders
// live here too so the worker, dashboard search helpers and the benchmark all
// share a single source of truth.

/** A single decoded, type-tagged entry of a Soroban event topic array. */
export type TopicValue =
  | { type: "void"; value: null }
  | { type: "bool"; value: boolean }
  | { type: "u32"; value: number }
  | { type: "i32"; value: number }
  // All 64/128/256-bit integers are rendered as decimal strings — JSONB can't
  // hold bigints and a string form round-trips losslessly.
  | { type: "u64"; value: string }
  | { type: "i64"; value: string }
  | { type: "u128"; value: string }
  | { type: "i128"; value: string }
  | { type: "u256"; value: string }
  | { type: "i256"; value: string }
  | { type: "timepoint"; value: string }
  | { type: "duration"; value: string }
  | { type: "symbol"; value: string }
  | { type: "string"; value: string }
  | { type: "address"; value: string }
  | { type: "bytes"; value: string }
  | { type: "error"; value: string }
  | { type: "vec"; value: TopicValue[] }
  | { type: "map"; value: { key: TopicValue; value: TopicValue }[] }
  | { type: "scv"; value: string }
  | { type: "raw"; value: string };

export interface DecodedTopic {
  /** Fully decoded topic tree (every entry type-tagged). */
  topics: TopicValue[];
  /** Raw base64 XDR entries exactly as observed on the wire. */
  topicXdr: string[];
  /** Flat, deduplicated list of every symbol found anywhere in the tree. */
  topicSymbols: string[];
  /** Lead event symbol (conventionally topic[0]); null when none found. */
  topicSymbol: string | null;
  /** Deterministic sha256 hex of the canonical JSON of `topics`. */
  topicsHash: string;
}

export interface TopicIndexRow {
  contractId: string;
  ledgerSeq: number;
  txHash: string | null;
  topicXdrJson: string[];
  topics: TopicValue[];
  topicSymbols: string[];
  topicSymbol: string | null;
  topicsHash: string;
}

// ── ScVal switch values captured once (numeric enum equality is the fastest
//    and most version-stable way to walk the xdr union). ────────────────────
const SCV = (() => {
  const t = StellarSdk.xdr.ScValType;
  return {
    VOID: t.scvVoid().value,
    BOOL: t.scvBool().value,
    ERROR: t.scvError().value,
    U32: t.scvU32().value,
    I32: t.scvI32().value,
    U64: t.scvU64().value,
    I64: t.scvI64().value,
    TIMEPOINT: t.scvTimepoint().value,
    DURATION: t.scvDuration().value,
    U128: t.scvU128().value,
    I128: t.scvI128().value,
    U256: t.scvU256().value,
    I256: t.scvI256().value,
    BYTES: t.scvBytes().value,
    STRING: t.scvString().value,
    SYMBOL: t.scvSymbol().value,
    VEC: t.scvVec().value,
    MAP: t.scvMap().value,
    ADDRESS: t.scvAddress().value,
  };
})();

/**
 * True when `entry` looks like a parsed stellar-xdr `ScVal` union (as produced
 * by `getEvents` rather than raw Horizon/HorizonSSE topic arrays).
 */
export function isScValLike(entry: any): boolean {
  return (
    !!entry &&
    typeof entry === "object" &&
    typeof entry.switch === "function" &&
    typeof entry.toXDR === "function"
  );
}

function bufferToBase64(value: any): string {
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return String(value);
}

function scvText(value: any): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

function decodeScError(scv: any): string {
  try {
    if (scv.error().switch().value === StellarSdk.xdr.ScErrorType.sceContract().value) {
      return `contract:${scv.error().contractCode()}`;
    }
    const err = scv.error();
    return `${err.code().name ?? "unknown"}:${err.code().value}`;
  } catch {
    return "unknown";
  }
}

/**
 * Decodes a single ScVal union into a type-tagged TopicValue. Never throws —
 * any unexpected ScVal shape degrades to a tagged `raw`/`scv` marker instead of
 * aborting the whole event index.
 */
export function decodeScVal(scv: any): TopicValue {
  try {
    const kind = scv.switch().value;
    switch (kind) {
      case SCV.VOID:
        return { type: "void", value: null };
      case SCV.BOOL:
        return { type: "bool", value: Boolean(scv.b()) };
      case SCV.U32:
        return { type: "u32", value: Number(scv.u32()) };
      case SCV.I32:
        return { type: "i32", value: Number(scv.i32()) };
      case SCV.U64:
      case SCV.I64:
      case SCV.U128:
      case SCV.I128:
      case SCV.U256:
      case SCV.I256:
      case SCV.TIMEPOINT:
      case SCV.DURATION:
        return { type: bigTypeName(kind), value: StellarSdk.scValToNative(scv).toString() };
      case SCV.SYMBOL:
        return { type: "symbol", value: scvText(scv.sym()) };
      case SCV.STRING:
        return { type: "string", value: scvText(scv.str()) };
      case SCV.BYTES:
        return { type: "bytes", value: bufferToBase64(scv.bytes()) };
      case SCV.ADDRESS:
        try {
          return { type: "address", value: StellarSdk.Address.fromScVal(scv).toString() };
        } catch {
          return { type: "address", value: scvText(StellarSdk.scValToNative(scv)) };
        }
      case SCV.VEC:
        return { type: "vec", value: (scv.vec() ?? []).map(decodeScVal) };
      case SCV.MAP:
        return {
          type: "map",
          value: (scv.map() ?? []).map((entry: any) => ({
            key: decodeScVal(entry.key()),
            value: decodeScVal(entry.val()),
          })),
        };
      case SCV.ERROR:
        return { type: "error", value: decodeScError(scv) };
      default:
        // contract-instance / nonce / any forward-compatible ScVal kind.
        return { type: "scv", value: scv.switch().name ?? "unknown" };
    }
  } catch {
    return { type: "raw", value: "undecodable" };
  }
}

/** Maps an ScVal numeric switch value onto the 64/128/256-bit type names. */
function bigTypeName(kind: number): "u64" | "i64" | "u128" | "i128" | "u256" | "i256" | "timepoint" | "duration" {
  switch (kind) {
    case SCV.I64:
      return "i64";
    case SCV.U128:
      return "u128";
    case SCV.I128:
      return "i128";
    case SCV.U256:
      return "u256";
    case SCV.I256:
      return "i256";
    case SCV.TIMEPOINT:
      return "timepoint";
    case SCV.DURATION:
      return "duration";
    default:
      return "u64";
  }
}

/**
 * Attempts to convert one raw topic entry (base64 XDR string or already-parsed
 * ScVal union) into a parsed ScVal. Returns null when undecodable.
 */
export function topicEntryToScVal(entry: any): any | null {
  if (!entry) return null;
  if (typeof entry === "string") {
    try {
      return StellarSdk.xdr.ScVal.fromXDR(Buffer.from(entry, "base64"));
    } catch {
      return null;
    }
  }
  if (isScValLike(entry)) return entry;
  return null;
}

/** Serializes one topic entry to its base64 XDR form (for the audit column). */
export function topicEntryToBase64(entry: any): string {
  if (typeof entry === "string") return entry;
  if (isScValLike(entry)) {
    try {
      return entry.toXDR().toString("base64");
    } catch {
      return "";
    }
  }
  return typeof entry === "string" ? entry : JSON.stringify(entry);
}

/**
 * Recursively collects every symbol value from a decoded topic tree, first
 * occurrence first — the event name in position 0 comes first by convention.
 */
export function collectTopicSymbols(topics: TopicValue[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (v: TopicValue) => {
    if (v.type === "symbol") {
      if (!seen.has(v.value)) {
        seen.add(v.value);
        out.push(v.value);
      }
    } else if (v.type === "vec") {
      v.value.forEach(visit);
    } else if (v.type === "map") {
      v.value.forEach((e) => {
        visit(e.key);
        visit(e.value);
      });
    }
  };
  topics.forEach(visit);
  return out;
}

/** Lead event symbol (topic[0] when it's a symbol), else the first symbol found. */
export function leadTopicSymbol(topics: TopicValue[]): string | null {
  if (topics[0]?.type === "symbol") return topics[0].value;
  const [first] = collectTopicSymbols(topics);
  return first ?? null;
}

/** Deterministic object-key-sorted JSON encoding of any JSON-safe value. */
export function canonicalJson(value: unknown): string {
  const canonicalize = (v: any): any => {
    if (Array.isArray(v)) return v.map(canonicalize);
    if (v !== null && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const key of Object.keys(v).sort()) out[key] = canonicalize(v[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(canonicalize(value));
}

/** Deterministic sha256 (hex) of the canonical JSON of a decoded topic tree. */
export function hashTopics(topics: TopicValue[]): string {
  return createHash("sha256").update(canonicalJson(topics)).digest("hex");
}

/**
 * Decodes a raw Soroban event topic array into its indexed representation.
 * Each entry may be a base64 XDR string (Horizon / HorizonSSE / raw RPC) or an
 * already-parsed `xdr.ScVal` (stellar-sdk `getEvents`). Undecodable entries
 * degrade to `raw` tags rather than failing the event.
 */
export function decodeTopicArray(topic: any[] | null | undefined): DecodedTopic {
  const entries = Array.isArray(topic) ? topic : [];
  const topics: TopicValue[] = [];
  const topicXdr: string[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      topicXdr.push(entry);
      const scv = topicEntryToScVal(entry);
      topics.push(scv ? decodeScVal(scv) : { type: "raw", value: entry });
    } else if (isScValLike(entry)) {
      topicXdr.push(topicEntryToBase64(entry));
      topics.push(decodeScVal(entry));
    } else {
      const text = entry === null || entry === undefined ? "" : String(entry);
      topicXdr.push(text);
      topics.push({ type: "raw", value: text });
    }
  }

  const topicSymbols = collectTopicSymbols(topics);
  return {
    topics,
    topicXdr,
    topicSymbols,
    topicSymbol: leadTopicSymbol(topics),
    topicsHash: hashTopics(topics),
  };
}

/** Convenience: decodes an event object into a ready-to-persist TopicIndexRow. */
export function topicIndexRowFromEvent(event: any, contractId?: string): TopicIndexRow | null {
  if (!event || !Array.isArray(event.topic) || event.topic.length === 0) return null;
  const decoded = decodeTopicArray(event.topic);
  return {
    contractId: contractId ?? event.contractId ?? "",
    ledgerSeq: Number(event.ledgerSeq ?? event.ledger ?? 0) || 0,
    txHash: event.txHash ?? event.transactionHash ?? null,
    topicXdrJson: decoded.topicXdr,
    topics: decoded.topics,
    topicSymbols: decoded.topicSymbols,
    topicSymbol: decoded.topicSymbol,
    topicsHash: decoded.topicsHash,
  };
}

// ── GIN index DDL + query predicate builders ────────────────────────────────
//
// Table/column identifiers are fixed constants (never user input), and value
// literals are single-quote escaped, so the built SQL is injection-safe.

/** PostgreSQL table name (quoted) of the topic index. */
export const TOPIC_INDEX_TABLE = '"SorobanTopicIndex"';

/** GIN index (jsonb_path_ops) over the decoded topics JSONB column. */
export const GIN_TOPICS_INDEX_NAME = "SorobanTopicIndex_topics_gin";
export const GIN_TOPICS_INDEX_DDL = `CREATE INDEX IF NOT EXISTS "${GIN_TOPICS_INDEX_NAME}" ` +
  `ON "SorobanTopicIndex" USING gin ("topics" jsonb_path_ops)`;

/** GIN index (array_ops) over the flat `text[]` symbol column. */
export const GIN_SYMBOLS_INDEX_NAME = "SorobanTopicIndex_topicSymbols_gin";
export const GIN_SYMBOLS_INDEX_DDL = `CREATE INDEX IF NOT EXISTS "${GIN_SYMBOLS_INDEX_NAME}" ` +
  `ON "SorobanTopicIndex" USING gin ("topicSymbols")`;

export const TOPIC_INDEX_GIN_DDLS: string[] = [GIN_TOPICS_INDEX_DDL, GIN_SYMBOLS_INDEX_DDL];

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Builds a GIN-friendly predicate matching rows whose `topicSymbols` text[]
 * array contains any of the given symbols (`&&` array operator). Returns null
 * when the symbol list is empty.
 */
export function topicSymbolsAnyOf(symbols: string[]): string | null {
  if (!symbols || symbols.length === 0) return null;
  const literals = symbols.map(quoteLiteral).join(", ");
  return `"topicSymbols" && ARRAY[${literals}]::text[]`;
}

/**
 * Builds a GIN-friendly predicate matching rows whose `topicSymbols` text[]
 * array contains every one of the given symbols (`@>` array operator).
 */
export function topicSymbolsContainAll(symbols: string[]): string | null {
  if (!symbols || symbols.length === 0) return null;
  const literals = symbols.map(quoteLiteral).join(", ");
  return `"topicSymbols" @> ARRAY[${literals}]::text[]`;
}

/**
 * Builds a JSONB containment predicate matching rows whose decoded `topics`
 * array contains the given type-tagged topic value — e.g. "event mentions this
 * address in some topic position". Consumed by the `jsonb_path_ops` GIN index.
 */
export function topicsContain(topic: TopicValue): string {
  return `"topics" @> ${quoteLiteral(JSON.stringify([topic]))}::jsonb`;
}

/** Cheap btree equality on the lead symbol column. */
export function topicSymbolEquals(symbol: string): string {
  return `"topicSymbol" = ${quoteLiteral(symbol)}`;
}