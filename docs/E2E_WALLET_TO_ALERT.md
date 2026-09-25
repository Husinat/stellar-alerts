# End-to-End Coverage for Wallet-to-Alert Activation (#325)

## Overview

This document specifies the end-to-end user journey and automated test coverage for the complete **wallet-to-alert activation** lifecycle in Stellar Alerts, implemented for Issue #325.

The flow guarantees that from the moment a user arrives with a watch-only Stellar public key, every intermediate phase—wallet connect, backend registration, Telegram linking, filter rules, test alert ping, real-time activation, and failure recovery—is fully validated, automated, and tested.

---

## The 7-Phase Activation Journey

```
[Phase 1: Connect]      User enters Stellar Ed25519 Public Key (G...)
        │               Validates 56-char format via isValidStellarPublicKey
        ▼
[Phase 2: Register]     POST /wallets binds address to account and seeds watcher cursor
        │
        ▼
[Phase 3: Telegram]     User enters Telegram Chat ID / performs bot handshake
        │               POST /notifications/preferences stores channel mapping
        ▼
[Phase 4: Preferences]  User configures minimum threshold (e.g. 25 XLM) & channel toggles
        │               PUT /notifications/preferences persists active filters
        ▼
[Phase 5: Test Ping]    POST /notifications/test-ping dispatches mock blockchain payment
        │               Returns delivery receipt (providerRequestId, latencyMs)
        ├──────────────────────────────────────┐
        ▼ (Success)                            ▼ (Failure / Network Outage)
[Phase 6: Activation]                  [Phase 7: Fault Recovery]
  - Toggle live ingestion               - Actionable error alert displayed
  - Worker polls Horizon ledger         - Retry Ping or reconfigure channel
  - Live alerts dispatch                - Seamless recovery to Activation
```

---

## Component Implementation

### `WalletAlertActivationWizard` (`apps/web/src/components/dashboard/WalletAlertActivationWizard.tsx`)
- Orchestrates the full 7-phase wizard flow.
- Features:
  - **Ed25519 Public Key Validation**: Client-side validation using `@stellar-alerts/shared` before network request dispatch.
  - **Live Dispatch Feedback**: Real-time receipt tracking showing provider request IDs and round-trip latency.
  - **In-flight Status Badges**: Clean visual indication of `Live Ingestion Active` state.
  - **Fault Recovery State Machine**: Catches transient provider timeouts (e.g. Telegram 504 / Horizon blips) and renders retry controls without losing user input.

---

## Automated Test Coverage

### 1. Integration & Component Tests (`apps/web/src/__tests__/wallet-to-alert-activation.test.tsx`)
Executed in CI via `npm run test --workspace=web`:
- `validates Stellar public key format before allowing registration`: Ensures malformed keys are blocked client-side.
- `completes the full flow: connect -> telegram -> preferences -> test ping -> activation`: Tests the entire sequence from address entry to live alert activation callback with verified payloads.
- `handles provider delivery faults and offers retry recovery`: Simulates provider dispatch failure, validates transition into recovery state, and verifies recovery through successful retry.

### 2. Browser E2E Tests (`apps/web/e2e/wallet-to-alert-activation.spec.ts`)
Executed via Playwright:
- Verifies onboarding route navigation, input entry, form submissions, and API route fulfillment in a real headless browser.

---

## Rollout & Compatibility

- **Non-Breaking**: The activation wizard is modular and can be rendered within onboarding guides or modal flows.
- **Watcher Compatibility**: Address registration hooks directly into existing `IngestionCursor` workers without requiring schema changes.
