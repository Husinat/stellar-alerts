import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';

const log = createLogger({ module: 'RetentionService' });

export interface RetentionConfig {
  notificationAttemptsRetentionDays: number;
  webhookLogsRetentionDays: number;
  deadLettersRetentionDays: number;
  auditLogsRetentionDays: number;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  notificationAttemptsRetentionDays: 30, // 30 days
  webhookLogsRetentionDays: 14,          // 14 days
  deadLettersRetentionDays: 60,          // 60 days
  auditLogsRetentionDays: 90,            // 90 days
};

export interface RetentionPurgeReport {
  timestamp: string;
  deletedDeliveryAttempts: number;
  deletedWebhookLogs: number;
  deletedDeadLetters: number;
  deletedAuditLogs: number;
}

export class RetentionService {
  private config: RetentionConfig;

  constructor(config: Partial<RetentionConfig> = {}) {
    this.config = { ...DEFAULT_RETENTION_CONFIG, ...config };
  }

  /**
   * Calculates the cutoff Date for a given number of days in the past.
   */
  public getCutoffDate(days: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff;
  }

  /**
   * Purges expired notification data, logs, dead letters, and audit logs according to retention policy.
   */
  async purgeExpiredNotificationData(overrides: Partial<RetentionConfig> = {}): Promise<RetentionPurgeReport> {
    const activeConfig = { ...this.config, ...overrides };

    const attemptsCutoff = this.getCutoffDate(activeConfig.notificationAttemptsRetentionDays);
    const webhookLogsCutoff = this.getCutoffDate(activeConfig.webhookLogsRetentionDays);
    const deadLettersCutoff = this.getCutoffDate(activeConfig.deadLettersRetentionDays);
    const auditLogsCutoff = this.getCutoffDate(activeConfig.auditLogsRetentionDays);

    log.info(
      `[RetentionService] 🧹 Starting expired notification data cleanup (Attempts: ${activeConfig.notificationAttemptsRetentionDays}d, WebhookLogs: ${activeConfig.webhookLogsRetentionDays}d, DLQ: ${activeConfig.deadLettersRetentionDays}d, Audits: ${activeConfig.auditLogsRetentionDays}d)`,
    );

    // 1. Purge old delivery attempts
    const deletedAttemptsResult = await prisma.notificationDeliveryAttempt.deleteMany({
      where: {
        createdAt: { lt: attemptsCutoff },
      },
    });

    // 2. Purge old webhook delivery logs
    const deletedWebhookLogsResult = await prisma.webhookLog.deleteMany({
      where: {
        createdAt: { lt: webhookLogsCutoff },
      },
    });

    // 3. Purge terminal or suppressed dead-letter records older than retention
    const deletedDeadLettersResult = await prisma.deadLetter.deleteMany({
      where: {
        status: { in: ['retried', 'suppressed'] },
        createdAt: { lt: deadLettersCutoff },
      },
    });

    // 4. Purge old security audit logs
    const deletedAuditLogsResult = await prisma.securityAuditLog.deleteMany({
      where: {
        createdAt: { lt: auditLogsCutoff },
      },
    });

    const report: RetentionPurgeReport = {
      timestamp: new Date().toISOString(),
      deletedDeliveryAttempts: deletedAttemptsResult.count,
      deletedWebhookLogs: deletedWebhookLogsResult.count,
      deletedDeadLetters: deletedDeadLettersResult.count,
      deletedAuditLogs: deletedAuditLogsResult.count,
    };

    log.info(
      `[RetentionService] ✅ Retention purge complete: deleted ${report.deletedDeliveryAttempts} delivery attempts, ${report.deletedWebhookLogs} webhook logs, ${report.deletedDeadLetters} dead letters, ${report.deletedAuditLogs} audit logs.`,
    );

    return report;
  }
}

export const retentionService = new RetentionService();
