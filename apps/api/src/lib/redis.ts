import Redis, { RedisOptions } from 'ioredis';

export type RedisLifecycleStatus = 'connecting' | 'ready' | 'reconnecting' | 'degraded' | 'closed';

export interface RedisHealthStatus {
  isReady: boolean;
  status: RedisLifecycleStatus;
  latencyMs?: number;
  error?: string;
  isDegradedMode: boolean;
}

// In-Memory Fallback Cache for degraded mode operation
interface CacheEntry {
  value: string;
  expiresAt?: number;
}

export class MemoryFallbackCache {
  private store = new Map<string, CacheEntry>();
  private setStore = new Map<string, Set<string>>();

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  del(key: string): number {
    const deleted = this.store.delete(key) ? 1 : 0;
    this.setStore.delete(key);
    return deleted;
  }

  exists(key: string): boolean {
    return this.get(key) !== null;
  }

  sadd(key: string, ...members: string[]): number {
    let set = this.setStore.get(key);
    if (!set) {
      set = new Set();
      this.setStore.set(key, set);
    }
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  sismember(key: string, member: string): boolean {
    const set = this.setStore.get(key);
    return set ? set.has(member) : false;
  }

  clear(): void {
    this.store.clear();
    this.setStore.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export const fallbackMemoryCache = new MemoryFallbackCache();

// Registry of cleanup functions to call on graceful shutdown
const cleanupHandlers: Array<() => Promise<void>> = [];

export function registerRedisCleanupTask(handler: () => Promise<void>): void {
  cleanupHandlers.push(handler);
}

export function buildRedisOptions(): RedisOptions {
  const sentinelsRaw = process.env.REDIS_SENTINELS;
  const masterName = process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster';
  const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD;

  const baseOptions: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => {
      if (times > 10) {
        // After 10 failed retries, back off slowly
        return 5000;
      }
      // Exponential backoff with jitter: min(100 * 2^times + jitter, 3000ms)
      const jitter = Math.floor(Math.random() * 150);
      const delay = Math.min(100 * Math.pow(2, times) + jitter, 3000);
      return delay;
    },
    reconnectOnError: (err: Error) => {
      const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
      return targetErrors.some((code) => err.message?.includes(code));
    },
  };

  if (sentinelsRaw) {
    const sentinels = sentinelsRaw.split(',').map((s) => {
      const parts = s.trim().split(':');
      return { host: parts[0] || 'localhost', port: parseInt(parts[1] || '26379', 10) };
    });
    return {
      ...baseOptions,
      sentinels,
      name: masterName,
      sentinelPassword,
      role: 'master',
    };
  }

  if (process.env.REDIS_URL && !process.env.REDIS_URL.includes('localhost:6379')) {
    // If explicit custom URL is provided
    return {
      ...baseOptions,
    };
  }

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  return {
    ...baseOptions,
    host: redisHost,
    port: redisPort,
  };
}

let lifecycleStatus: RedisLifecycleStatus = 'connecting';
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS_FOR_DEGRADED = 3;

function createClient(): Redis {
  const options = buildRedisOptions();
  const client = process.env.REDIS_URL && !process.env.REDIS_SENTINELS
    ? new Redis(process.env.REDIS_URL, options)
    : new Redis(options);

  client.on('connect', () => {
    lifecycleStatus = 'connecting';
  });

  client.on('ready', () => {
    lifecycleStatus = 'ready';
    consecutiveErrors = 0;
    console.log('[Redis] 🟢 Connection established and ready');
  });

  client.on('reconnecting', () => {
    lifecycleStatus = 'reconnecting';
    console.warn('[Redis] 🟡 Connection lost, reconnecting...');
  });

  client.on('error', (err) => {
    consecutiveErrors++;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS_FOR_DEGRADED) {
      if (lifecycleStatus !== 'degraded') {
        console.warn(`[Redis] ⚠️ Transitioning to DEGRADED mode after ${consecutiveErrors} consecutive errors`);
      }
      lifecycleStatus = 'degraded';
    }
    console.warn(`[Redis] Connection warning: ${err.message}`);
  });

  client.on('close', () => {
    if (lifecycleStatus !== 'closed') {
      lifecycleStatus = 'degraded';
    }
  });

  client.on('end', () => {
    lifecycleStatus = 'closed';
  });

  return client;
}

export const redis = createClient();

/**
 * Gets current Redis lifecycle status.
 */
export function getRedisStatus(): RedisLifecycleStatus {
  return lifecycleStatus;
}

/**
 * Checks whether Redis is in degraded mode.
 */
export function isRedisDegraded(): boolean {
  return lifecycleStatus === 'degraded' || lifecycleStatus === 'closed' || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS_FOR_DEGRADED;
}

/**
 * Readiness probe for Kubernetes / load balancers.
 * Performs a fast PING to verify the connection is active and responsive.
 */
export async function checkRedisReadiness(timeoutMs = 1500): Promise<RedisHealthStatus> {
  const start = Date.now();
  try {
    const pingPromise = redis.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis ping timeout')), timeoutMs),
    );

    const result = await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    if (result === 'PONG') {
      lifecycleStatus = 'ready';
      return {
        isReady: true,
        status: 'ready',
        latencyMs,
        isDegradedMode: false,
      };
    }

    return {
      isReady: false,
      status: lifecycleStatus,
      latencyMs,
      error: `Unexpected ping response: ${result}`,
      isDegradedMode: true,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    lifecycleStatus = 'degraded';
    return {
      isReady: false,
      status: 'degraded',
      latencyMs,
      error: err?.message || 'Redis unreachable',
      isDegradedMode: true,
    };
  }
}

/**
 * Safely executes a Redis operation with automatic fallback to in-memory cache
 * when Redis is disconnected, degraded, or throws a connection error.
 */
export async function safeRedis<T>(
  operation: (client: Redis) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (isRedisDegraded()) {
    return fallback();
  }

  try {
    return await operation(redis);
  } catch (err: any) {
    console.warn(`[Redis] Degraded fallback triggered: ${err.message}`);
    lifecycleStatus = 'degraded';
    return fallback();
  }
}

/**
 * Safe key-value getters and setters with degraded memory fallback.
 */
export const redisCache = {
  async get(key: string): Promise<string | null> {
    return safeRedis(
      (client) => client.get(key),
      () => fallbackMemoryCache.get(key),
    );
  },

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | void> {
    return safeRedis(
      async (client) => {
        if (ttlSeconds && ttlSeconds > 0) {
          return client.set(key, value, 'EX', ttlSeconds);
        }
        return client.set(key, value);
      },
      () => {
        fallbackMemoryCache.set(key, value, ttlSeconds);
        return 'OK';
      },
    );
  },

  async del(key: string): Promise<number> {
    return safeRedis(
      (client) => client.del(key),
      () => fallbackMemoryCache.del(key),
    );
  },

  async exists(key: string): Promise<boolean> {
    return safeRedis(
      async (client) => (await client.exists(key)) > 0,
      () => fallbackMemoryCache.exists(key),
    );
  },

  async setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    return safeRedis(
      async (client) => {
        let res: string | null;
        if (ttlSeconds && ttlSeconds > 0) {
          res = await client.set(key, value, 'EX', ttlSeconds, 'NX');
        } else {
          res = await client.set(key, value, 'NX');
        }
        return res === 'OK';
      },
      () => {
        if (fallbackMemoryCache.exists(key)) {
          return false;
        }
        fallbackMemoryCache.set(key, value, ttlSeconds);
        return true;
      },
    );
  },
};

/**
 * Graceful shutdown for Redis: disconnects main client and cleans up
 * all registered resources (BullMQ queues, workers, subscriber connections).
 */
export async function closeRedisConnections(): Promise<void> {
  console.log('[Redis] 🛑 Initiating graceful Redis shutdown...');
  lifecycleStatus = 'closed';

  // Run registered cleanup tasks in parallel with timeout
  const cleanupPromises = cleanupHandlers.map(async (fn) => {
    try {
      await fn();
    } catch (err: any) {
      console.warn(`[Redis] Error in cleanup task: ${err.message}`);
    }
  });

  await Promise.allSettled(cleanupPromises);

  // Close primary redis client
  try {
    if (redis.status !== 'end') {
      await redis.quit().catch(() => redis.disconnect());
    }
  } catch (err: any) {
    console.warn(`[Redis] Error quitting Redis client: ${err.message}`);
    try {
      redis.disconnect();
    } catch {}
  }

  console.log('[Redis] ✅ All Redis connections and registered resources closed');
}
