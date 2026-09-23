/**
 * Notifications Adapter
 *
 * Handles notification-preference and test-ping API calls used by the
 * onboarding wizard and the notification settings modal.
 */

import { NotificationPreferenceDTO } from '@stellar-alerts/shared';
import { ApiAdapter } from './api.adapter';

export interface UpdatePreferencesInput {
  telegramChatId?: string;
  telegramEnabled?: boolean;
  emailEnabled?: boolean;
  whatsappNumber?: string;
  whatsappEnabled?: boolean;
  mfaToken?: string;
}

export interface TestPingResult {
  success: boolean;
  message: string;
}

export class NotificationsAdapter extends ApiAdapter {
  async getPreferences(): Promise<NotificationPreferenceDTO | Record<string, never>> {
    const response = await this.get<{ success: boolean; preferences: NotificationPreferenceDTO }>(
      '/notifications/preferences',
    );
    return response.preferences;
  }

  async updatePreferences(data: UpdatePreferencesInput): Promise<void> {
    await this.post('/notifications/preferences', data);
  }

  async sendTestPing(channel: 'telegram'): Promise<TestPingResult> {
    // Test-ping failures (e.g. a not-yet-verified chat ID) are expected,
    // recoverable outcomes, not request errors — surface them as a typed
    // result rather than throwing, unlike ApiAdapter's default `!success`
    // handling.
    const response = await fetch(`${this.config.baseUrl}/notifications/test-ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.getAuthHeaders(),
      },
      body: JSON.stringify({ channel }),
    });

    const data = await response.json();
    return { success: Boolean(data.success), message: data.message || data.error || 'Unknown error' };
  }
}
