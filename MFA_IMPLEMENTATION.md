# Multi-Factor Authentication (MFA) Implementation

## Overview

Implements TOTP-based 2FA for protecting sensitive notification settings updates (Issue #91).

## Features

✅ **TOTP Generation** - Uses `otplib` for RFC 6238 compliant TOTP  
✅ **QR Code Setup** - Users scan QR code with authenticator apps (Google Authenticator, Authy, etc.)  
✅ **MFA Protection** - Telegram Chat ID updates require valid 6-digit TOTP token  
✅ **Complete Flow** - Setup → Verify → Enable → Protect Operations  
✅ **Disable Support** - Users can disable MFA with valid token  

## Implementation Details

### Backend (API)

#### Database Schema Changes
```prisma
model User {
  mfaSecret   String?  // TOTP secret (base32)
  mfaEnabled  Boolean  @default(false)
}
```

#### New Files Created
- `apps/api/src/utils/totp.ts` - TOTP generation & verification utilities
- `apps/api/src/modules/auth/mfa.service.ts` - MFA business logic
- `apps/api/src/modules/notifications/notifications.service.ts` - MFA-protected preferences
- `apps/api/src/modules/notifications/notifications.controller.ts` - HTTP handlers
- `apps/api/src/modules/notifications/notifications.routes.ts` - Route definitions

#### API Endpoints

**MFA Management:**
- `POST /auth/mfa/setup` - Generate secret & QR code
- `POST /auth/mfa/enable` - Enable MFA with first token verification
- `POST /auth/mfa/disable` - Disable MFA (requires token)
- `GET /auth/mfa/status` - Check if MFA is enabled

**Protected Operations:**
- `POST /notifications/preferences` - Update notification settings (MFA-protected)
- `GET /notifications/preferences` - Get current preferences

### Frontend (Web)

#### New Components
- `apps/web/src/components/dashboard/MfaModal.tsx` - MFA setup/management UI
- Updated `NotificationModal.tsx` - Added MFA token input field

#### User Flow

1. **Setup MFA:**
   - User clicks "Setup MFA" button
   - Backend generates TOTP secret
   - QR code displayed for scanning
   - User scans with authenticator app

2. **Enable MFA:**
   - User enters 6-digit code from app
   - Backend verifies token
   - MFA enabled on success

3. **Protected Operations:**
   - When updating Telegram Chat ID (sensitive)
   - System checks if MFA enabled
   - If enabled, requires 6-digit token
   - Token verified before allowing update

4. **Disable MFA:**
   - User enters current 6-digit code
   - MFA disabled and secret cleared

## Security Considerations

- ✅ TOTP secrets stored encrypted in database
- ✅ 30-second time window (±30s tolerance)
- ✅ Rate limiting on verification attempts (via existing Fastify rate limit)
- ✅ Secrets cleared on MFA disable
- ✅ MFA verification required for sensitive operations only

## Dependencies Added

```json
{
  "otplib": "^12.0.1",
  "qrcode": "^1.5.3",
  "@types/qrcode": "^1.5.5"
}
```

## Testing

Manual testing steps:

1. **Setup Flow:**
   ```bash
   curl -X POST http://localhost:3001/auth/mfa/setup \
     -H "Authorization: Bearer <token>"
   ```
   - Verify QR code and secret returned

2. **Enable Flow:**
   ```bash
   curl -X POST http://localhost:3001/auth/mfa/enable \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"token": "123456"}'
   ```

3. **Protected Update:**
   ```bash
   curl -X POST http://localhost:3001/notifications/preferences \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"telegramChatId": "123456789", "mfaToken": "123456"}'
   ```

## Migration

Run Prisma migration to add MFA fields:
```bash
cd apps/api
npm run db:push
```

## Acceptance Criteria

✅ User can scan QR code in Authenticator App  
✅ User can verify TOTP token during setup  
✅ Updating Telegram Chat ID requires valid 6-digit TOTP code when MFA enabled  
✅ MFA can be enabled and disabled  
✅ Error handling for invalid tokens  

## Future Enhancements

- [ ] Backup codes for account recovery
- [ ] SMS-based 2FA option
- [ ] MFA enforcement for all users (org-wide policy)
- [ ] Audit log for MFA events
- [ ] Remember device for 30 days

## Closes

Issue #91 - [SECURITY]: Multi-Factor Auth (MFA) TOTP Flow for Sensitive Notification Settings

**Drips Wave Points:** 200 (100 Base + 100 Bonus)
