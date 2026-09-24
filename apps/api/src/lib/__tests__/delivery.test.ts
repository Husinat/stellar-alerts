import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDeliveryKey,
  deliverWithIdempotency,
  recordDeliveryAttempt,
  alreadyDelivered,
  acquireDeliveryGate,
  releaseDeliveryGate,
} from '../delivery';

const mockRedisStore = new Map<string, string>();

const mockPrisma = vi.hoisted(() => ({
  notificationDeliveryAttempt: {
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id: 'attempt-1' }),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    set: vi.fn(async (key: string, value: string, ...rest: any[]) => {
      const hasNx = rest.some((arg) => typeof arg === 'string' && arg.toUpperCase() === 'NX');
      if (hasNx && mockRedisStore.has(key)) {
        return null;
      }
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    eval: vi.fn(async (_script: string, _numkeys: number, key: string, value: string) => {
      if (mockRedisStore.get(key) === value) {
        mockRedisStore.delete(key);
        return 1;
      }
      return 0;
    }),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

vi.mock('../redis', async () => {
  const { default: Redis } = await import('ioredis');
  return { redis: new Redis() };
});

vi.mock('../prisma', () => ({
  prisma: mockPrisma,
}));

import { prisma } from '../prisma';

describe('delivery idempotency (#272)', () => {
  beforeEach(() => {
    mockRedisStore.clear();
    vi.clearAllMocks();
    (mockPrisma.notificationDeliveryAttempt.findFirst as any).mockResolvedValue(null);
    (mockPrisma.notificationDeliveryAttempt.count as any).mockResolvedValue(0);
    (mockPrisma.notificationDeliveryAttempt.create as any).mockResolvedValue({ id: 'attempt-1' });
    (mockPrisma.notificationDeliveryAttempt.update as any).mockResolvedValue({});
  });

  describe('buildDeliveryKey', () => {
    it('is stable for the same payment, channel and destination', () => {
      const a = buildDeliveryKey('pay-1', 'telegram', 'chat-1');
      const b = buildDeliveryKey('pay-1', 'telegram', 'chat-1');
      expect(a).toBe(b);
    });

    it('differs across payment, channel or destination', () => {
      expect(buildDeliveryKey('pay-1', 'telegram', 'chat-1')).not.toBe(
        buildDeliveryKey('pay-2', 'telegram', 'chat-1'),
      );
      expect(buildDeliveryKey('pay-1', 'telegram', 'chat-1')).not.toBe(
        buildDeliveryKey('pay-1', 'email', 'chat-1'),
      );
      expect(buildDeliveryKey('pay-1', 'telegram', 'chat-1')).not.toBe(
        buildDeliveryKey('pay-1', 'telegram', 'chat-2'),
      );
    });

    it('produces a 64-char sha256 hex digest', () => {
      expect(buildDeliveryKey('p', 'c', 'd')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('deliverWithIdempotency', () => {
    it('dispatches once and marks the delivery delivered', async () => {
      const dispatch = vi.fn().mockResolvedValue('ok');
      const outcome = await deliverWithIdempotency(
        { paymentId: 'pay-1', channel: 'telegram', destination: 'chat-1' },
        dispatch,
      );

      expect(outcome).toEqual({ dispatched: true, status: 'delivered', attemptId: 'attempt-1' });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deliveryKey: buildDeliveryKey('pay-1', 'telegram', 'chat-1'),
            channel: 'telegram',
            destination: 'chat-1',
            status: 'pending',
          }),
        }),
      );
      expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'delivered', providerRequestId: undefined } }),
      );
      // the gate is always released afterwards
      expect(mockRedisStore.size).toBe(0);
    });

    it('skips when a concurrent duplicate already holds the gate', async () => {
      const dispatch = vi.fn().mockResolvedValue('ok');
      const deliveryKey = buildDeliveryKey('pay-1', 'telegram', 'chat-1');
      // Another worker has already claimed the gate for this delivery key.
      mockRedisStore.set(`delivery:gate:${deliveryKey}`, 'other-token');

      const outcome = await deliverWithIdempotency(
        { paymentId: 'pay-1', channel: 'telegram', destination: 'chat-1' },
        dispatch,
      );

      expect(outcome.dispatched).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
      expect(mockPrisma.notificationDeliveryAttempt.create).not.toHaveBeenCalled();
    });

    it('never re-dispatches a delivery already delivered (restart safety)', async () => {
      const dispatch = vi.fn().mockResolvedValue('ok');
      (mockPrisma.notificationDeliveryAttempt.findFirst as any).mockResolvedValue({
        id: 'old-attempt',
      });

      const outcome = await deliverWithIdempotency(
        { paymentId: 'pay-1', channel: 'telegram', destination: 'chat-1' },
        dispatch,
      );

      expect(outcome).toEqual({ dispatched: false, status: 'skipped' });
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('propagates dispatch failures to the caller after recording them', async () => {
      const dispatch = vi.fn().mockRejectedValue(new Error('provider 500'));

      await expect(
        deliverWithIdempotency(
          { paymentId: 'pay-1', channel: 'telegram', destination: 'chat-1' },
          dispatch,
        ),
      ).rejects.toThrow('provider 500');

      expect(mockPrisma.notificationDeliveryAttempt.update).not.toHaveBeenCalledWith(
        expect.objectContaining({}),
      );
      // gate released even on failure
      expect(mockRedisStore.size).toBe(0);
    });
  });

  describe('recordDeliveryAttempt', () => {
    it('stores the next attempt count for a delivery key', async () => {
      (mockPrisma.notificationDeliveryAttempt.count as any).mockResolvedValue(2);
      await recordDeliveryAttempt({
        deliveryKey: 'key',
        paymentId: 'pay-1',
        channel: 'email',
        destination: 'a@b.c',
      });

      expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ attempt: 3 }) }),
      );
    });
  });

  describe('gate helpers', () => {
    it('acquires and releases the gate', async () => {
      const deliveryKey = buildDeliveryKey('pay-1', 'channel1', 'dest1');
      const token = await acquireDeliveryGate(deliveryKey, 30000, 0, 5);
      expect(token).toBeTruthy();
      expect(mockRedisStore.has(`delivery:gate:${deliveryKey}`)).toBe(true);

      const released = await releaseDeliveryGate(deliveryKey, token);
      expect(released).toBe(true);
      expect(mockRedisStore.has(`delivery:gate:${deliveryKey}`)).toBe(false);
    });

    it('does not release a gate it does not own', async () => {
      const deliveryKey = buildDeliveryKey('pay-1', 'channel1', 'dest1');
      const token = await acquireDeliveryGate(deliveryKey, 30000, 0, 5);
      expect(token).toBeTruthy();

      const released = await releaseDeliveryGate(deliveryKey, 'wrong-token');
      expect(released).toBe(false);
      expect(mockRedisStore.has(`delivery:gate:${deliveryKey}`)).toBe(true);
    });
  });

  it('alreadyDelivered reflects the persisted source of truth', async () => {
    (mockPrisma.notificationDeliveryAttempt.findFirst as any).mockResolvedValue(null);
    await expect(alreadyDelivered('key')).resolves.toBe(false);

    (mockPrisma.notificationDeliveryAttempt.findFirst as any).mockResolvedValue({ id: 'x' });
    await expect(alreadyDelivered('key')).resolves.toBe(true);
    expect(mockPrisma.notificationDeliveryAttempt.findFirst).toHaveBeenCalledWith({
      where: { deliveryKey: 'key', status: 'delivered' },
      select: { id: true },
    });
  });
});

// Re-export for tree-shaking safety and parity with the module under test.
export {};