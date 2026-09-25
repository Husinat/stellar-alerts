import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetentionService } from '../retention.service';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    notificationDeliveryAttempt: {
      deleteMany: vi.fn(),
    },
    webhookLog: {
      deleteMany: vi.fn(),
    },
    deadLetter: {
      deleteMany: vi.fn(),
    },
    securityAuditLog: {
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';

describe('Data Retention Rules & Cleanup Service (#314)', () => {
  let retentionService: RetentionService;

  beforeEach(() => {
    retentionService = new RetentionService({
      notificationAttemptsRetentionDays: 30,
      webhookLogsRetentionDays: 14,
      deadLettersRetentionDays: 60,
      auditLogsRetentionDays: 90,
    });
    vi.clearAllMocks();
  });

  it('calculates proper cutoff dates for retention periods', () => {
    const now = new Date();
    const cutoff30 = retentionService.getCutoffDate(30);
    const diffDays = Math.round((now.getTime() - cutoff30.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it('purges expired notification records across all data stores based on retention rules', async () => {
    (prisma.notificationDeliveryAttempt.deleteMany as any).mockResolvedValue({ count: 150 });
    (prisma.webhookLog.deleteMany as any).mockResolvedValue({ count: 320 });
    (prisma.deadLetter.deleteMany as any).mockResolvedValue({ count: 12 });
    (prisma.securityAuditLog.deleteMany as any).mockResolvedValue({ count: 45 });

    const report = await retentionService.purgeExpiredNotificationData();

    expect(report.deletedDeliveryAttempts).toBe(150);
    expect(report.deletedWebhookLogs).toBe(320);
    expect(report.deletedDeadLetters).toBe(12);
    expect(report.deletedAuditLogs).toBe(45);

    expect(prisma.notificationDeliveryAttempt.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(prisma.webhookLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(prisma.deadLetter.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['retried', 'suppressed'] },
        createdAt: { lt: expect.any(Date) },
      },
    });
    expect(prisma.securityAuditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });

  it('allows custom overrides of retention windows', async () => {
    (prisma.notificationDeliveryAttempt.deleteMany as any).mockResolvedValue({ count: 5 });
    (prisma.webhookLog.deleteMany as any).mockResolvedValue({ count: 10 });
    (prisma.deadLetter.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.securityAuditLog.deleteMany as any).mockResolvedValue({ count: 1 });

    const report = await retentionService.purgeExpiredNotificationData({
      notificationAttemptsRetentionDays: 7,
      webhookLogsRetentionDays: 3,
    });

    expect(report.deletedDeliveryAttempts).toBe(5);
    expect(prisma.notificationDeliveryAttempt.deleteMany).toHaveBeenCalled();
  });
});
