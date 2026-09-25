import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fallbackMemoryCache,
  redisCache,
  checkRedisReadiness,
  getRedisStatus,
  closeRedisConnections,
  registerRedisCleanupTask,
  MemoryFallbackCache,
} from '../redis';

describe('Redis Lifecycle & Degraded Mode Engine', () => {
  beforeEach(() => {
    fallbackMemoryCache.clear();
  });

  describe('MemoryFallbackCache', () => {
    it('stores and retrieves keys correctly', () => {
      const cache = new MemoryFallbackCache();
      cache.set('test-key', 'test-value');
      expect(cache.get('test-key')).toBe('test-value');
      expect(cache.exists('test-key')).toBe(true);
    });

    it('handles TTL expiry correctly', async () => {
      const cache = new MemoryFallbackCache();
      // Set with 0.05 second TTL (50ms)
      cache.set('expiring-key', 'val', 0.05);
      expect(cache.get('expiring-key')).toBe('val');

      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get('expiring-key')).toBeNull();
      expect(cache.exists('expiring-key')).toBe(false);
    });

    it('supports delete and sadd/sismember operations', () => {
      const cache = new MemoryFallbackCache();
      cache.sadd('set-key', 'item1', 'item2');
      expect(cache.sismember('set-key', 'item1')).toBe(true);
      expect(cache.sismember('set-key', 'item3')).toBe(false);

      cache.del('set-key');
      expect(cache.sismember('set-key', 'item1')).toBe(false);
    });
  });

  describe('redisCache with degraded-mode fallback', () => {
    it('sets and gets values seamlessly when Redis is unavailable', async () => {
      await redisCache.set('degraded-key', 'hello-world', 60);
      const val = await redisCache.get('degraded-key');
      expect(val).toBe('hello-world');
      expect(await redisCache.exists('degraded-key')).toBe(true);

      await redisCache.del('degraded-key');
      expect(await redisCache.get('degraded-key')).toBeNull();
    });

    it('implements atomic setNx correctly in degraded mode', async () => {
      const first = await redisCache.setNx('nx-key', 'first-val', 60);
      expect(first).toBe(true);

      const second = await redisCache.setNx('nx-key', 'second-val', 60);
      expect(second).toBe(false);

      const val = await redisCache.get('nx-key');
      expect(val).toBe('first-val');
    });
  });

  describe('Readiness & Lifecycle', () => {
    it('reports health status and degraded mode flag', async () => {
      const health = await checkRedisReadiness(200);
      expect(health).toHaveProperty('isReady');
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('isDegradedMode');
      expect(typeof health.isReady).toBe('boolean');
    });

    it('executes registered cleanup tasks on shutdown', async () => {
      const cleanupMock = vi.fn().mockResolvedValue(undefined);
      registerRedisCleanupTask(cleanupMock);

      await closeRedisConnections();
      expect(cleanupMock).toHaveBeenCalledTimes(1);
      expect(getRedisStatus()).toBe('closed');
    });
  });
});
