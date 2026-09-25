# Stellar Alerts ⚡

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.10-green.svg)](https://fastify.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black.svg)](https://nextjs.org/)
[![Stellar SDK](https://img.shields.io/badge/Stellar_SDK-13.3-purple.svg)](https://developers.stellar.org/)
[![CI Status](https://github.com/stellar-alerts-labs/stellar-alerts/actions/workflows/ci.yml/badge.svg)](https://github.com/stellar-alerts-labs/stellar-alerts/actions/workflows/ci.yml)
[![Telegram Chat](https://img.shields.io/badge/Telegram-Join_Community-blue.svg?logo=telegram)](https://t.me/+uElHrnWMb180MWM0)

**Real-Time Stellar Payment Tracker, Soroban Event Ingestion & Non-Custodial Alert Engine**

Stellar Alerts monitors registered Stellar public wallets in real time for incoming transactions on the Stellar network (Testnet / Mainnet). It records payment history in PostgreSQL and dispatches multi-channel alerts (Telegram, WhatsApp, Email, Webhooks) without ever requesting or storing secret keys.

---

## 🌟 Key Features

- ⚡ **Zero-Delay Horizon SSE Ingestion**: Listens directly to Stellar Horizon Server-Sent Events (SSE) payment streams (`payment` and `create_account` operations).
- 🔮 **Soroban Smart Contract Support**: Ingests Soroban contract events (`getEvents`) and includes an on-chain Rust Wasm Alert Registry contract (`contracts/alert_registry`).
- 🔒 **100% Non-Custodial Security**: Only public key addresses (`G...`) are stored. Secret keys are never touched or requested.
- 🔑 **StrKey Checksum Validation**: Enforces Base32 CRC16-XMODEM public key checksum validation at the API boundary and watcher loop.
- 📨 **BullMQ Redis Alert Queue**: Asynchronous message queue with exponential retries for off-chain alert dispatches.
- 🧮 **Persisted Alert-Rule Evaluator**: Evaluates a user's stored `AlertRule` records (per-wallet or account-wide, asset allow-lists, minimum amount thresholds, and AND/OR condition grouping) against each normalized payment event, enqueuing a notification job only when a rule matches and never twice for the same payment.
- 🩹 **Hardened Cursor Recovery**: Detects ingestion ledger gaps and Horizon provider outages, recovers with a bounded backfill instead of an unbounded replay, and exposes per-wallet ingestion health via `GET /wallets/:id/ingestion-status`.
- 🛡️ **HMAC SHA256 Webhook Signer**: Generates cryptographically verifiable `X-Stellar-Alerts-Signature` headers for webhook payloads.
- 🪄 **1-Click Passwordless Auth**: Secure Magic Link email authentication (`/verify?token=...`) with zero password overhead.
- 🦋 **Wallet (DID) Sign-In**: Sign in with your Stellar Freighter wallet via `did:pkh:stellar` challenges — single-use, expiring, and fully non-custodial (see `/auth/did/*`).
- 🔁 **Idempotent Delivery**: Webhook/Telegram/Email dispatches deduplicate via `notificationDeliveryAttempt`, preventing duplicate alerts on retries.
- 🗄️ **Dead-Letter Queue & Inspector**: Terminal delivery failures are persisted (`DeadLetter`), audited, and can be replayed idempotently or suppressed from the API and web UI (`/dead-letters`).
- 📊 **Modular React Dashboard**: Monitored wallets, summary statistics, and real-time payment history powered by Next.js and Tailwind CSS, organized into feature routes (`/dashboard`, `/inspectors`, `/settings`, `/onboarding`, `/docs`).
- 🧙 **Resumable Onboarding Wizard**: A three-step freelancer setup flow (wallet connection → Telegram linking → notification preferences) with a test-ping check before activation; progress persists to `localStorage` so a refresh resumes exactly where the user left off.
- 🧪 **Automated Vitest Test Suite**: Unit testing framework with 100% passing test coverage (`npm run test:api`).

---

## 🏗️ Architecture Overview

```
Stellar Network (Horizon SSE + Soroban RPC) → Ingestion Worker → PostgreSQL → Fastify REST API → Next.js Web App
                                                    │
                                                    └──> BullMQ (Redis) → Telegram / WhatsApp / Email / Webhook Alerts
```

For complete technical specifications, database schemas, and data flow details, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## 🚀 Quick Start for Reviewers & Developers

### 1. Installation & Monorepo Setup
```bash
git clone https://github.com/stellar-alerts-labs/stellar-alerts.git
cd stellar-alerts
npm install
```

### 2. Start Local Database & Redis Stack (Docker)
```bash
docker compose up -d
npm run db:push
```

### 3. Run Automated Tests & Typechecks
```bash
npm run test:api
```

### 4. Launch Monorepo Stack (Turborepo)
```bash
npx turbo dev
```

Or launch components individually:
```bash
npm run dev:api     # Fastify REST API on http://localhost:3001
npm run dev:worker  # Stellar Horizon & Soroban Ingestion Worker
npm run dev:web     # Next.js Dashboard on http://localhost:3000
```

### 5. Test Live Stellar Payment Ingestion
Fund a fresh keypair on Stellar Testnet via Friendbot and verify automated ingestion into PostgreSQL:
```bash
npx tsx --env-file=apps/api/.env apps/api/scripts/seed-and-trigger-payment.ts
```

---

## 🏆 Grant Qualification & Documentation

- **Drips Wave Audit & Readiness Report**: See **[drips_wave_readiness_audit.md](file:///C:/Users/user/.gemini/antigravity-ide/brain/12528373-9966-4327-97c9-8c7388be13f6/drips_wave_readiness_audit.md)** for full reviewer scoring & roadmap.
- **Grant Submission Qualification Matrix**: See **[SUBMISSION.md](SUBMISSION.md)**.
- **System Design & API Specs**: See **[ARCHITECTURE.md](ARCHITECTURE.md)**.
- **Contribution Guidelines**: See **[CONTRIBUTING.md](CONTRIBUTING.md)**.
- **Development Roadmap**: See **[ROADMAP.md](ROADMAP.md)**.
- **Soroban Smart Contract**: See **[contracts/alert_registry/README.md](contracts/alert_registry/README.md)**.

---

## 💬 Community & Support

Join our official Telegram community to ask questions, chat with maintainers, discuss Drips Wave sprint tasks, and stay updated on new releases:

👉 **[Join Stellar Alerts on Telegram](https://t.me/+uElHrnWMb180MWM0)**

---

## 📄 License

Released under the [MIT License](LICENSE).
