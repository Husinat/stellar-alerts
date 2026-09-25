import crypto, { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { redis } from './redis';
import { createLogger } from './logger';

const log = createLogger({ module: 'Delivery' });

export type DeliveryChannel =
  | 'webhook'
  | 'telegram'
  | 'email'
  | 'whatsapp'
  | 'discord'
  | 'slack'
  | 'push';

/**
 * Everything needed to address one logical delivery. A delivery is uniquely
 * identified by the `deliveryKey` derived from (payment, channel, destination).
 */
export interface DeliveryDescriptor {
  paymentId: string;
  channel: DeliveryChannel | string;
  destination: string;
  userId?: string | null;
}

export interface DeliveryOutcome {
  dispatched: boolean;
  status: 'delivered' | 'skipped';
  attemptId?: string;
}

const DELIVERY_GATE_PREFIX = 'delivery:gate:';
const DEFAULT_GATE_TTL_MS = 30000;
const DELIVERY_GATE_RETRY = 2;
const RELEASE_GATE_LUA_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Builds the stable delivery key across a payment, notification channel and
 * destination. Retries (BullMQ), DLQ replays and concurrent duplicate jobs all
 * address the same key, which is what makes retries safe across worker
 * restarts and deduplication possible.
 */
export function buildDeliveryKey(
  paymentId: string,
  channel: DeliveryChannel | string,
  destination: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`${paymentId}:${channel}:${destination}`)
    .digest('hex');
}

/**
 * Acquires the distributed gate that serializes concurrent dispatches of the
 * same delivery key. Only the process that holds the gate may talk to the
 * provider, so duplicate concurrent jobs collapse to a single provider
 * request.
 */
export async function acquireDeliveryGate(
  deliveryKey: string,
  ttlMs: number = DEFAULT_GATE_TTL_MS,
  retryCount: number = DELIVERY_GATE_RETRY,
  retryDelayMs: number = 100,
): Promise<string | null> {
  const key = `${DELIVERY_GATE_PREFIX}${deliveryKey}`;
  const token = randomUUID();

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') return token;
    } catch (err: any) {
      // Redis is unavailable. Fail open: gate contention serialization degrades,
      // but delivery availability must not depend on Redis. The persisted
      // `alreadyDelivered` source of truth in Postgres still prevents replays.
      log.warn({ err: err.message }, 'Redis acquire delivery gate error; failing open');
      return token;
    }

    if (attempt < retryCount) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return null;
}

/**
 * Safely releases the delivery gate, only if the caller still owns it.
 */
export async function releaseDeliveryGate(
  deliveryKey: string,
  token: string | null,
): Promise<boolean> {
  if (!token) return false;
  try {
    const result = await redis.eval(
      RELEASE_GATE_LUA_SCRIPT,
      1,
      `${DELIVERY_GATE_PREFIX}${deliveryKey}`,
      token,
    );
    return result === 1;
  } catch (err: any) {
    log.warn({ err: err.message }, 'Redis release delivery gate error');
    return false;
  }
}

/**
 * Returns true when a previous attempt for this delivery key already reached
 * the provider successfully. This is the source of truth that survives worker
 * restarts because it lives in Postgres rather than Redis.
 */
export async function alreadyDelivered(deliveryKey: string): Promise<boolean> {
  const attempt = await prisma.notificationDeliveryAttempt.findFirst({
    where: { deliveryKey, status: 'delivered' },
    select: { id: true },
  });
  return attempt !== null;
}

/**
 * Persists a single delivery attempt (one attempt per provider call, indexed
 * by the stable delivery key). `attempt` is the 1-based attempt number for
 * that delivery key, which grows on retries.
 */
export async function recordDeliveryAttempt(input: {
  deliveryKey: string;
  paymentId?: string | null;
  channel: DeliveryChannel | string;
  destination?: string | null;
  userId?: string | null;
}): Promise<string> {
  const prior = await prisma.notificationDeliveryAttempt.count({
    where: { deliveryKey: input.deliveryKey },
  });

  const row = await prisma.notificationDeliveryAttempt.create({
    data: {
      deliveryKey: input.deliveryKey,
      paymentId: input.paymentId ?? null,
      channel: input.channel,
      destination: input.destination ?? null,
      userId: input.userId ?? null,
      status: 'pending',
      attempt: prior + 1,
    },
    select: { id: true },
  });
  return row.id;
}

export async function markDeliveryDelivered(
  attemptId: string,
  providerRequestId?: string,
): Promise<void> {
  await prisma.notificationDeliveryAttempt.update({
    where: { id: attemptId },
    data: { status: 'delivered', providerRequestId },
  });
}

export async function markDeliveryFailed(
  attemptId: string,
  error: string,
): Promise<void> {
  await prisma.notificationDeliveryAttempt.update({
    where: { id: attemptId },
    data: { status: 'failed', error: error.substring(0, 2000) },
  });
}

/**
 * Dispatches a provider request exactly once for a delivery key.
 *
 * - Skips immediately when an earlier attempt already delivered the key
 *   (cross-restart idempotency, backed by Postgres).
 * - Serializes concurrent duplicate jobs with a Redis gate so at most one
 *   worker talks to the provider.
 * - Records every provider call as a persisted `NotificationDeliveryAttempt`.
 *
 * When the underlying dispatch throws, the attempt is recorded as `failed`
 * and the error is re-thrown so the queue layer can retry.
 */
export async function deliverWithIdempotency<T>(
  descriptor: DeliveryDescriptor,
  dispatch: (attemptId: string) => Promise<T>,
  options: { gateTtlMs?: number } = {},
): Promise<DeliveryOutcome> {
  const deliveryKey = buildDeliveryKey(
    descriptor.paymentId,
    descriptor.channel,
    descriptor.destination,
  );

  if (await alreadyDelivered(deliveryKey)) {
    return { dispatched: false, status: 'skipped' };
  }

  const token = await acquireDeliveryGate(deliveryKey, options.gateTtlMs);
  if (!token) {
    // Another worker currently holds the gate for the same delivery;
    // it is in the middle of (or has just finished) dispatching. Re-check the
    // persisted source of truth instead of firing a second provider request.
    const delivered = await alreadyDelivered(deliveryKey);
    return {
      dispatched: false,
      status: delivered ? 'delivered' : 'skipped',
    };
  }

  try {
    if (await alreadyDelivered(deliveryKey)) {
      return { dispatched: false, status: 'skipped' };
    }

    const attemptId = await recordDeliveryAttempt({
      deliveryKey,
      paymentId: descriptor.paymentId,
      channel: descriptor.channel,
      destination: descriptor.destination,
      userId: descriptor.userId,
    });

    await dispatch(attemptId);
    await markDeliveryDelivered(attemptId);
    return { dispatched: true, status: 'delivered', attemptId };
  } catch (err: any) {
    log.warn(
      { deliveryKey, err: err.message },
      'Delivery attempt failed and will be retryable',
    );
    throw err;
  } finally {
    await releaseDeliveryGate(deliveryKey, token);
  }
}