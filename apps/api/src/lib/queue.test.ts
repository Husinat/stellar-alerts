import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Job } from 'bullmq';

const { MockQueueAdd, MockQueueEventsOn, MockWorker } = vi.hoisted(() => ({
  MockQueueAdd: vi.fn().mockResolvedValue(true),
  MockQueueEventsOn: vi.fn(),
  MockWorker: vi.fn(function() {}),
}));

// We mock bullmq before importing queue
vi.mock('bullmq', () => {
  return {
    Queue: vi.fn(function() {
      return { add: MockQueueAdd };
    }),
    QueueEvents: vi.fn(function() {
      return { on: MockQueueEventsOn };
    }),
    Job: {
      fromId: vi.fn(),
    },
    Worker: MockWorker,
  };
});

vi.mock('./prisma', () => {
  return {
    prisma: {
      wallet: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      payment: {
        findUnique: vi.fn(),
      },
      whatsAppDeliveryLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    },
  };
});

vi.mock('../utils/discord', () => {
  return {
    dispatchDiscordAlert: vi.fn().mockResolvedValue(true),
  };
});

const { MockWhatsAppInvalidNumberError } = vi.hoisted(() => ({
  MockWhatsAppInvalidNumberError: class WhatsAppInvalidNumberError extends Error {
    constructor(number: string) {
      super(`"${number}" is not a valid E.164 WhatsApp number`);
      this.name = 'WhatsAppInvalidNumberError';
    }
  },
}));

vi.mock('../utils/whatsapp', () => {
  return {
    dispatchWhatsAppAlert: vi.fn().mockResolvedValue({ success: true, messageSid: 'SM123', status: 'queued', attempts: 1 }),
    WhatsAppInvalidNumberError: MockWhatsAppInvalidNumberError,
  };
});

vi.mock('../utils/webhook-signer', () => {
  return {
    signWebhookPayload: vi.fn().mockResolvedValue({ headerValue: 'test', nonce: 'test' }),
  };
});

vi.mock('resend', () => {
  return {
    Resend: vi.fn(function() {
      return {
        emails: {
          send: vi.fn().mockResolvedValue({ data: { id: 'test_id' }, error: null }),
        },
      };
    }),
  };
});

import { alertQueue, dlqQueue, paymentAlertWorkerProcessor, failedJobHandler, createRedisConnectionConfig } from './queue';
import { prisma } from './prisma';
import { dispatchWhatsAppAlert } from '../utils/whatsapp';

describe('Queue DLQ routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to DLQ when job fails after max attempts', async () => {
    (Job.fromId as any).mockResolvedValue({
      attemptsMade: 5,
      opts: { attempts: 5 },
      data: { txHash: 'test-tx' },
    });

    await failedJobHandler({ jobId: '123', failedReason: 'Test error' });

    expect(MockQueueAdd).toHaveBeenCalledWith(
      'dispatch-alert-failed',
      { txHash: 'test-tx' },
      { jobId: 'dlq-123' }
    );
  });
  
  it('does not route to DLQ if attempts < max attempts', async () => {
    (Job.fromId as any).mockResolvedValue({
      attemptsMade: 3,
      opts: { attempts: 5 },
      data: { txHash: 'test-tx' },
    });

    await failedJobHandler({ jobId: '124', failedReason: 'Test error' });

    expect(MockQueueAdd).not.toHaveBeenCalled();
  });
});

describe('Redis Sentinel Connection Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds standard Redis connection when REDIS_SENTINELS is not set', () => {
    delete process.env.REDIS_SENTINELS;
    const config = createRedisConnectionConfig();

    expect(config).toHaveProperty('host');
    expect(config).toHaveProperty('port');
    expect(config.maxRetriesPerRequest).toBeNull();
  });

  it('builds Sentinel connection options when REDIS_SENTINELS is set', () => {
    process.env.REDIS_SENTINELS = 'sentinel1:26379,sentinel2:26379,sentinel3:26379';
    process.env.REDIS_SENTINEL_MASTER_NAME = 'test-master';

    const config = createRedisConnectionConfig() as any;

    expect(config.sentinels).toHaveLength(3);
    expect(config.sentinels[0]).toEqual({ host: 'sentinel1', port: 26379 });
    expect(config.name).toBe('test-master');
    expect(config.role).toBe('master');
    expect(config.maxRetriesPerRequest).toBeNull();
    expect(typeof config.reconnectOnError).toBe('function');
    expect(config.reconnectOnError(new Error('READONLY You can\'t write against a read only replica.'))).toBe(true);
    expect(config.reconnectOnError(new Error('Some other error'))).toBe(false);
  });
});

describe('Telegram Dispatcher Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('dispatches telegram message when user has valid chatId and enabled', async () => {
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: 'pay-123',
      wallet: {
        user: {
          notifyPrefs: {
            telegramEnabled: true,
            telegramChatId: 'chat-123',
          },
        },
      },
    });

    await paymentAlertWorkerProcessor({
      data: {
        paymentId: 'pay-123',
        amount: '10',
        asset: 'XLM',
        fromAddress: 'GABC...',
        txHash: 'hash-123',
        walletId: 'wallet-123',
        receivedAt: new Date().toISOString(),
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.telegram.org/bot'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"chat_id":"chat-123"'),
      })
    );
  });

  it('does not dispatch telegram message when telegram is disabled', async () => {
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: 'pay-124',
      wallet: {
        user: {
          notifyPrefs: {
            telegramEnabled: false,
            telegramChatId: 'chat-123',
          },
        },
      },
    });

    await paymentAlertWorkerProcessor({
      data: {
        paymentId: 'pay-124',
        amount: '10',
        asset: 'XLM',
        fromAddress: 'GABC...',
        txHash: 'hash-124',
        walletId: 'wallet-124',
        receivedAt: new Date().toISOString(),
      },
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('WhatsApp Dispatcher Worker', () => {
  const originalEnv = process.env;
  const jobData = {
    paymentId: 'pay-wa-1',
    amount: '10',
    asset: 'XLM',
    fromAddress: 'GABC...',
    txHash: 'hash-wa-1',
    walletId: 'wallet-wa-1',
    receivedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      TWILIO_ACCOUNT_SID: 'AC_test',
      TWILIO_AUTH_TOKEN: 'test_token',
      TWILIO_WHATSAPP_FROM: '+14155238886',
    };
    (prisma.whatsAppDeliveryLog.findFirst as any).mockResolvedValue(null);
    (dispatchWhatsAppAlert as any).mockResolvedValue({
      success: true,
      messageSid: 'SM123',
      status: 'queued',
      attempts: 1,
    });
  });

  it('dispatches and logs a successful WhatsApp alert when opted in and Twilio is configured', async () => {
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: jobData.paymentId,
      wallet: {
        user: {
          notifyPrefs: { whatsappEnabled: true, whatsappNumber: '+14155551234' },
        },
      },
    });

    await paymentAlertWorkerProcessor({ data: jobData });

    expect(dispatchWhatsAppAlert).toHaveBeenCalledWith(
      '+14155551234',
      jobData,
      { accountSid: 'AC_test', authToken: 'test_token', fromNumber: '+14155238886' },
    );
    expect(prisma.whatsAppDeliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: jobData.paymentId,
        toNumber: '+14155551234',
        success: true,
        messageSid: 'SM123',
      }),
    });
  });

  it('does not dispatch when whatsappEnabled is false', async () => {
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: jobData.paymentId,
      wallet: {
        user: {
          notifyPrefs: { whatsappEnabled: false, whatsappNumber: '+14155551234' },
        },
      },
    });

    await paymentAlertWorkerProcessor({ data: jobData });

    expect(dispatchWhatsAppAlert).not.toHaveBeenCalled();
  });

  it('does not dispatch when Twilio credentials are not configured', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: jobData.paymentId,
      wallet: {
        user: {
          notifyPrefs: { whatsappEnabled: true, whatsappNumber: '+14155551234' },
        },
      },
    });

    await paymentAlertWorkerProcessor({ data: jobData });

    expect(dispatchWhatsAppAlert).not.toHaveBeenCalled();
  });

  it('skips dispatch for a duplicate job once a successful delivery is already logged', async () => {
    (prisma.whatsAppDeliveryLog.findFirst as any).mockResolvedValue({ id: 'log-1', success: true });
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: jobData.paymentId,
      wallet: {
        user: {
          notifyPrefs: { whatsappEnabled: true, whatsappNumber: '+14155551234' },
        },
      },
    });

    await paymentAlertWorkerProcessor({ data: jobData });

    expect(dispatchWhatsAppAlert).not.toHaveBeenCalled();
    expect(prisma.whatsAppDeliveryLog.create).not.toHaveBeenCalled();
  });

  it('logs an invalid-number failure without throwing when the stored number is malformed', async () => {
    const { WhatsAppInvalidNumberError } = await import('../utils/whatsapp');
    (dispatchWhatsAppAlert as any).mockRejectedValue(new WhatsAppInvalidNumberError('not-a-number'));
    (prisma.payment.findUnique as any).mockResolvedValue({
      id: jobData.paymentId,
      wallet: {
        user: {
          notifyPrefs: { whatsappEnabled: true, whatsappNumber: 'not-a-number' },
        },
      },
    });

    await expect(paymentAlertWorkerProcessor({ data: jobData })).resolves.not.toThrow();

    expect(prisma.whatsAppDeliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ success: false, attempts: 0 }),
    });
  });
});
