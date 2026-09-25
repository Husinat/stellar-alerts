# Frontend Global Error, Loading, and Offline Recovery Model (#324)

## Overview

This document details the architectural design and implementation of the global error boundary, skeleton loading, and offline recovery model implemented for Issue #324.

The system introduces consistent, retryable route/component boundaries across the Dashboard, Telegram Mini App (TMA), Inspectors, and Settings views, backed by real-time network status detection and user recovery controls.

---

## Architecture & Component Hierarchy

```
RootLayout (apps/web/src/app/layout.tsx)
 ├── OfflineRecoveryBanner (Global sticky status & reconnection banner)
 └── Providers
      ├── Route Error Boundary (error.tsx)
      │    ├── Dashboard (/dashboard/error.tsx + loading.tsx)
      │    ├── Telegram Mini App (/tma/error.tsx + loading.tsx)
      │    ├── Inspectors (/inspectors/error.tsx + loading.tsx)
      │    └── Settings (/settings/error.tsx + loading.tsx)
      └── Component Error Boundary (apps/web/src/components/ErrorBoundary.tsx)
           └── Specific Feature Panels & Inspectors
```

---

## Core Components

### 1. `useNetworkStatus` Hook (`apps/web/src/hooks/useNetworkStatus.ts`)
- **Reactive State**: Monitors `navigator.onLine`, connection transitions, and tracks `offlineSince` and `lastOnlineAt` timestamps.
- **Active Health Ping**: Probes the backend `/api/health` endpoint on reconnect to distinguish between local Wi-Fi connectivity and genuine internet reachability.
- **Event Bus (`subscribeNetworkStatus`)**: Allows any dashboard component or data fetching hook to subscribe to network restoration events and immediately re-sync state.
- **Manual Retry (`retry()`)**: Exposes an async retry trigger that components or user actions can invoke.

### 2. `OfflineRecoveryBanner` (`apps/web/src/components/OfflineRecoveryBanner.tsx`)
- **Visibility**: Automatically mounts globally via `RootLayout`.
- **States**:
  - **Offline**: Amber/Red glassmorphic banner displaying disconnection duration and paused updates notification with a "Retry" button.
  - **Reconnecting**: Shows an animated spinner and disables redundant clicks while checking backend reachability.
  - **Restored**: Briefly displays a vibrant emerald confirmation ("Connection restored. Resumed real-time ledger monitoring.") for 4 seconds before auto-dismissing.
- **Accessibility**: Implements ARIA live region (`aria-live="polite"`, `role="status"`).

### 3. `ErrorBoundary` (`apps/web/src/components/ErrorBoundary.tsx`)
- Component-level boundary for granular fault isolation.
- Prevents an error in one inspector (e.g., 3D network visualizer or Dead-Letter queue) from crashing the rest of the dashboard.
- Renders an error card displaying error details, sanitization, and a "Try Again" retry action that resets internal boundary state.
- Supports `resetKeys` prop to automatically reset when query parameters or active IDs change.

### 4. `LoadingState` (`apps/web/src/components/LoadingState.tsx`)
- Standardized skeleton and spinner components with three variants:
  - `page`: Full-page centered dual-ring pulse loader for route transitions.
  - `card`: Skeleton card loader matching the dashboard layout grid.
  - `inline`: Lightweight spinner for modal actions and button submissions.

---

## Route Boundaries

| Route | Error Boundary | Loading State | Specific Features |
|---|---|---|---|
| **Dashboard** (`/dashboard`) | `apps/web/src/app/(app)/dashboard/error.tsx` | `apps/web/src/app/(app)/dashboard/loading.tsx` | Retryable ledger telemetry with quick-retry button; skeleton metric cards. |
| **Telegram Mini App** (`/tma`) | `apps/web/src/app/tma/error.tsx` | `apps/web/src/app/tma/loading.tsx` | Mobile-optimized, touch-friendly retry button, HMAC validation error handling. |
| **Inspectors** (`/inspectors`) | `apps/web/src/app/(app)/inspectors/error.tsx` | `apps/web/src/app/(app)/inspectors/loading.tsx` | DLQ & ledger inspection fault isolation; payment audit history retry. |
| **Settings** (`/settings`) | `apps/web/src/app/(app)/settings/error.tsx` | `apps/web/src/app/(app)/settings/loading.tsx` | Preferences and MFA recovery state. |

---

## Testing Strategy

- **Unit Tests**:
  - `apps/web/src/components/__tests__/offline-recovery.test.tsx`: Tests `useNetworkStatus` online/offline events, reconnection callback dispatch, and `OfflineRecoveryBanner` rendering states.
  - `apps/web/src/components/__tests__/error-boundary.test.tsx`: Tests error catching, retry button invocation, and `LoadingState` variants.
- All 133 frontend tests in `apps/web` pass cleanly (`npm run test --workspace=web`).
