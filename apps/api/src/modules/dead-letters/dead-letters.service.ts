import { prisma } from '../../lib/prisma';
import { buildDeliveryKey } from '../../lib/delivery';
import { processAlertDispatch, type AlertJobData } from '../../lib/queue';

export interface DeadLetterListParams {
  channel?: string;
  status?: 'pending' | 'retried' | 'suppressed';
  q?: string;
  maxAgeDays?: number;
  page?: number;
  pageSize?: number;
}

export interface ReplayResult {
  success: boolean;
  message: string;
}

/**
 * Extracts the canonical `AlertJobData` that processAlertDispatch needs from a
 * dead letter's stored payload. Queue-channel dead letters persist the raw job
 * data; channel dead letters (telegram/email/webhook) persist the webhook
 * payload envelope with the payment fields under `data`.
 */
function toAlertJobData(payload: unknown): AlertJobData | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, any>;

  const candidate = value.walletId && value.txHash ? value : value.data ?? null;
  if (!candidate || typeof candidate !== 'object') return null;

  if (typeof candidate.paymentId !== 'string') return null;
  return {
    paymentId: candidate.paymentId,
    txHash: candidate.txHash ?? 'unknown',
    walletId: candidate.walletId ?? '',
    amount: typeof candidate.amount === 'string' ? candidate.amount : String(candidate.amount ?? '0'),
    asset: candidate.asset ?? 'XLM',
    assetIssuer: candidate.assetIssuer ?? null,
    fromAddress: candidate.fromAddress ?? '',
    receivedAt: candidate.receivedAt ?? new Date().toISOString(),
    requestId: undefined,
  };
}

export class DeadLettersService {
  async list(userId: string, params: DeadLetterListParams = {}) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const where: Record<string, any> = { userId };

    if (params.channel) {
      where.channel = params.channel;
    }
    if (params.status) {
      where.status = params.status;
    }
    if (params.maxAgeDays) {
      const since = new Date(Date.now() - params.maxAgeDays * 24 * 60 * 60 * 1000);
      where.failedAt = { gte: since };
    }
    if (params.q) {
      where.OR = [
        { error: { contains: params.q, mode: 'insensitive' } },
        { destination: { contains: params.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.deadLetter.findMany({
        where,
        orderBy: { failedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          deliveryKey: true,
          paymentId: true,
          channel: true,
          destination: true,
          error: true,
          status: true,
          retryCount: true,
          failedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.deadLetter.count({ where }),
    ]);

    return {
      items,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async get(id: string, userId: string) {
    const deadLetter = await prisma.deadLetter.findFirst({
      where: { id, userId },
      include: {
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!deadLetter) {
      throw new Error('Dead letter not found');
    }
    return deadLetter;
  }

  /**
   * Replays a dead letter through the real dispatch pipeline. Delivered
   * channels are skipped by the idempotency gate and concurrent replays of the
   * same dead letter collapse to a single provider request (#272), so replay
   * never double-sends.
   */
  async replay(id: string, userId: string): Promise<ReplayResult> {
    const deadLetter = await this.get(id, userId);

    if (deadLetter.status === 'suppressed') {
      throw new Error('Suppressed dead letters cannot be replayed');
    }

    const data = toAlertJobData(deadLetter.payload);
    if (!data) {
      throw new Error('Dead letter has no replayable payload');
    }

    await processAlertDispatch(data);

    const delivered = await this.deliverySucceeded(deadLetter);

    await prisma.deadLetter.update({
      where: { id: deadLetter.id },
      data: {
        retryCount: { increment: 1 },
        status: delivered ? 'retried' : 'pending',
      },
    });

    await prisma.deadLetterAudit.create({
      data: {
        deadLetterId: deadLetter.id,
        actorUserId: userId,
        action: delivered ? 'retry' : 'retry_failed',
        note: delivered
          ? 'Replayed through dispatch pipeline; provider acknowledged delivery'
          : 'Replay completed but no delivered attempt was recorded',
      },
    });

    return {
      success: delivered,
      message: delivered
        ? 'Replayed; provider acknowledged the delivery'
        : 'Replay completed but delivery did not reach the provider',
    };
  }

  async suppress(id: string, userId: string, note?: string) {
    const deadLetter = await this.get(id, userId);

    if (deadLetter.status === 'suppressed') {
      throw new Error('Dead letter is already suppressed');
    }

    const [updated] = await prisma.$transaction([
      prisma.deadLetter.update({
        where: { id: deadLetter.id },
        data: { status: 'suppressed' },
      }),
      prisma.deadLetterAudit.create({
        data: {
          deadLetterId: deadLetter.id,
          actorUserId: userId,
          action: 'suppress',
          note: note ?? 'Suppressed by operator',
        },
      }),
    ]);

    return updated;
  }

  private async deliverySucceeded(deadLetter: {
    deliveryKey: string | null;
    paymentId: string | null;
    channel: string;
    destination: string | null;
  }): Promise<boolean> {
    const deliveryKey =
      deadLetter.paymentId && deadLetter.destination
        ? buildDeliveryKey(deadLetter.paymentId, deadLetter.channel, deadLetter.destination)
        : deadLetter.deliveryKey;

    if (!deliveryKey) return false;

    const attempt = await prisma.notificationDeliveryAttempt.findFirst({
      where: { deliveryKey, status: 'delivered' },
      select: { id: true },
    });
    return attempt !== null;
  }
}

export const deadLettersService = new DeadLettersService();