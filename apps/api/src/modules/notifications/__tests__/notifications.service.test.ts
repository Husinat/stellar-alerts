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

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        update: expect.objectContaining({ whatsappEnabled: true, whatsappNumber: '+14155551234' }),
      }),
    );
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
