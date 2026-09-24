import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deadLettersService } from '../dead-letters.service';

const mockPrisma = vi.hoisted(() => ({
  deadLetter: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  deadLetterAudit: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  notificationDeliveryAttempt: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockProcessAlertDispatch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('../../../lib/queue', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/queue')>();
  return { ...original, processAlertDispatch: mockProcessAlertDispatch };
});

const userA = 'user-a';
const userB = 'user-b';

const pendingDeadLetter = {
  id: 'dl-1',
  deliveryKey: 'key-1',
  paymentId: 'pay-1',
  userId: userA,
  channel: 'telegram',
  destination: 'chat-1',
  payload: {
    event: 'payment.received',
    data: {
      paymentId: 'pay-1',
      txHash: 'abc',
      amount: '100',
      asset: 'XLM',
      assetIssuer: null,
      fromAddress: 'GABC',
      receivedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  error: 'Telegram API responded with 429',
  status: 'pending',
  retryCount: 0,
  failedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DeadLettersService (#273)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.deadLetter.findMany.mockResolvedValue([]);
    mockPrisma.deadLetter.count.mockResolvedValue(0);
    mockPrisma.deadLetter.findFirst.mockResolvedValue(null);
    mockPrisma.deadLetter.update.mockImplementation(async ({ data }) => ({
      ...pendingDeadLetter,
      ...data,
    }));
    mockPrisma.deadLetterAudit.create.mockResolvedValue({ id: 'audit-1' });
    mockPrisma.deadLetterAudit.findMany.mockResolvedValue([]);
    mockPrisma.notificationDeliveryAttempt.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (queries: any[]) => {
      const results = [];
      for (const q of queries) results.push(await q);
      return results;
    });
    mockProcessAlertDispatch.mockResolvedValue(undefined);
  });

  it('lists only the caller-owned dead letters with pagination', async () => {
    mockPrisma.deadLetter.findMany.mockResolvedValue([{ id: 'dl-1' }]);
    mockPrisma.deadLetter.count.mockResolvedValue(1);

    const result = await deadLettersService.list(userA, { channel: 'telegram', page: 2, pageSize: 10 });

    expect(mockPrisma.deadLetter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: userA, channel: 'telegram' }),
        skip: 10,
        take: 10,
      }),
    );
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 1, totalPages: 1 });
  });

  it('filters by error search and age', async () => {
    await deadLettersService.list(userA, { q: '429', maxAgeDays: 3 });

    expect(mockPrisma.deadLetter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: userA,
          failedAt: { gte: expect.any(Date) },
          OR: [
            { error: { contains: '429', mode: 'insensitive' } },
            { destination: { contains: '429', mode: 'insensitive' } },
          ],
        }),
      }),
    );
  });

  it('returns a dead letter with audit history for its owner', async () => {
    mockPrisma.deadLetter.findFirst.mockResolvedValue({ ...pendingDeadLetter, auditLogs: [] });

    const result = await deadLettersService.get('dl-1', userA);

    expect(mockPrisma.deadLetter.findFirst).toHaveBeenCalledWith({
      where: { id: 'dl-1', userId: userA },
      include: { auditLogs: { orderBy: { createdAt: 'desc' } } },
    });
    expect(result.id).toBe('dl-1');
  });

  it('rejects access to another users dead letter', async () => {
    mockPrisma.deadLetter.findFirst.mockResolvedValue(null);

    await expect(deadLettersService.get('dl-1', userB)).rejects.toThrow('Dead letter not found');
    await expect(deadLettersService.replay('dl-1', userB)).rejects.toThrow('Dead letter not found');
  });

  it('replays through the dispatch pipeline and records a retry audit', async () => {
    mockPrisma.deadLetter.findFirst.mockResolvedValue({ ...pendingDeadLetter });
    mockPrisma.notificationDeliveryAttempt.findFirst.mockResolvedValue({ id: 'new-delivered-attempt' });

    const result = await deadLettersService.replay('dl-1', userA);

    expect(mockProcessAlertDispatch).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(mockPrisma.deadLetter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'retried', retryCount: { increment: 1 } }),
      }),
    );
    expect(mockPrisma.deadLetterAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deadLetterId: 'dl-1', actorUserId: userA, action: 'retry' }),
      }),
    );
  });

  it('keeps the dead letter pending when replay does not reach the provider', async () => {
    mockPrisma.deadLetter.findFirst.mockResolvedValue({ ...pendingDeadLetter });
    mockPrisma.notificationDeliveryAttempt.findFirst.mockResolvedValue(null);

    const result = await deadLettersService.replay('dl-1', userA);

    expect(result.success).toBe(false);
    expect(mockPrisma.deadLetter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', retryCount: { increment: 1 } }),
      }),
    );
    expect(mockPrisma.deadLetterAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'retry_failed' }),
      }),
    );
  });

  it('refuses to replay a suppressed dead letter', async () => {
    mockPrisma.deadLetter.findFirst.mockResolvedValue({ ...pendingDeadLetter, status: 'suppressed' });

    await expect(deadLettersService.replay('dl-1', userA)).rejects.toThrow(
      'Suppressed dead letters cannot be replayed',
    );
    expect(mockProcessAlertDispatch).not.toHaveBeenCalled();
  });

  it('suppresses a dead letter with audit trail in a transaction', async () => {
    mockPrisma.deadLetter.findFirst.mockResolvedValue({ ...pendingDeadLetter });

    await deadLettersService.suppress('dl-1', userA, 'spam');

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.deadLetterAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deadLetterId: 'dl-1', actorUserId: userA, action: 'suppress', note: 'spam' }),
      }),
    );
  });
});