import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistDeadLetter } from '../dead-letter';

const mockPrisma = vi.hoisted(() => ({
  deadLetter: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'dl-1' }),
  },
}));

vi.mock('../prisma', () => ({
  prisma: mockPrisma,
}));

import { prisma } from '../prisma';

describe('persistDeadLetter (#273)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockPrisma.deadLetter.findFirst as any).mockResolvedValue(null);
    (mockPrisma.deadLetter.create as any).mockResolvedValue({ id: 'dl-1' });
  });

  const capture = {
    deliveryKey: 'dl-key-1',
    paymentId: 'pay-1',
    userId: 'user-1' as string | null,
    channel: 'telegram',
    destination: 'chat-1' as string | null,
    payload: { event: 'payment.received' },
    error: 'Telegram API responded with 429',
  };

  it('creates a dead-letter row for a failed delivery', async () => {
    await persistDeadLetter(capture);

    expect(prisma.deadLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryKey: 'dl-key-1',
          paymentId: 'pay-1',
          userId: 'user-1',
          channel: 'telegram',
          destination: 'chat-1',
          status: 'pending',
          error: 'Telegram API responded with 429',
        }),
      }),
    );
  });

  it('does not duplicate a dead-letter already pending for the same delivery key', async () => {
    (mockPrisma.deadLetter.findFirst as any).mockResolvedValue({ id: 'existing-dl' });

    const id = await persistDeadLetter(capture);

    expect(id).toBe('existing-dl');
    expect(mockPrisma.deadLetter.findFirst).toHaveBeenCalledWith({
      where: { deliveryKey: 'dl-key-1', status: 'pending' },
      select: { id: true },
    });
    expect(prisma.deadLetter.create).not.toHaveBeenCalled();
  });

  it('always writes a row when no delivery key is known', async () => {
    await persistDeadLetter({ channel: 'email', paymentId: 'pay-9', destination: null, error: 'boom' });

    expect(mockPrisma.deadLetter.findFirst).not.toHaveBeenCalled();
    expect(prisma.deadLetter.create).toHaveBeenCalledTimes(1);
  });

  it('swallows persistence errors so alert processing never crashes', async () => {
    (mockPrisma.deadLetter.create as any).mockRejectedValue(new Error('db down'));

    await expect(persistDeadLetter(capture)).resolves.toBeNull();
  });

  it('passes a null destination and userId through safely', async () => {
    await persistDeadLetter({
      paymentId: 'pay-2',
      userId: null,
      channel: 'email',
      destination: null,
      payload: {},
      error: 'boom',
    });

    expect(prisma.deadLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: 'pay-2',
          userId: null,
          channel: 'email',
          destination: null,
        }),
      }),
    );
  });

  it('truncates long error messages to 4000 chars', async () => {
    await persistDeadLetter({ ...capture, error: 'x'.repeat(5000) });

    expect(prisma.deadLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: 'x'.repeat(4000) }),
      }),
    );
  });
});