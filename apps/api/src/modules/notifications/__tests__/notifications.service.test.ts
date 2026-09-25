import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => {
  return {
    prisma: {
      notificationPreference: {
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    },
  };
});

vi.mock('../../auth/mfa.service', () => {
  return {
    mfaService: {
      isMFAEnabled: vi.fn().mockResolvedValue(false),
      verifyMFAToken: vi.fn().mockResolvedValue(true),
    },
  };
});

import { notificationsService } from '../notifications.service';
import { prisma } from '../../../lib/prisma';
import { decryptPersonalField } from '../../../utils/privacy';

describe('NotificationsService.sendTestPing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'test-bot-token' };
    (prisma.notificationPreference.findUnique as any).mockResolvedValue({
      telegramChatId: 'chat-123',
    });
  });

  it('rejects unsupported channels', async () => {
    await expect(notificationsService.sendTestPing('user-1', 'sms' as any)).rejects.toThrow(
      'Unsupported test ping channel: sms',
    );
  });

  it('rejects when no Telegram chat ID is linked yet', async () => {
    (prisma.notificationPreference.findUnique as any).mockResolvedValue(null);

    await expect(notificationsService.sendTestPing('user-1', 'telegram')).rejects.toThrow(
      'No Telegram chat ID is linked for this user yet',
    );
  });

  it('rejects when the Telegram bot is not configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    await expect(notificationsService.sendTestPing('user-1', 'telegram')).rejects.toThrow(
      'Telegram bot is not configured',
    );
  });

  it('sends a test message and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await notificationsService.sendTestPing('user-1', 'telegram');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.telegram.org/bottest-bot-token/sendMessage'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"chat_id":"chat-123"'),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('reports failure when Telegram responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const result = await notificationsService.sendTestPing('user-1', 'telegram');

    expect(result).toEqual({ success: false, message: 'Telegram responded with status 403' });

    vi.unstubAllGlobals();
  });

  it('reports failure when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));

    const result = await notificationsService.sendTestPing('user-1', 'telegram');

    expect(result).toEqual({ success: false, message: 'network unreachable' });

    vi.unstubAllGlobals();
  });
});

describe('NotificationsService.updatePreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists preferences when MFA is not enabled', async () => {
    await notificationsService.updatePreferences('user-1', { telegramChatId: 'chat-1', telegramEnabled: true });

    // telegramChatId is encrypted at rest (see #314), so assert everything
    // else exactly and only check the chat ID round-trips through the vault
    // rather than matching it as plaintext.
    const call = (prisma.notificationPreference.upsert as any).mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'user-1' });
    expect(call.create).toMatchObject({ userId: 'user-1', telegramEnabled: true });
    expect(call.update).toMatchObject({ telegramEnabled: true });
    expect(decryptPersonalField(call.create.telegramChatId)).toBe('chat-1');
    expect(decryptPersonalField(call.update.telegramChatId)).toBe('chat-1');
  });
});

describe('NotificationsService whatsapp opt-in/opt-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.notificationPreference.findUnique as any).mockResolvedValue(null);
  });

  it('rejects an enable request with no number on file and none provided', async () => {
    await expect(
      notificationsService.updatePreferences('user-1', { whatsappEnabled: true }),
    ).rejects.toThrow('A valid WhatsApp number is required to enable WhatsApp notifications');

    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed WhatsApp number regardless of enabled state', async () => {
    await expect(
      notificationsService.updatePreferences('user-1', { whatsappNumber: 'not-a-number' }),
    ).rejects.toThrow('Invalid WhatsApp number');

    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('accepts opt-in with a valid E.164 number and persists it', async () => {
    await notificationsService.updatePreferences('user-1', {
      whatsappEnabled: true,
      whatsappNumber: '+14155551234',
    });

    // whatsappNumber is encrypted at rest (see #314); assert everything
    // else exactly and check the number round-trips through the vault
    // rather than matching it as plaintext.
    const call = (prisma.notificationPreference.upsert as any).mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'user-1' });
    expect(call.update).toMatchObject({ whatsappEnabled: true });
    expect(decryptPersonalField(call.update.whatsappNumber)).toBe('+14155551234');
  });

  it('accepts opt-in referencing a number already saved from a prior update', async () => {
    (prisma.notificationPreference.findUnique as any).mockResolvedValue({
      whatsappNumber: '+14155551234',
    });

    await notificationsService.updatePreferences('user-1', { whatsappEnabled: true });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalled();
  });

  it('allows opting out without providing or validating a number', async () => {
    await notificationsService.updatePreferences('user-1', { whatsappEnabled: false });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ whatsappEnabled: false }),
      }),
    );
  });
});
