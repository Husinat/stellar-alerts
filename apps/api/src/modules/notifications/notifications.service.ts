/**
 * Notifications Service
 * 
 * Handles notification preference updates with MFA protection.
 */

import { prisma } from '../../lib/prisma';
import { mfaService } from '../auth/mfa.service';
import { isValidE164Number } from '../../utils/whatsapp';

export interface NotificationPreferences {
  telegramChatId?: string;
  telegramEnabled?: boolean;
  emailEnabled?: boolean;
  whatsappNumber?: string;
  whatsappEnabled?: boolean;
}

export class NotificationsService {
  /**
   * Update notification preferences (MFA-protected).
   * 
   * @param userId - User ID
   * @param preferences - Notification preferences to update
   * @param mfaToken - TOTP token (required if MFA is enabled)
   */
  async updatePreferences(
    userId: string,
    preferences: NotificationPreferences,
    mfaToken?: string
  ): Promise<void> {
    // Check if MFA is enabled
    const mfaEnabled = await mfaService.isMFAEnabled(userId);

    if (mfaEnabled) {
      // MFA is enabled - require token
      if (!mfaToken) {
        throw new Error('MFA token required');
      }

      const isValid = await mfaService.verifyMFAToken(userId, mfaToken);
      if (!isValid) {
        throw new Error('Invalid MFA token');
      }
    }

    if (preferences.whatsappNumber !== undefined && preferences.whatsappNumber !== null) {
      if (!isValidE164Number(preferences.whatsappNumber)) {
        throw new Error('Invalid WhatsApp number: must be in E.164 format (e.g. +14155551234)');
      }
    }

    if (preferences.whatsappEnabled) {
      const existing = await prisma.notificationPreference.findUnique({ where: { userId } });
      const effectiveNumber = preferences.whatsappNumber ?? existing?.whatsappNumber;
      if (!effectiveNumber || !isValidE164Number(effectiveNumber)) {
        throw new Error('A valid WhatsApp number is required to enable WhatsApp notifications');
      }
    }

    // Update preferences
    await prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...preferences,
      },
      update: preferences,
    });

    console.log(`[NotificationsService] ✅ Preferences updated for user ${userId}`);
  }

  /**
   * Get notification preferences for a user.
   * 
   * @param userId - User ID
   */
  async getPreferences(userId: string) {
    return prisma.notificationPreference.findUnique({
      where: { userId },
    });
  }
}

export const notificationsService = new NotificationsService();
