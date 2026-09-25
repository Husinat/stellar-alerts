import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './config/env';
import prismaPlugin from './plugins/prisma';
import metricsPlugin from './plugins/metrics';
import { authRoutes } from './modules/auth/auth.routes';
import { walletsRoutes } from './modules/wallets/wallets.routes';
import { paymentsRoutes } from './modules/payments/payments.routes';
import { webhooksRoutes } from './modules/webhooks/webhooks.routes';
import { sorobanStateRoutes } from './modules/soroban-state/soroban-state.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { deadLettersRoutes } from './modules/dead-letters/dead-letters.routes';
import { openApiOptions } from './openapi.config';

import { checkRedisReadiness, getRedisStatus } from './lib/redis';

export { openApiComponentSchemas, openApiOptions } from './openapi.config';

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
    pluginTimeout: 30000,
    /**
     * Correlation ID strategy:
     *  1. Use the incoming `x-request-id` header value if provided by the client.
     *  2. Otherwise generate a fresh UUID v4 via the Node built-in crypto module.
     *
     * Fastify automatically binds the resolved ID to `request.id` and injects
     * it into every Pino log line produced via `request.log.*` as the `reqId`
     * field, giving full per-request traceability at zero extra cost.
     */
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const existing = req.headers['x-request-id'];
      if (existing) {
        // Accept the first value when the header is repeated
        return Array.isArray(existing) ? existing[0] : existing;
      }
      return crypto.randomUUID();
    },
  });

  /**
   * Echo the resolved correlation ID back to the caller on every response so
   * that clients and API gateways can cross-reference server-side log entries.
   */
  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  await app.register(cors, {
    origin: true // Allow all origins for dev, or specify 'http://localhost:3000'

  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  });

  await app.register(multipart, {
    limits: {
      // Per-file cap; the wasm-analyzer route additionally enforces
      // env.WASM_ANALYZER_MAX_UPLOAD_BYTES per request via request.file().
      fileSize: env.WASM_ANALYZER_MAX_UPLOAD_BYTES,
      files: 1,
    },
  });

  await app.register(swagger, openApiOptions);

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(prismaPlugin);
  await app.register(metricsPlugin);

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/health/ready', async (request, reply) => {
    const redisHealth = await checkRedisReadiness();
    const isReady = redisHealth.isReady;
    return reply.status(isReady ? 200 : 503).send({
      status: isReady ? 'ready' : 'degraded',
      redis: redisHealth,
    });
  });

  app.register(authRoutes);
  app.register(walletsRoutes);
  app.register(paymentsRoutes);
  app.register(webhooksRoutes);
  app.register(notificationsRoutes);
  app.register(deadLettersRoutes);

  return app;
};
