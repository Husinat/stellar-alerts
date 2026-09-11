import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { resolvePoolConfig } from './db-pool';

function createClient(databaseUrl: string, label: string) {
  const config = resolvePoolConfig(databaseUrl);
  console.log(
    `[Prisma] ${label} pool: max=${config.max} connections, acquire timeout=${config.connectionTimeoutMillis}ms, idle timeout=${config.idleTimeoutMillis}ms`
  );

  return new PrismaClient({ adapter: new PrismaPg(config) });
}

const primaryUrl = env.DATABASE_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/stellar_alerts';
const replicaUrl = env.DATABASE_REPLICA_URL || process.env.DATABASE_REPLICA_URL;

export const prisma = createClient(primaryUrl, 'primary');

/**
 * Client for read-only queries. Points at DATABASE_REPLICA_URL when a read
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
}

export async function connectWithRetry() {
  await prisma.$connect();
}
