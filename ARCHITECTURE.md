# Stellar Payment Tracker — Architecture

## 1. Overview

Stellar Alerts is an open-source real-time payment tracker and alert system for Stellar wallets. It monitors registered Stellar public keys for incoming payment operations on the Stellar network (Testnet / Mainnet) via real-time Horizon Server-Sent Events (SSE) streams and Soroban RPC event queries. It records payment history in PostgreSQL via Prisma ORM and dispatches off-chain alerts (Telegram, Email, Webhooks) asynchronously via BullMQ and Redis.

Data flows in one direction:

```
Stellar Network (Horizon SSE + Soroban RPC) → Ingestion Worker → PostgreSQL → Fastify REST API → Next.js Web App
                                                    │
                                                    └──> BullMQ (Redis) → Telegram / Email / Webhook Alerts
```

The Next.js web application never communicates with Stellar directly. It consumes the typed Fastify REST API, utilizing shared DTO interfaces exported by `@stellar-alerts/shared`.

---

## 2. Tech Stack & Implementation Matrix

| Layer            | Choice                                   | Status |
|-------------------|-------------------------------------------|--------|
| Backend framework | Fastify + TypeScript                      | ✅ Implemented |
| Frontend framework| Next.js (App Router) + Tailwind CSS       | ✅ Implemented |
| Monorepo & Shared | Turborepo + `@stellar-alerts/shared`      | ✅ Implemented |
| Database & ORM    | PostgreSQL + Prisma ORM                   | ✅ Implemented |
| Blockchain SDK    | `stellar-sdk` (Horizon REST/SSE + Soroban RPC) | ✅ Implemented |
| Ingestion Worker  | Real-Time SSE Stream Watcher (`watcher.worker.ts`) | ✅ Implemented |
| Smart Contract    | Soroban Rust Wasm Contract (`contracts/alert_registry`) | ✅ Implemented |
| Job Queue         | BullMQ + Redis                            | ✅ Implemented |
| Webhook Security  | HMAC SHA256 Cryptographic Signatures      | ✅ Implemented |
| Auth Engine       | Passwordless Magic Link + JWT Session      | ✅ Implemented |
| Automated Testing | Vitest (`npm run test:api`)               | ✅ Implemented |
| CI/CD Automation  | GitHub Actions (`.github/workflows/ci.yml`) | ✅ Implemented |

---

## 3. Monorepo Directory Architecture

```
stellar-alerts/
├── .github/
│   ├── ISSUE_TEMPLATE/           # Feature Request & Bug Report YAML forms
│   ├── PULL_REQUEST_TEMPLATE.md  # Standardized PR template
│   └── workflows/
│       └── ci.yml                # GitHub Actions CI build & test pipeline
├── apps/
│   ├── api/                      # Fastify REST API & Horizon/Soroban Worker
│   │   ├── src/
│   │   │   ├── app.ts            # Fastify instance, CORS & plugin registration
│   │   │   ├── server.ts         # Fastify HTTP server entry point
│   │   │   ├── lib/
│   │   │   │   ├── prisma.ts     # Prisma ORM singleton instance
│   │   │   │   ├── queue.ts      # BullMQ payment-alerts Redis queue
│   │   │   │   ├── soroban.ts    # Soroban RPC client & contract event parser
│   │   │   │   ├── soroban-topic-indexer.ts # XDR topic array decoder + GIN helpers
│   │   │   │   └── stellar.ts    # Horizon API client & StrKey checksum guard
│   │   │   ├── modules/
│   │   │   │   ├── auth/         # Magic link issuance & verification
│   │   │   │   ├── wallets/      # Wallet registration & management
│   │   │   │   └── payments/     # Payment history & aggregate stats
│   │   │   ├── utils/
│   │   │   │   ├── jwt.ts        # Magic & Session JWT signing/verification
│   │   │   │   └── webhook-signer.ts # HMAC SHA256 webhook signature generator
│   │   │   └── workers/
│   │   │       ├── watcher.worker.ts # Horizon SSE real-time stream watcher
│   │   │       ├── soroban-indexer.worker.ts # Soroban topic indexer + search + benchmark
│   │   │       └── supervisor.ts   # Spawns & supervises child indexer workers
│   │   ├── prisma/
│   │   │   └── schema.prisma     # Data models for User, Wallet, Payment
│   │   └── vitest.config.ts      # Vitest test configuration
│   └── web/                      # Next.js (App Router) Dashboard Web App
│       └── src/
│           ├── app/              # Next.js routes (/page.tsx, /verify)
│           └── components/
│               └── dashboard/    # SummaryStats, WalletList, PaymentTable, NotificationModal
├── contracts/
│   └── alert_registry/           # Soroban Rust Wasm Smart Contract
│       ├── Cargo.toml
│       └── src/lib.rs            # AlertRegistryContract Rust implementation
├── packages/
│   └── shared/                   # Monorepo shared package (@stellar-alerts/shared)
│       └── src/index.ts          # Shared DTO interfaces & StrKey validator
├── docs/
│   └── drips-wave-issues.json    # 42 Drips Wave issues backlog export
├── docker-compose.yml            # Local PostgreSQL 16 & Redis 7 stack
└── turbo.json                    # Turborepo task pipeline configuration
```

---

## 4. Active API Endpoints

| Endpoint | Method | Auth Required | Description |
|---|---|---|---|
| `/health` | GET | No | Server health check |
| `/auth/request-link` | POST | No | Request a passwordless magic login link |
| `/auth/verify` | GET | No | Verify magic link token & issue session JWT |
| `/auth/me` | GET | Yes | Fetch authenticated user profile with wallets |
| `/wallets` | POST | Yes | Register a new Stellar public key (StrKey checksum guarded) |
| `/wallets` | GET | Yes | List registered wallets for current user |
| `/wallets/:id` | DELETE | Yes | Remove a wallet by ID |
| `/payments` | GET | Yes | Fetch payment transaction history |
| `/payments/summary`| GET | Yes | Aggregate payment stats (total payments, volume) |

---

## 5. Real-Time Ingestion Worker & Queue Flow

The ingestion worker ([watcher.worker.ts](file:///c:/Users/user/OneDrive/Documents/Open-source/stellar-alerts/apps/api/src/workers/watcher.worker.ts)) operates as follows:

1. **Wallet Retrieval & Checksum Guard**: Fetches active wallets from PostgreSQL and verifies `StellarSdk.StrKey.isValidEd25519PublicKey(publicKey)`.
2. **Horizon SSE Streaming**: Opens real-time Server-Sent Events stream (`server.payments().forAccount(key).cursor('now').stream()`).
3. **Soroban RPC Ingestion**: Queries `getEvents` for Soroban contract event logs.
4. **Idempotent Persistence**: Checks `prisma.payment.findUnique({ where: { txHash } })` to guarantee idempotent database insertion.
5. **BullMQ Queue Enqueueing**: Publishes alert payload to `payment-alerts` queue with exponential retry backoff (5 attempts).

---

## 5.1 Soroban Topic Indexer Engine

The [soroban-indexer.worker.ts](apps/api/src/workers/soroban-indexer.worker.ts) sub-ledger indexer parses nested Soroban contract event **topic arrays** (XDR `ScVal` unions) into queryable PostgreSQL JSONB columns, backed by GIN indexes so dashboard topic-search stays well under the 50ms SLA.

**Indexed model** (`SorobanTopicIndex`): per `[contractId, ledgerSeq]` it stores
- `topics` — JSONB decoded topic tree (types: `bool`, `u32`, `i32`, `u64`, `symbol`, `string`, `bytes`, `address`, `vec`, `map`, `error`, …; 64/128/256-bit integers rendered losslessly as decimal strings).
- `topicSymbols` — flat `text[]` of every symbol value found in the tree (first-position event name first).
- `topicSymbol` — lead event symbol (btree, for cheap exact-equality).
- `topicXdrJson` — raw base64 XDR audit column.
- `topicsHash` — SHA-256 of the canonical (key-sorted) JSON, unique with `[contractId, ledgerSeq]` so replays never double-insert.

**XDR decoder** (`lib/soroban-topic-indexer.ts`): accepts both already-parsed `xdr.ScVal` (stellar-sdk `getEvents`) and raw base64 strings (Horizon/HorizonSSE). Undecodable entries degrade to `raw`/`scv` markers rather than failing the event.

**GIN indexes**: Prisma cannot express GIN opclass indexes, so the worker owns index lifecycle via idempotent `CREATE INDEX IF NOT EXISTS`:
- `topics` → GIN `jsonb_path_ops` for `@>` containment.
- `topicSymbols` → GIN `array_ops` for `&&` (any-of) and `@>` (contains-all).
- `topicSymbol` → btree (exact match).

**Bounded SQL**: search predicates are built by shared builders using fixed quoted identifiers plus single-quote-escaped value literals, so the assembled SQL is injection-safe.

**Cursor**: `SorobanTopicIndexCursor` persists the last indexed ledger per contract; the worker resumes from `cursor + 1`, or backfills the last `SOROBAN_INDEXER_BACKFILL_WINDOW` ledgers when starting fresh.

**Performance benchmark**: `runTopicSearchBenchmark` seeds a synthetic corpus through the **production decoder**, runs each dashboard query pattern under `EXPLAIN (ANALYZE, FORMAT JSON)`, confirms a GIN index is used, and asserts every query completes below the (configurable, default 50ms) SLA. Run live via `npm run indexer:benchmark` (from `apps/api`). Seed rows are removed afterwards unless `--keep`.

**Spawn & config**: the supervisor spawns the indexer when `SOROBAN_INDEXER_WORKER_ENABLED=true`; interval/backfill/page-size are configurable via `SOROBAN_INDEXER_*` env vars.

---

## 6. Security & Compliance Architecture

- Only **public** Stellar addresses (`G...`) are stored. Private/secret keys are **never requested or stored**.
- All Ed25519 public keys are validated against Base32 CRC16-XMODEM checksums.
- Webhook dispatches include `X-Stellar-Alerts-Signature` headers signed via HMAC SHA256 with 5-minute clock drift tolerance.
- Fastify server enforces 30-second plugin connection timeouts (`pluginTimeout: 30000`).
