import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  READ_REPLICA_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  REDIS_URL: z.string().url(),
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_MASTER_NAME: z.string().optional().default("mymaster"),
  REDIS_SENTINEL_PASSWORD: z.string().optional(),
  PORT: z.string().optional().default("3001"),
  MASTER_ENCRYPTION_KEY: z.string().min(32).describe('Master key for encrypting webhook secrets (AES-256-GCM)'),
  MASTER_ENCRYPTION_KEY_VERSION: z.string().optional().default("1"),
  MASTER_ENCRYPTION_OLD_KEYS: z.string().optional().default("{}"),
  // Requests/minute allowed per client before @fastify/rate-limit responds 429.
  // Overridable so load-test runs (k6, etc.) can measure real server capacity
  // instead of hitting the rate limiter almost immediately.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional().default(100),
  SOROBAN_RENT_WORKER_ENABLED: z.string().optional().default("true"),
  SOROBAN_RENT_WORKER_INTERVAL_MS: z.string().optional().default("60000"),
  SOROBAN_RENT_WORKER_SECRET: z.string().optional(),
  SOROBAN_RENT_RENEWAL_THRESHOLD: z.string().optional().default("5000"),
  SOROBAN_RENT_TARGET_TTL: z.string().optional().default("10000"),
  SOROBAN_RENT_MAX_CONCURRENCY: z.string().optional().default("5"),
  SOROBAN_INDEXER_WORKER_ENABLED: z.string().optional().default("true"),
  SOROBAN_INDEXER_INTERVAL_MS: z.string().optional().default("15000"),
  SOROBAN_INDEXER_BACKFILL_WINDOW: z.string().optional().default("200"),
  SOROBAN_INDEXER_PAGE_SIZE: z.string().optional().default("200"),
  SOROBAN_INDEXER_BENCHMARK_INTERVAL_MS: z.string().optional().default("3600000"),
  SOROBAN_INDEXER_BENCHMARK_DATA_ROWS: z.string().optional().default("10000"),
  SOROBAN_STAKING_REWARD_WORKER_ENABLED: z.string().optional().default("true"),
  SOROBAN_SAC_WORKER_ENABLED: z.string().optional().default("false"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default("http://localhost:4318/v1/traces"),
  OTEL_SERVICE_NAME: z.string().optional().default("stellar-alerts-api"),
});
export type Env = z.infer<typeof envSchema>;

const parseEnv = (): Env => {
  const envInput = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "postgresql://postgres:postgres@localhost:5432/stellar_alerts" : undefined),
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "dummy-telegram-bot-token" : undefined),
    JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "dummy-jwt-secret-key-12345" : undefined),
    REDIS_URL: process.env.REDIS_URL || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "redis://localhost:6379" : undefined),
    MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "0123456789abcdef0123456789abcdef" : undefined),
    REDIS_SENTINELS: process.env.REDIS_SENTINELS,
    REDIS_SENTINEL_MASTER_NAME: process.env.REDIS_SENTINEL_MASTER_NAME || "mymaster",
    REDIS_SENTINEL_PASSWORD: process.env.REDIS_SENTINEL_PASSWORD,
    SOROBAN_RENT_WORKER_ENABLED: process.env.SOROBAN_RENT_WORKER_ENABLED || "true",
    SOROBAN_RENT_WORKER_INTERVAL_MS: process.env.SOROBAN_RENT_WORKER_INTERVAL_MS || "60000",
    SOROBAN_RENT_WORKER_SECRET: process.env.SOROBAN_RENT_WORKER_SECRET,
    SOROBAN_RENT_RENEWAL_THRESHOLD: process.env.SOROBAN_RENT_RENEWAL_THRESHOLD || "5000",
    SOROBAN_RENT_TARGET_TTL: process.env.SOROBAN_RENT_TARGET_TTL || "10000",
    SOROBAN_RENT_MAX_CONCURRENCY: process.env.SOROBAN_RENT_MAX_CONCURRENCY || "5",
    SOROBAN_INDEXER_WORKER_ENABLED: process.env.SOROBAN_INDEXER_WORKER_ENABLED || "true",
    SOROBAN_INDEXER_INTERVAL_MS: process.env.SOROBAN_INDEXER_INTERVAL_MS || "15000",
    SOROBAN_INDEXER_BACKFILL_WINDOW: process.env.SOROBAN_INDEXER_BACKFILL_WINDOW || "200",
    SOROBAN_INDEXER_PAGE_SIZE: process.env.SOROBAN_INDEXER_PAGE_SIZE || "200",
    SOROBAN_INDEXER_BENCHMARK_INTERVAL_MS: process.env.SOROBAN_INDEXER_BENCHMARK_INTERVAL_MS || "3600000",
    SOROBAN_INDEXER_BENCHMARK_DATA_ROWS: process.env.SOROBAN_INDEXER_BENCHMARK_DATA_ROWS || "10000",
    SOROBAN_STAKING_REWARD_WORKER_ENABLED: process.env.SOROBAN_STAKING_REWARD_WORKER_ENABLED || "true",
    SOROBAN_SAC_WORKER_ENABLED: process.env.SOROBAN_SAC_WORKER_ENABLED || "false",
  };

  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

  // In production, reject known placeholder / insecure secrets fail-fast
  if (isProd) {
    const insecureKeys: string[] = [];
    const insecureDefaults = [
      'dummy-jwt-secret-key-12345',
      '0123456789abcdef0123456789abcdef',
      'dummy-telegram-bot-token',
    ];
    for (const [k, v] of Object.entries(envInput)) {
      if (typeof v === 'string' && insecureDefaults.includes(v)) {
        insecureKeys.push(k);
      }
    }
    if (insecureKeys.length > 0) {
      const msg = `[Config] ❌ FATAL: Insecure default credentials detected in production: ${insecureKeys.join(', ')}. Server cannot start with placeholder secrets.`;
      console.error(msg);
      if (!isTest) {
        process.exit(1);
      }
      throw new Error(msg);
    }
  }

  const parsed = envSchema.safeParse(envInput);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.format());
    if (isProd || (!isTest && process.env.NODE_ENV !== 'development')) {
      process.exit(1);
    }
    // Return a typed fallback matching Env so downstream code has consistent shape in dev/test
    return {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stellar_alerts",
      TELEGRAM_BOT_TOKEN: "dummy-telegram-bot-token",
      JWT_SECRET: "dummy-jwt-secret-key-12345",
      REDIS_URL: "redis://localhost:6379",
      REDIS_SENTINELS: undefined,
      REDIS_SENTINEL_MASTER_NAME: "mymaster",
      REDIS_SENTINEL_PASSWORD: undefined,
      PORT: "3001",
      RATE_LIMIT_MAX: 100,
      SOROBAN_RENT_WORKER_ENABLED: "true",
      SOROBAN_RENT_WORKER_INTERVAL_MS: "60000",
      SOROBAN_RENT_WORKER_SECRET: undefined,
      SOROBAN_RENT_RENEWAL_THRESHOLD: "5000",
      SOROBAN_RENT_TARGET_TTL: "10000",
      SOROBAN_RENT_MAX_CONCURRENCY: "5",
      SOROBAN_INDEXER_WORKER_ENABLED: "true",
      SOROBAN_INDEXER_INTERVAL_MS: "15000",
      SOROBAN_INDEXER_BACKFILL_WINDOW: "200",
      SOROBAN_INDEXER_PAGE_SIZE: "200",
      SOROBAN_INDEXER_BENCHMARK_INTERVAL_MS: "3600000",
      SOROBAN_INDEXER_BENCHMARK_DATA_ROWS: "10000",
      SOROBAN_STAKING_REWARD_WORKER_ENABLED: "true",
    } as Env;
  }

  return parsed.data;
};

export const env = parseEnv();