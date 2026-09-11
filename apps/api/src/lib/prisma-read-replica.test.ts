import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadReplicaRouter, ReadReplicaConfig } from './prisma-read-replica';

// Mock PrismaPg
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn().mockImplementation(() => ({})),
}));

// Mock PrismaClient
let clientCount = 0;
vi.mock('../../generated/prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => {
    clientCount++;
    return {
      _id: clientCount,
      $connect: vi.fn().mockResolvedValue(undefined),
      $disconnect: vi.fn().mockResolvedValue(undefined),
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
  }),
}));

// Mock env module
vi.mock('../config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://primary:5432/db',
    READ_REPLICA_URL: 'postgresql://replica:5432/db',
    TELEGRAM_BOT_TOKEN: 'test-token',
    JWT_SECRET: 'test-secret',
    REDIS_URL: 'redis://localhost:6379',
    PORT: '3001',
  },
}));

describe('ReadReplicaRouter', () => {
  let router: ReadReplicaRouter;
  const config: ReadReplicaConfig = {
    primaryUrl: 'postgresql://primary:5432/db',
    replicaUrl: 'postgresql://replica:5432/db',
    fallbackToPrimary: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    router = new ReadReplicaRouter(config);
  });

  afterEach(async () => {
    try {
      await router.disconnect();
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create router with primary and replica', () => {
    expect(router).toBeDefined();
    expect(router.getPrimaryClient()).toBeDefined();
    expect(router.getReplicaClient()).toBeDefined();
  });

  it('should create router without replica', () => {
    const configWithoutReplica: ReadReplicaConfig = {
      primaryUrl: 'postgresql://primary:5432/db',
      fallbackToPrimary: true,
    };
    
    const routerWithoutReplica = new ReadReplicaRouter(configWithoutReplica);
    expect(routerWithoutReplica.getReplicaClient()).toBeNull();
  });

  it('should route read operations on read-heavy models to replica', () => {
    // Payment is a read-heavy model
    const client = router.getClient('payment', 'findMany');
    expect(client).toBe(router.getReplicaClient());
  });

  it('should route write operations to primary', () => {
    const client = router.getClient('payment', 'create');
    expect(client).toBe(router.getPrimaryClient());
  });

  it('should route non-read-heavy models to primary', () => {
    const client = router.getClient('user', 'findMany');
    expect(client).toBe(router.getPrimaryClient());
  });

  it('should route count operations on read-heavy models to replica', () => {
    const client = router.getClient('wallet', 'count');
    expect(client).toBe(router.getReplicaClient());
  });

  it('should route aggregate operations on read-heavy models to replica', () => {
    const client = router.getClient('payment', 'aggregate');
    expect(client).toBe(router.getReplicaClient());
  });

  it('should route groupBy operations on read-heavy models to replica', () => {
    const client = router.getClient('payment', 'groupBy');
    expect(client).toBe(router.getReplicaClient());
  });

  it('should connect both clients', async () => {
    await router.connect();
    expect(router.getPrimaryClient()).toBeDefined();
    expect(router.getReplicaClient()).toBeDefined();
  });

  it('should perform health check', async () => {
    const health = await router.healthCheck();
    expect(health.primary).toBe(true);
    expect(health.replica).toBe(true);
  });

  it('should handle case-insensitive model names', () => {
    const client = router.getClient('Payment', 'findMany');
    expect(client).toBe(router.getReplicaClient());
  });

  it('should route webhookLog operations to replica', () => {
    const freshRouter = new ReadReplicaRouter(config);
    const client = freshRouter.getClient('webhookLog', 'findMany');
    expect(client).toBe(freshRouter.getReplicaClient());
  });

  it('should route sorobanEventSnapshot operations to replica', () => {
    const freshRouter = new ReadReplicaRouter(config);
    const client = freshRouter.getClient('sorobanEventSnapshot', 'findMany');
    expect(client).toBe(freshRouter.getReplicaClient());
  });
});

describe('ReadReplicaRouter Edge Cases', () => {
  it('should handle missing replica URL gracefully', () => {
    const config: ReadReplicaConfig = {
      primaryUrl: 'postgresql://primary:5432/db',
      fallbackToPrimary: true,
    };

    const router = new ReadReplicaRouter(config);
    expect(router.getReplicaClient()).toBeNull();
  });

  it('should use primary when no replica available', () => {
    const config: ReadReplicaConfig = {
      primaryUrl: 'postgresql://primary:5432/db',
      fallbackToPrimary: true,
    };

    const router = new ReadReplicaRouter(config);
    const client = router.getClient('payment', 'findMany');
    expect(client).toBe(router.getPrimaryClient());
  });

  it('should handle unknown operations by routing to primary', () => {
    const config: ReadReplicaConfig = {
      primaryUrl: 'postgresql://primary:5432/db',
      replicaUrl: 'postgresql://replica:5432/db',
      fallbackToPrimary: true,
    };

    const router = new ReadReplicaRouter(config);
    const client = router.getClient('payment', 'customOperation');
    expect(client).toBe(router.getPrimaryClient());
  });
});
