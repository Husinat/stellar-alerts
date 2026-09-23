/**
 * Publishes persisted domain events (payments, webhook deliveries) to Redis
 * so the API process's WebSocket plugin (apps/api/src/plugins/websocket.ts)
 * can relay them to the owning user's connected browser clients. Workers
 * (watcher.worker.ts, the BullMQ webhook dispatcher in queue.ts) run in
 * separate processes from the WS server, so Redis pub/sub is the bridge —
 * an in-process EventEmitter would not reach them.
 */
import { redis } from './redis';
import { createLogger } from './logger';

const log = createLogger({ module: 'Realtime' });

export const REALTIME_CHANNELS = {
  PAYMENTS: 'stellar-alerts:payments',
  DELIVERIES: 'stellar-alerts:deliveries',
} as const;

export interface RealtimeEnvelope<T = unknown> {
  userId: string;
  type: 'payment' | 'delivery';
  payload: T;
  timestamp: string;
}

async function publish(channel: string, envelope: RealtimeEnvelope): Promise<void> {
  try {
    await redis.publish(channel, JSON.stringify(envelope));
  } catch (err: any) {
    // Realtime delivery is best-effort — the underlying payment/delivery
    // record is already persisted, so a Redis hiccup must not fail the
    // caller's write path.
    log.warn(`Failed to publish to ${channel}: ${err.message}`);
  }
}

export function publishPaymentEvent(userId: string, payment: unknown): Promise<void> {
  return publish(REALTIME_CHANNELS.PAYMENTS, {
    userId,
    type: 'payment',
    payload: payment,
    timestamp: new Date().toISOString(),
  });
}

export function publishDeliveryEvent(userId: string, delivery: unknown): Promise<void> {
  return publish(REALTIME_CHANNELS.DELIVERIES, {
    userId,
    type: 'delivery',
    payload: delivery,
    timestamp: new Date().toISOString(),
  });
}
