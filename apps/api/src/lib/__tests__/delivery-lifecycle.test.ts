import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDeliveryKey,
  isTerminalDeliveryStatus,
  validateDeliveryTransition,
  getOrCreateDelivery,
  recordDeliveryAttempt,
  markDeliveryDelivered,
  markDeliveryFailed,
  markDeliverySuppressed,
  alreadyDelivered,
  TERMINAL_DELIVERY_STATES,
} from '../delivery';

const mockPrisma = vi.hoisted(() => ({
  notificationDelivery: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  notificationDeliveryAttempt: {
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../prisma', () => ({
  prisma: mockPrisma,
}));

describe('Notification Delivery Database Uniqueness & Lifecycle Rules (#306)', () => {
  const paymentId = 'pay-123';
  const channel = 'telegram';
  const destination = 'tg-chat-999';
  const userId = 'user-001';
  const deliveryKey = buildDeliveryKey(paymentId, channel, destination);

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.notificationDelivery.findUnique.mockResolvedValue(null);
    mockPrisma.notificationDelivery.upsert.mockResolvedValue({
      id: 'del-1',
      deliveryKey,
      paymentId,
      channel,
      destination,
      userId,
      status: 'pending',
      currentAttempt: 0,
      maxAttempts: 5,
    });
    mockPrisma.notificationDelivery.update.mockResolvedValue({});
    mockPrisma.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.notificationDeliveryAttempt.findFirst.mockResolvedValue(null);
    mockPrisma.notificationDeliveryAttempt.count.mockResolvedValue(0);
    mockPrisma.notificationDeliveryAttempt.create.mockResolvedValue({ id: 'att-1' });
    mockPrisma.notificationDeliveryAttempt.update.mockResolvedValue({
      id: 'att-1',
      deliveryKey,
      deliveryId: 'del-1',
    });
  });

  describe('Logical Delivery Identity & Uniqueness', () => {
    it('generates a deterministic deliveryKey across paymentId, channel, and destination', () => {
      const key1 = buildDeliveryKey('pay-abc', 'webhook', 'https://example.com/hook');
      const key2 = buildDeliveryKey('pay-abc', 'webhook', 'https://example.com/hook');
      const key3 = buildDeliveryKey('pay-abc', 'webhook', 'https://other.com/hook');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(typeof key1).toBe('string');
      expect(key1).toHaveLength(64); // SHA-256 hex
    });

    it('creates or retrieves logical delivery via getOrCreateDelivery', async () => {
      const delivery = await getOrCreateDelivery({
        paymentId,
        channel,
        destination,
        userId,
      });

      expect(mockPrisma.notificationDelivery.upsert).toHaveBeenCalledWith({
        where: { deliveryKey },
        update: {},
        create: {
          deliveryKey,
          paymentId,
          channel,
          destination,
          userId,
          status: 'pending',
          maxAttempts: 5,
        },
      });
      expect(delivery.id).toBe('del-1');
    });
  });

  describe('Terminal States & Lifecycle Transitions', () => {
    it('correctly classifies terminal states', () => {
      expect(TERMINAL_DELIVERY_STATES).toContain('delivered');
      expect(TERMINAL_DELIVERY_STATES).toContain('exhausted');
      expect(TERMINAL_DELIVERY_STATES).toContain('suppressed');
      expect(TERMINAL_DELIVERY_STATES).toContain('skipped');

      expect(isTerminalDeliveryStatus('delivered')).toBe(true);
      expect(isTerminalDeliveryStatus('exhausted')).toBe(true);
      expect(isTerminalDeliveryStatus('suppressed')).toBe(true);
      expect(isTerminalDeliveryStatus('skipped')).toBe(true);

      expect(isTerminalDeliveryStatus('pending')).toBe(false);
      expect(isTerminalDeliveryStatus('in_progress')).toBe(false);
      expect(isTerminalDeliveryStatus('failed')).toBe(false);
    });

    it('allows valid lifecycle transitions', () => {
      expect(() => validateDeliveryTransition('pending', 'in_progress')).not.toThrow();
      expect(() => validateDeliveryTransition('in_progress', 'delivered')).not.toThrow();
      expect(() => validateDeliveryTransition('in_progress', 'failed')).not.toThrow();
      expect(() => validateDeliveryTransition('in_progress', 'exhausted')).not.toThrow();
      expect(() => validateDeliveryTransition('failed', 'in_progress')).not.toThrow();
      expect(() => validateDeliveryTransition('failed', 'exhausted')).not.toThrow();
    });

    it('rejects illegal transitions from terminal states', () => {
      expect(() => validateDeliveryTransition('delivered', 'in_progress')).toThrow(
        /terminal state "delivered"/
      );
      expect(() => validateDeliveryTransition('exhausted', 'in_progress')).toThrow(
        /terminal state "exhausted"/
      );
      expect(() => validateDeliveryTransition('suppressed', 'in_progress')).toThrow(
        /terminal state "suppressed"/
      );
    });

    it('rejects invalid state transitions (e.g. pending directly to delivered)', () => {
      expect(() => validateDeliveryTransition('pending', 'delivered')).toThrow(
        /Illegal delivery transition from "pending" to "delivered"/
      );
    });
  });

  describe('Enforcement on Delivery Attempts', () => {
    it('increments attempt number and links attempt to parent logical delivery', async () => {
      mockPrisma.notificationDeliveryAttempt.count.mockResolvedValue(2);
      mockPrisma.notificationDelivery.upsert.mockResolvedValue({ id: 'del-1' });

      const attemptId = await recordDeliveryAttempt({
        deliveryKey,
        paymentId,
        channel,
        destination,
        userId,
      });

      expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith({
        data: {
          deliveryKey,
          deliveryId: 'del-1',
          paymentId,
          channel,
          destination,
          userId,
          status: 'pending',
          attempt: 3,
        },
        select: { id: true },
      });
      expect(attemptId).toBe('att-1');
    });

    it('prevents recording attempt if logical delivery is already in a terminal state', async () => {
      mockPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: 'del-1',
        deliveryKey,
        status: 'delivered',
      });

      await expect(
        recordDeliveryAttempt({
          deliveryKey,
          paymentId,
          channel,
          destination,
        })
      ).rejects.toThrow(/Cannot record attempt for delivery in terminal state "delivered"/);

      expect(mockPrisma.notificationDeliveryAttempt.create).not.toHaveBeenCalled();
    });

    it('marks delivery delivered and sets terminal timestamp', async () => {
      mockPrisma.notificationDeliveryAttempt.update.mockResolvedValue({
        id: 'att-1',
        deliveryKey,
        deliveryId: 'del-1',
      });

      await markDeliveryDelivered('att-1', 'req-provider-123');

      expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: { status: 'delivered', providerRequestId: 'req-provider-123' },
      });

      expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'delivered',
          deliveredAt: expect.any(Date),
          terminalAt: expect.any(Date),
          lastError: null,
        }),
      });
    });

    it('transitions to exhausted when max attempts are reached upon failure', async () => {
      mockPrisma.notificationDeliveryAttempt.update.mockResolvedValue({
        id: 'att-1',
        deliveryKey,
      });

      mockPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: 'del-1',
        deliveryKey,
        currentAttempt: 5,
        maxAttempts: 5,
        status: 'in_progress',
      });

      await markDeliveryFailed('att-1', 'Gateway timeout 504');

      expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'exhausted',
          lastError: 'Gateway timeout 504',
          terminalAt: expect.any(Date),
        }),
      });
    });

    it('keeps failed state retryable if attempts have not reached max', async () => {
      mockPrisma.notificationDeliveryAttempt.update.mockResolvedValue({
        id: 'att-1',
        deliveryKey,
      });

      mockPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: 'del-1',
        deliveryKey,
        currentAttempt: 2,
        maxAttempts: 5,
        status: 'in_progress',
      });

      await markDeliveryFailed('att-1', 'Network reset');

      expect(mockPrisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'failed',
          lastError: 'Network reset',
          terminalAt: null,
        }),
      });
    });

    it('marks delivery suppressed with terminal timestamp', async () => {
      await markDeliverySuppressed(deliveryKey, 'User unsubscribed');

      expect(mockPrisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
        where: { deliveryKey },
        data: expect.objectContaining({
          status: 'suppressed',
          lastError: 'User unsubscribed',
          terminalAt: expect.any(Date),
        }),
      });
    });

    it('alreadyDelivered returns true if logical delivery is in a terminal state', async () => {
      mockPrisma.notificationDelivery.findUnique.mockResolvedValue({
        status: 'delivered',
      });

      const isDone = await alreadyDelivered(deliveryKey);
      expect(isDone).toBe(true);
    });
  });
});
