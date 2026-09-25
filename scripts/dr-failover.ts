import { Client } from 'pg';
import { resolvePoolConfig } from '../apps/api/src/lib/db-pool';
import { switchDatabaseUrl } from '../apps/api/src/lib/prisma';

export interface DRConfig {
  primaryDatabaseUrl: string;
  secondaryDatabaseUrl: string;
  primaryRedisUrl: string;
  secondaryRedisUrl: string;
  healthCheckTimeoutMs: number; // Max time per health check (e.g. 5000ms)
  maxConsecutiveFailures: number; // Max failed checks before failover (e.g. 3 checks = 15s)
}

export interface DRStatus {
  activeRegion: 'PRIMARY' | 'SECONDARY';
  primaryHealth: 'HEALTHY' | 'UNHEALTHY' | 'BLACKHOLED';
  secondaryHealth: 'HEALTHY' | 'UNHEALTHY';
  consecutiveFailures: number;
  lastFailoverTime: Date | null;
  activeDatabaseUrl: string;
  activeRedisUrl: string;
}

const defaultConfig: DRConfig = {
  primaryDatabaseUrl: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/stellar_alerts?schema=public',
  secondaryDatabaseUrl: process.env.SECONDARY_DATABASE_URL || 'postgresql://user:password@dr-secondary.internal:5432/stellar_alerts_secondary?schema=public',
  primaryRedisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  secondaryRedisUrl: process.env.SECONDARY_REDIS_URL || 'redis://dr-secondary.internal:6379',
  healthCheckTimeoutMs: 5000,
  maxConsecutiveFailures: 3, // 3 * 5s = 15s outage detection threshold
};

let currentStatus: DRStatus = {
  activeRegion: 'PRIMARY',
  primaryHealth: 'HEALTHY',
  secondaryHealth: 'HEALTHY',
  consecutiveFailures: 0,
  lastFailoverTime: null,
  activeDatabaseUrl: defaultConfig.primaryDatabaseUrl,
  activeRedisUrl: defaultConfig.primaryRedisUrl,
};

let isBlackholed = false;

/**
 * Simulates a primary region DNS blackhole outage for testing failover detection.
 */
export function simulateDNSBlackhole(enable: boolean = true): void {
  isBlackholed = enable;
  if (enable) {
    currentStatus.primaryHealth = 'BLACKHOLED';
    console.warn('[DR Failover Engine] 🔴 Primary region DNS blackhole simulated!');
  } else {
    currentStatus.primaryHealth = 'HEALTHY';
    console.log('[DR Failover Engine] 🟢 Primary region DNS blackhole cleared.');
  }
}

/**
 * Probes Postgres with `SELECT 1`, honoring the configured health-check timeout.
 */
export async function probePrimaryDatabase(
  databaseUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const poolConfig = resolvePoolConfig(databaseUrl);
  const client = new Client({
    connectionString: poolConfig.connectionString,
    connectionTimeoutMillis: timeoutMs,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Checks primary region health (Postgres response ping).
 */
export async function checkPrimaryHealth(config: DRConfig = defaultConfig): Promise<boolean> {
  if (isBlackholed) {
    return false;
  }

  return probePrimaryDatabase(config.primaryDatabaseUrl, config.healthCheckTimeoutMs);
}

/**
 * Executes automatic or manual failover to secondary region.
 * Switches DB and Redis connection strings and promotes secondary pool.
 */
export async function triggerFailover(config: DRConfig = defaultConfig): Promise<DRStatus> {
  console.error('[DR Failover Engine] 🚨 PRIMARY REGION OUTAGE DETECTED! Initiating promotion to secondary region...');
  
  await switchDatabaseUrl(config.secondaryDatabaseUrl);
  process.env.REDIS_URL = config.secondaryRedisUrl;

  currentStatus = {
    ...currentStatus,
    activeRegion: 'SECONDARY',
    primaryHealth: 'UNHEALTHY',
    secondaryHealth: 'HEALTHY',
    lastFailoverTime: new Date(),
    activeDatabaseUrl: config.secondaryDatabaseUrl,
    activeRedisUrl: config.secondaryRedisUrl,
  };

  console.log(`[DR Failover Engine] ✅ Secondary region promoted successfully. Active DB: ${currentStatus.activeDatabaseUrl}`);
  return currentStatus;
}

/**
 * Monitors primary health periodically and triggers failover within 15 seconds of sustained outage.
 */
export async function monitorAndFailover(
  config: DRConfig = defaultConfig,
  probeHealth: () => Promise<boolean> = () => checkPrimaryHealth(config)
): Promise<DRStatus> {
  const isHealthy = await probeHealth();

  if (!isHealthy) {
    currentStatus.consecutiveFailures += 1;
    console.warn(`[DR Failover Engine] ⚠️ Health check failed (${currentStatus.consecutiveFailures}/${config.maxConsecutiveFailures})`);

    // If 15s threshold reached (3 checks * 5s), trigger failover
    if (currentStatus.consecutiveFailures >= config.maxConsecutiveFailures && currentStatus.activeRegion === 'PRIMARY') {
      return await triggerFailover(config);
    }
  } else {
    currentStatus.consecutiveFailures = 0;
  }

  return currentStatus;
}

/**
 * Returns current Multi-Region DR Status.
 */
export function getDRStatus(): DRStatus {
  return { ...currentStatus };
}

/**
 * Resets DR state back to initial primary configuration.
 */
export function resetDRState(config: DRConfig = defaultConfig): void {
  isBlackholed = false;
  currentStatus = {
    activeRegion: 'PRIMARY',
    primaryHealth: 'HEALTHY',
    secondaryHealth: 'HEALTHY',
    consecutiveFailures: 0,
    lastFailoverTime: null,
    activeDatabaseUrl: config.primaryDatabaseUrl,
    activeRedisUrl: config.primaryRedisUrl,
  };
}

/**
 * Long-running failover monitor that probes primary health on an interval and
 * promotes the secondary database when the outage threshold is reached.
 */
export class FailoverManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly probe: () => Promise<boolean>;

  constructor(
    private readonly config: DRConfig = defaultConfig,
    probeHealth?: () => Promise<boolean>,
  ) {
    this.probe = probeHealth ?? (() => checkPrimaryHealth(this.config));
  }

  async evaluatePromotion(): Promise<DRStatus> {
    return monitorAndFailover(this.config, this.probe);
  }

  start(probeIntervalMs: number = defaultConfig.healthCheckTimeoutMs): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.evaluatePromotion();
    }, probeIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): DRStatus {
    return getDRStatus();
  }
}
