import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { resolvePoolConfig } from './db-pool';

export type DatabaseTarget = 'PRIMARY' | 'REPLICA';

function createClient(databaseUrl: string, label: string) {
  const config = resolvePoolConfig(databaseUrl);
  console.log(
    `[Prisma] ${label} pool: max=${config.max} connections, acquire timeout=${config.connectionTimeoutMillis}ms, idle timeout=${config.idleTimeoutMillis}ms`
  );

  return new PrismaClient({ adapter: new PrismaPg(config) });
}

const primaryUrl = env.DATABASE_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stellar_alerts';
const replicaUrl = env.READ_REPLICA_URL || process.env.READ_REPLICA_URL;

let primaryClient = createClient(primaryUrl, 'primary');

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const value = (primaryClient as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(primaryClient);
    }
    return value;
  },
});

/**
 * Client for read-only queries. Points at READ_REPLICA_URL when a read
 * replica is configured and falls back to the primary otherwise, so callers can
 * use it unconditionally.
 */
export const prismaRead = replicaUrl ? createClient(replicaUrl, 'replica') : prisma;
export const replicaPrisma = prismaRead;

export let activeReadTarget: DatabaseTarget = 'REPLICA';

export function setReadTarget(target: DatabaseTarget): void {
  activeReadTarget = target;
  console.log(`[DB Pool Engine] 🔀 Read traffic target updated to: ${target}`);
}

export function getReadTarget(): DatabaseTarget {
  return activeReadTarget;
}

export function getReadClient() {
  return activeReadTarget === 'PRIMARY' ? prisma : prismaRead;
}

export async function switchDatabaseUrl(newUrl: string): Promise<void> {
  console.log(`[Prisma] Switching database URL to: ${newUrl}`);
  process.env.DATABASE_URL = newUrl;
  setReadTarget('PRIMARY');

  try {
    await primaryClient.$disconnect();
  } catch {
    // Pool may not be connected during DR drills or unit tests.
  }

  primaryClient = createClient(newUrl, 'primary-promoted');

  if (process.env.VITEST !== 'true') {
    await primaryClient.$connect();
  }
}

export async function connectWithRetry() {
  await prisma.$connect();
}
