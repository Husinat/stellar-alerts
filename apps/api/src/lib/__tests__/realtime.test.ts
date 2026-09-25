import { describe, it, expect, vi, beforeEach } from 'vitest';

const publish = vi.fn();

vi.mock('../redis', () => ({
  redis: {
    publish: (...args: unknown[]) => publish(...args),
  },
}));

import { publishPaymentEvent, publishDeliveryEvent, REALTIME_CHANNELS } from '../realtime';

describe('realtime publish helpers', () => {
  beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue(1);
  });

  it('publishes a payment event to the payments channel with the owning userId', async () => {
    const payment = { id: 'pay_1', walletId: 'wallet_1', amount: '10' };
    await publishPaymentEvent('user_1', payment);

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, raw] = publish.mock.calls[0];
    expect(channel).toBe(REALTIME_CHANNELS.PAYMENTS);

    const envelope = JSON.parse(raw);
    expect(envelope.userId).toBe('user_1');
    expect(envelope.type).toBe('payment');
    expect(envelope.payload).toEqual(payment);
    expect(typeof envelope.timestamp).toBe('string');
  });

  it('publishes a delivery event to the deliveries channel with the owning userId', async () => {
    const delivery = { id: 'log_1', webhookId: 'wh_1', statusCode: 200 };
    await publishDeliveryEvent('user_2', delivery);

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, raw] = publish.mock.calls[0];
    expect(channel).toBe(REALTIME_CHANNELS.DELIVERIES);

    const envelope = JSON.parse(raw);
    expect(envelope.userId).toBe('user_2');
    expect(envelope.type).toBe('delivery');
    expect(envelope.payload).toEqual(delivery);
  });

  it('does not throw when Redis publish fails (best-effort delivery)', async () => {
    publish.mockRejectedValue(new Error('redis unreachable'));
    await expect(publishPaymentEvent('user_1', { id: 'pay_1' })).resolves.toBeUndefined();
  });
});
