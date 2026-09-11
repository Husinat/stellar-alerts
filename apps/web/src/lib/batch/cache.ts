/**
 * Simple TTL-based in-memory cache
 * 
 * Provides per-window caching to reduce redundant API calls.
 * Each cache entry expires after a configurable TTL (time-to-live).
 */

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface CacheOptions {
  ttlMs: number; // Time-to-live in milliseconds
}

export class Cache<T = any> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs;
  }

  set(key: string, data: T): void {
    const expiresAt = Date.now() + this.ttlMs;
    this.store.set(key, { data, expiresAt });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    
    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.data;
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    
    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Remove all expired entries
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
