/**
 * Cache Tests
 * 
 * Validates TTL-based caching behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Cache } from './cache';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache<string>({ ttlMs: 100 }); // 100ms TTL for tests
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check key existence with has()', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete entries', () => {
      cache.set('key1', 'value1');
      cache.delete('key1');
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL Expiration', () => {
    it('should return value before TTL expires', async () => {
      cache.set('key1', 'value1');
      await new Promise((resolve) => setTimeout(resolve, 50)); // Wait 50ms (< 100ms TTL)
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined after TTL expires', async () => {
      cache.set('key1', 'value1');
      await new Promise((resolve) => setTimeout(resolve, 150)); // Wait 150ms (> 100ms TTL)
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false for has() after TTL expires', async () => {
      cache.set('key1', 'value1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(cache.has('key1')).toBe(false);
    });

    it('should auto-remove expired entries on get()', async () => {
      cache.set('key1', 'value1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      
      // First get() should auto-remove expired entry
      expect(cache.get('key1')).toBeUndefined();
      
      // Entry should be completely removed
      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('Pruning', () => {
    it('should remove expired entries with prune()', async () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      await new Promise((resolve) => setTimeout(resolve, 150)); // Wait for expiration
      
      cache.prune();
      
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });

    it('should keep non-expired entries when pruning', async () => {
      cache.set('key1', 'value1');
      
      await new Promise((resolve) => setTimeout(resolve, 50)); // Partial wait
      
      cache.set('key2', 'value2'); // Fresh entry
      cache.prune();
      
      expect(cache.get('key1')).toBe('value1'); // Not expired yet
      expect(cache.get('key2')).toBe('value2'); // Fresh
    });
  });

  describe('Complex Data Types', () => {
    it('should handle objects', () => {
      const cache = new Cache<{ name: string; age: number }>({ ttlMs: 1000 });
      const obj = { name: 'Alice', age: 30 };
      
      cache.set('user', obj);
      expect(cache.get('user')).toEqual(obj);
    });

    it('should handle arrays', () => {
      const cache = new Cache<number[]>({ ttlMs: 1000 });
      const arr = [1, 2, 3, 4, 5];
      
      cache.set('numbers', arr);
      expect(cache.get('numbers')).toEqual(arr);
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle many entries efficiently', () => {
      const largeCache = new Cache<number>({ ttlMs: 10000 });
      
      const startSet = Date.now();
      for (let i = 0; i < 1000; i++) {
        largeCache.set(`key${i}`, i);
      }
      const setDuration = Date.now() - startSet;
      
      const startGet = Date.now();
      for (let i = 0; i < 1000; i++) {
        largeCache.get(`key${i}`);
      }
      const getDuration = Date.now() - startGet;
      
      console.log(`Set 1000 entries: ${setDuration}ms`);
      console.log(`Get 1000 entries: ${getDuration}ms`);
      
      // Operations should be fast (< 100ms for 1000 entries)
      expect(setDuration).toBeLessThan(100);
      expect(getDuration).toBeLessThan(100);
    });
  });
});
