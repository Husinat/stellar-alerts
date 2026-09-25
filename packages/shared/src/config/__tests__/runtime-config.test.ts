import { describe, it, expect, vi } from 'vitest';
import {
  apiEnvSchema,
  workerEnvSchema,
  webEnvSchema,
  cliEnvSchema,
  redactValue,
  redactConfig,
  printStartupDiagnostics,
  validateProcessEnv,
  ConfigValidationError,
} from '../index';

describe('Validated Runtime Configuration (#302)', () => {
  describe('Per-process environment schemas', () => {
    it('validates API environment schema with correct defaults', () => {
      const validApi = {
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/stellar_alerts',
        TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        JWT_SECRET: 'super-secret-jwt-key-minimum-16-chars',
        REDIS_URL: 'redis://localhost:6379',
        MASTER_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      };

      const result = apiEnvSchema.parse(validApi);
      expect(result.PORT).toBe(3001);
      expect(result.RATE_LIMIT_MAX).toBe(100);
      expect(result.NODE_ENV).toBe('development');
      expect(result.CORS_ORIGIN).toBe('*');
    });

    it('rejects API environment with invalid or missing required values', () => {
      const invalidApi = {
        DATABASE_URL: 'not-a-url',
        JWT_SECRET: 'short', // less than 16 chars
      };

      const parsed = apiEnvSchema.safeParse(invalidApi);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => i.path[0]);
        expect(issues).toContain('DATABASE_URL');
        expect(issues).toContain('JWT_SECRET');
        expect(issues).toContain('TELEGRAM_BOT_TOKEN');
        expect(issues).toContain('REDIS_URL');
      }
    });

    it('validates Worker environment schema with concurrency and drain defaults', () => {
      const validWorker = {
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/stellar_alerts',
        REDIS_URL: 'redis://localhost:6379',
      };

      const result = workerEnvSchema.parse(validWorker);
      expect(result.WORKER_DRAIN_TIMEOUT_MS).toBe(10000);
      expect(result.ALERT_WORKER_CONCURRENCY).toBe(10);
      expect(result.WATCHER_WALLET_CONCURRENCY).toBe(10);
      expect(result.WALLET_BURST_ALLOWANCE).toBe(20);
      expect(result.HORIZON_URL).toBe('https://horizon-testnet.stellar.org');
    });

    it('validates Web environment schema', () => {
      const result = webEnvSchema.parse({});
      expect(result.NEXT_PUBLIC_API_URL).toBe('http://localhost:3001');
      expect(result.NEXTAUTH_URL).toBe('http://localhost:3000');
    });

    it('validates CLI environment schema', () => {
      const result = cliEnvSchema.parse({
        STELLAR_ALERTS_LOG_LEVEL: 'debug',
      });
      expect(result.STELLAR_ALERTS_API_URL).toBe('http://localhost:3001');
      expect(result.STELLAR_ALERTS_LOG_LEVEL).toBe('debug');
    });
  });

  describe('Redacted startup diagnostics', () => {
    it('redacts sensitive keys including secrets, passwords, tokens, and encryption keys', () => {
      const config = {
        PORT: 3001,
        NODE_ENV: 'production',
        JWT_SECRET: 'my-super-secret-jwt-token-string',
        TELEGRAM_BOT_TOKEN: '1234567890:AAH-tokentest',
        MASTER_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        DATABASE_URL: 'postgresql://app_user:secret_password@db.prod.internal:5432/stellar_alerts',
        PUBLIC_INFO: 'visible-string',
      };

      const redacted = redactConfig(config);

      expect(redacted.PORT).toBe(3001);
      expect(redacted.NODE_ENV).toBe('production');
      expect(redacted.PUBLIC_INFO).toBe('visible-string');

      // Sensitive values are masked
      expect(redacted.JWT_SECRET).not.toBe(config.JWT_SECRET);
      expect(redacted.JWT_SECRET).toContain('***');
      expect(redacted.TELEGRAM_BOT_TOKEN).toContain('***');
      expect(redacted.MASTER_ENCRYPTION_KEY).toContain('***');

      // Database URL has password masked
      expect(redacted.DATABASE_URL).toBe('postgresql://app_user:***@db.prod.internal:5432/stellar_alerts');
      expect(redacted.DATABASE_URL).not.toContain('secret_password');
    });

    it('prints formatted diagnostic output banner without throwing', () => {
      const logMock = vi.fn();
      const output = printStartupDiagnostics(
        'api',
        {
          PORT: 3001,
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/stellar_alerts',
          JWT_SECRET: 'my-secret-jwt-key-12345',
        },
        logMock,
      );

      expect(output).toContain('[API] Runtime Diagnostics');
      expect(output).toContain('Validated Keys');
      expect(output).toContain('***');
      expect(logMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fail-fast production validation', () => {
    it('succeeds in production when all credentials are fully valid and non-placeholder', () => {
      const prodEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://prod_user:p4ssw0rd!@db.internal:5432/stellar_alerts',
        TELEGRAM_BOT_TOKEN: 'bot-token-real-telegram-99887766',
        JWT_SECRET: 'production-quality-secure-jwt-secret-string-at-least-32-bytes',
        REDIS_URL: 'redis://redis.internal:6379',
        MASTER_ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210',
      };

      const validated = validateProcessEnv(apiEnvSchema, prodEnv, 'api', { isProduction: true });
      expect(validated.NODE_ENV).toBe('production');
      expect(validated.DATABASE_URL).toBe(prodEnv.DATABASE_URL);
    });

    it('fails fast in production when known insecure dummy placeholder secrets are used', () => {
      const prodEnvWithDummySecret = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://prod_user:pass@db.internal:5432/stellar_alerts',
        TELEGRAM_BOT_TOKEN: 'real-bot-token-12345',
        JWT_SECRET: 'dummy-jwt-secret-key-12345', // Insecure placeholder!
        REDIS_URL: 'redis://redis.internal:6379',
        MASTER_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', // Insecure placeholder!
      };

      expect(() => {
        validateProcessEnv(apiEnvSchema, prodEnvWithDummySecret, 'api', { isProduction: true });
      }).toThrowError(ConfigValidationError);
    });

    it('fails fast when required fields are missing in production', () => {
      const incompleteProdEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://prod_user:pass@db.internal:5432/stellar_alerts',
      };

      expect(() => {
        validateProcessEnv(apiEnvSchema, incompleteProdEnv, 'api', { isProduction: true });
      }).toThrow(ConfigValidationError);
    });
  });
});
