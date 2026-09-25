/**
 * Notifications Service
 * 
 * Handles notification preference updates with MFA protection.
 */

import { prisma } from '../../lib/prisma';
import { mfaService } from '../auth/mfa.service';
import { encryptPersonalField, decryptPersonalField } from '../../utils/privacy';

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

    const dataToSave = {
      ...preferences,
      telegramChatId: preferences.telegramChatId ? encryptPersonalField(preferences.telegramChatId) : preferences.telegramChatId,
      whatsappNumber: preferences.whatsappNumber ? encryptPersonalField(preferences.whatsappNumber) : preferences.whatsappNumber,
    };

    // Update preferences with encrypted PII (#314)
    await prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...dataToSave,
      },
      update: dataToSave,
    });

    console.log(`[NotificationsService] ✅ Preferences updated for user ${userId}`);
  }

  /**
   * Get notification preferences for a user.
   * 
   * @param userId - User ID
   */
  async getPreferences(userId: string) {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (!pref) return null;
    return {
      ...pref,
      telegramChatId: decryptPersonalField(pref.telegramChatId),
      whatsappNumber: decryptPersonalField(pref.whatsappNumber),
    };
  }
}

export const notificationsService = new NotificationsService();
