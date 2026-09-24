import { prisma } from './prisma';
import { createLogger } from './logger';
import type { DeliveryChannel } from './delivery';

const deadLetterLog = createLogger({ module: 'DeadLetter' });

/**
 * Capture of a terminal notification failure to persist for inspection, replay
 * and suppression (issue #273).
 */
export interface DeadLetterCapture {
  deliveryKey?: string | null;
  paymentId?: string | null;
  userId?: string | null;
  channel: DeliveryChannel | string;
  destination?: string | null;
  payload?: unknown;
  error: string;
}

/**
 * Persists a terminal notification failure. When a stable delivery key is
 * known, an already-pending dead letter for the same key is not duplicated;
 * otherwise a new row is always written so no failure is silently lost.
 */
export async function persistDeadLetter(input: DeadLetterCapture): Promise<string | null> {
  try {
    if (input.deliveryKey) {
      const existing = await prisma.deadLetter.findFirst({
        where: { deliveryKey: input.deliveryKey, status: 'pending' },
        select: { id: true },
      });
      if (existing) {
        return existing.id;
      }
    }

    const row = await prisma.deadLetter.create({
      data: {
        deliveryKey: input.deliveryKey ?? null,
        paymentId: input.paymentId ?? null,
        userId: input.userId ?? null,
        channel: input.channel,
        destination: input.destination ?? null,
        payload: (input.payload ?? undefined) as any,
        error: input.error ? input.error.substring(0, 4000) : 'Unknown error',
        status: 'pending',
      },
      select: { id: true },
    });
    deadLetterLog.warn(
      { id: row.id, channel: input.channel },
      'Persisted dead-letter for terminal notification failure',
    );
    return row.id;
  } catch (err: any) {
    // Never let dead-letter bookkeeping take down the worker loop itself.
    deadLetterLog.error({ err: err.message }, 'Failed to persist dead-letter');
    return null;
  }
}