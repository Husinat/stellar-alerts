import { z } from 'zod';

export class ConfigValidationError extends Error {
  public readonly errors: Record<string, string[]>;
  public readonly processType: string;

  constructor(processType: string, errors: Record<string, string[]>) {
    const formatted = Object.entries(errors)
      .map(([k, msgs]) => `  - ${k}: ${msgs.join(', ')}`)
      .join('\n');
    super(`[Config] ❌ Invalid configuration for process "${processType}":\n${formatted}`);
    this.name = 'ConfigValidationError';
    this.processType = processType;
    this.errors = errors;
  }
}

/**
 * Common schema fragments
 */
const urlSchema = z.string().url();
const optionalUrlSchema = z.string().url().optional();

/**
 * Known insecure / default placeholder values that must never be permitted in production
 */
export const INSECURE_PRODUCTION_DEFAULTS = new Set([
  'dummy-jwt-secret-key-12345',
  '0123456789abcdef0123456789abcdef',
  'dummy-telegram-bot-token',
  'dummy-nextauth-secret-for-dev',
  'changeme',
  'secret',
  'password',
]);

/**
 * API Process Environment Schema
 */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: urlSchema,
  READ_REPLICA_URL: optionalUrlSchema,
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  REDIS_URL: urlSchema,
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_MASTER_NAME: z.string().default('mymaster'),
  REDIS_SENTINEL_PASSWORD: z.string().optional(),
  MASTER_ENCRYPTION_KEY: z.string().min(32, 'MASTER_ENCRYPTION_KEY must be at least 32 characters'),
  MASTER_ENCRYPTION_KEY_VERSION: z.string().default('1'),
  MASTER_ENCRYPTION_OLD_KEYS: z.string().default('{}'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  CORS_ORIGIN: z.string().default('*'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default('http://localhost:4318/v1/traces'),
  OTEL_SERVICE_NAME: z.string().default('stellar-alerts-api'),
  START_WORKER: z.string().default('true'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/**
 * Worker Process Environment Schema
 */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: urlSchema,
  REDIS_URL: urlSchema,
  HORIZON_URL: urlSchema.default('https://horizon-testnet.stellar.org'),
  SOROBAN_RPC_URL: urlSchema.default('https://soroban-testnet.stellar.org'),
  WORKER_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ALERT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  WATCHER_WALLET_CONCURRENCY: z.coerce.number().int().positive().default(10),
  WALLET_BURST_ALLOWANCE: z.coerce.number().int().positive().default(20),
  SOROBAN_RENT_WORKER_ENABLED: z.string().default('true'),
  SOROBAN_RENT_WORKER_INTERVAL_MS: z.string().default('60000'),
  SOROBAN_RENT_WORKER_SECRET: z.string().optional(),
  SOROBAN_RENT_RENEWAL_THRESHOLD: z.string().default('5000'),
  SOROBAN_RENT_TARGET_TTL: z.string().default('10000'),
  SOROBAN_RENT_MAX_CONCURRENCY: z.string().default('5'),
  SOROBAN_INDEXER_WORKER_ENABLED: z.string().default('true'),
  SOROBAN_INDEXER_INTERVAL_MS: z.string().default('15000'),
  SOROBAN_INDEXER_BACKFILL_WINDOW: z.string().default('200'),
  SOROBAN_INDEXER_PAGE_SIZE: z.string().default('200'),
  SOROBAN_INDEXER_BENCHMARK_INTERVAL_MS: z.string().default('3600000'),
  SOROBAN_INDEXER_BENCHMARK_DATA_ROWS: z.string().default('10000'),
  SOROBAN_STAKING_REWARD_WORKER_ENABLED: z.string().default('true'),
  SOROBAN_SAC_WORKER_ENABLED: z.string().default('false'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * Web Application Environment Schema
 */
export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_API_URL: urlSchema.default('http://localhost:3001'),
  NEXTAUTH_URL: urlSchema.default('http://localhost:3000'),
  NEXTAUTH_SECRET: z.string().min(1).default('dummy-nextauth-secret-for-dev'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * CLI Environment Schema
 */
export const cliEnvSchema = z.object({
  STELLAR_ALERTS_API_URL: urlSchema.default('http://localhost:3001'),
  STELLAR_ALERTS_API_KEY: z.string().optional(),
  STELLAR_ALERTS_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type CliEnv = z.infer<typeof cliEnvSchema>;

/**
 * Key patterns that indicate secret or sensitive information to redact
 */
const SENSITIVE_KEY_REGEX = /(SECRET|KEY|PASSWORD|TOKEN|AUTH|CREDENTIAL|PRIVATE|CERT|CIPHER)/i;

/**
 * Masks a sensitive string value while showing slight hint (e.g. `dum***345`).
 */
export function redactValue(val: unknown, keyName = ''): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (typeof val === 'string') {
    // If it's a URL with credentials (e.g., postgresql://user:pass@host)
    if (val.includes('://') && val.includes('@')) {
      return val.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
    }
    if (SENSITIVE_KEY_REGEX.test(keyName)) {
      if (val.length <= 6) {
        return '***';
      }
      return `${val.slice(0, 3)}***${val.slice(-3)}`;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((v) => redactValue(v, keyName));
  }
  if (typeof val === 'object') {
    const redactedObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, any>)) {
      redactedObj[k] = redactValue(v, k);
    }
    return redactedObj;
  }
  return val;
}

/**
 * Redacts all sensitive keys and URLs in a configuration object.
 */
export function redactConfig<T extends Record<string, any>>(config: T): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(config)) {
    result[key] = redactValue(value, key);
  }
  return result;
}

/**
 * Formats and prints redacted startup diagnostics for any process.
 */
export function printStartupDiagnostics(
  processName: string,
  config: Record<string, any>,
  logger: (msg: string) => void = console.log,
): string {
  const redacted = redactConfig(config);
  const keysCount = Object.keys(config).length;
  const lines: string[] = [
    `==================================================`,
    `🚀 [${processName.toUpperCase()}] Runtime Diagnostics`,
    `--------------------------------------------------`,
    `  Process ID:      ${process.pid}`,
    `  Node Version:    ${process.version}`,
    `  Environment:     ${config.NODE_ENV || process.env.NODE_ENV || 'unknown'}`,
    `  Platform:        ${process.platform} (${process.arch})`,
    `  Validated Keys:  ${keysCount}`,
    `---------------- Configuration -------------------`,
  ];

  for (const [k, v] of Object.entries(redacted)) {
    lines.push(`  ${k.padEnd(30)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  lines.push(`==================================================`);

  const output = lines.join('\n');
  logger(output);
  return output;
}

/**
 * Validates environment against a typed Zod schema with fail-fast production enforcement.
 */
export function validateProcessEnv<T extends Record<string, any>>(
  schema: z.ZodSchema<T>,
  envInput: Record<string, any>,
  processType: string,
  options: {
    isProduction?: boolean;
    failFast?: boolean;
    onValidationError?: (err: ConfigValidationError) => void;
  } = {},
): T {
  const isProd =
    options.isProduction ??
    (envInput.NODE_ENV === 'production' || process.env.NODE_ENV === 'production');

  const parsed = schema.safeParse(envInput);

  if (!parsed.success) {
    const errorMap: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || 'root';
      if (!errorMap[field]) errorMap[field] = [];
      errorMap[field].push(issue.message);
    }

    const err = new ConfigValidationError(processType, errorMap);

    if (options.onValidationError) {
      options.onValidationError(err);
    }

    // Fail-fast in production or if explicitly requested
    if (isProd || options.failFast) {
      console.error(err.message);
      throw err;
    }

    // In non-production, warn and attempt fallback
    console.warn(`[Config] ⚠️ Warning: Process "${processType}" running with invalid configuration in non-production environment:`, errorMap);
    throw err;
  }

  // Production check: Reject insecure known defaults
  if (isProd) {
    const insecureFound: string[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      if (typeof value === 'string' && INSECURE_PRODUCTION_DEFAULTS.has(value.toLowerCase())) {
        insecureFound.push(key);
      }
    }
    if (insecureFound.length > 0) {
      const errMap: Record<string, string[]> = {};
      for (const k of insecureFound) {
        errMap[k] = ['Insecure default / placeholder value detected in production. You must provide a secure production secret.'];
      }
      const err = new ConfigValidationError(processType, errMap);
      console.error(err.message);
      throw err;
    }
  }

  return parsed.data;
}
