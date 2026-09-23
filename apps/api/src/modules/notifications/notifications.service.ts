/**
 * Notifications Service
 * 
 * Handles notification preference updates with MFA protection.
 */

import { prisma } from '../../lib/prisma';
import { mfaService } from '../auth/mfa.service';

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

  /**
   * Sends a one-off test message on a configured channel so a user can
   * confirm the link works (e.g. from the onboarding wizard) before relying
   * on it for real payment alerts.
   *
   * @param userId - User ID
   * @param channel - Which channel to ping. Only 'telegram' is supported today.
   */
  async sendTestPing(
    userId: string,
    channel: 'telegram'
  ): Promise<{ success: boolean; message: string }> {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });

    if (channel !== 'telegram') {
      throw new Error(`Unsupported test ping channel: ${channel}`);
    }

    if (!prefs?.telegramChatId) {
      throw new Error('No Telegram chat ID is linked for this user yet');
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error('Telegram bot is not configured');
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: prefs.telegramChatId,
          text: '✅ Stellar Alerts test ping — your Telegram alerts are connected.',
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return { success: false, message: `Telegram responded with status ${response.status}` };
      }

      return { success: true, message: 'Test message sent to your linked Telegram chat.' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to reach Telegram' };
    }
  }
}

export const notificationsService = new NotificationsService();
