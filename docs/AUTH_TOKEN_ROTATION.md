# Access-Token Rotation & Refresh-Token Reuse Detection (#315)

## Overview

This document describes the design, implementation, and operational rollout of short-lived access-token rotation, rotating refresh tokens, session-family revocation, and refresh-token reuse detection implemented for Issue #315.

---

## Threat Model & Motivation

Prior implementations relied on long-lived (7-day) session JWTs. If a session token was exfiltrated by an attacker (via XSS, network eavesdropping, or client compromise), the attacker had full access to the user's account for the remainder of the token's lifetime without requiring any interaction or triggering alarms.

To mitigate token theft and credential replay:
1. **Short-lived access tokens (15 minutes)**: Minimize the window of exposure if an access token is leaked.
2. **Rotating refresh tokens (7 days)**: Refresh tokens can be exchanged once for a new token pair. Upon each rotation, the used refresh token is permanently invalidated.
3. **Session families (`familyId`)**: Group tokens issued from a single authentication event (login) into a logical session family.
4. **Automatic reuse detection (Replay defense)**: If an already-used or outdated refresh token is presented, the system detects a replay attack, instantly revokes the entire session family (invalidating both the attacker's and victim's tokens), emits a security alert, and logs a critical event to `SecurityAuditLog`.

---

## Architectural Details

### 1. Token Lifetimes & Cryptographic Claims

| Token Type | Lifetime | Subject Claims | Purpose |
|---|---|---|---|
| **Access Token** | 15 minutes (`ACCESS_TOKEN_TTL_SECONDS = 900`) | `id`, `email`, `familyId`, `jti`, `exp` | Short-lived bearer token for API authorization. |
| **Refresh Token** | 7 days (`REFRESH_TOKEN_TTL_SECONDS = 604800`) | `userId`, `familyId`, `rotationCounter`, `jti`, `tokenType: 'refresh'`, `exp` | Single-use token exchanged for new access & refresh tokens. |

### 2. Database Schema

Two relational tables manage session lifecycle and rotation history:

```prisma
model RefreshSession {
  id               String                @id @default(cuid())
  familyId         String                @unique
  userId           String
  user             User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  currentJti       String                @unique
  rotationCounter  Int                   @default(1)
  isRevoked        Boolean               @default(false)
  revocationReason String?
  expiresAt        DateTime
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt
  history          RefreshTokenHistory[]

  @@index([userId])
  @@index([currentJti])
  @@index([isRevoked])
  @@index([expiresAt])
}

model RefreshTokenHistory {
  id              String         @id @default(cuid())
  familyId        String
  session         RefreshSession @relation(fields: [familyId], references: [familyId], onDelete: Cascade)
  jti             String         @unique
  userId          String
  rotationCounter Int
  isConsumed      Boolean        @default(false)
  consumedAt      DateTime?
  createdAt       DateTime       @default(now())

  @@index([familyId])
  @@index([jti])
  @@index([userId])
}
```

### 3. Dual-Layer Validation (Redis + PostgreSQL)

- **Redis Cache (Fast Path)**:
  - `auth:family:<familyId>:current_jti` stores the active refresh token's JTI.
  - `auth:family:<familyId>:revoked` caches revoked session status (`'1'`).
  - `auth:refresh_jti_used:<jti>` caches consumed JTIs.
  - Fail-safe design: In case Redis is temporarily unavailable or restarting, queries gracefully fall back to PostgreSQL transactions.

---

## State Machine & Reuse Detection Flow

```
   [User Authenticates]
            │
            ▼
    Issue Token Pair (Family: F1)
    - Access Token (15m)
    - Refresh Token (R1, JTI: J1, Counter: 1)
    - Store F1 in DB & Redis (currentJti = J1)
            │
            ▼
   Client calls POST /auth/refresh with R1
            │
            ├──────────────────────────────────────────────┐
            ▼                                              ▼
   [Normal Rotation: J1 is valid]                 [Token Reuse: J1 already consumed]
            │                                              │
  - Mark J1 isConsumed = true                              - REPLAY ATTACK DETECTED!
  - Generate R2 (JTI: J2, Counter: 2)                      - Revoke Family F1 (isRevoked: true)
  - Update session currentJti = J2                         - Cache revocation in Redis
  - Generate new Access Token                              - Log CRITICAL to SecurityAuditLog
  - Return { accessToken, refreshToken: R2 }              - Emit [SecurityAlert]
                                                           - Reject with 401 TOKEN_REUSE_DETECTED
```

---

## API Endpoints

### 1. `POST /auth/refresh`
Exchanges an active refresh token for a newly rotated refresh token and access token.

- **Request Body**:
```json
{
  "refreshToken": "<JWT_REFRESH_TOKEN>"
}
```

- **Successful Response (200 OK)**:
```json
{
  "success": true,
  "accessToken": "<NEW_ACCESS_TOKEN>",
  "refreshToken": "<NEW_REFRESH_TOKEN>",
  "familyId": "48bfa9df-f316-4191-b3b4-f3a2164a66a7",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

- **Replay / Reuse Response (401 Unauthorized)**:
```json
{
  "error": "Unauthorized",
  "code": "TOKEN_REUSE_DETECTED",
  "message": "Refresh token reuse detected. Session family has been revoked."
}
```

- **Session Revoked Response (401 Unauthorized)**:
```json
{
  "error": "Unauthorized",
  "code": "SESSION_REVOKED",
  "message": "Session has been revoked. Please sign in again."
}
```

### 2. `POST /auth/revoke-session`
Requires `Bearer <ACCESS_TOKEN>`. Explicitly revokes a session family (e.g. user clicks "Sign Out" or "Log out of other sessions").

- **Request Body (Optional)**:
```json
{
  "familyId": "48bfa9df-f316-4191-b3b4-f3a2164a66a7"
}
```

- **Response (200 OK)**:
```json
{
  "success": true,
  "message": "Session family revoked successfully."
}
```

---

## Rollout & Compatibility

- **Backward Compatibility**:
  - `verifyMagicLink`, `verifyDIDAuth`, and `verifyTelegramInitData` continue returning `token` (pointing to `accessToken`), preserving full compatibility with legacy clients while exposing `accessToken`, `refreshToken`, `familyId`, and `expiresIn`.
  - Legacy tokens without `familyId` (e.g., existing active tokens prior to migration) continue functioning during their transition window until standard expiration.
