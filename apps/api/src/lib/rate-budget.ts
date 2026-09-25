/**
 * Worker fairness controls, provider rate budgets, and per-wallet concurrency limits (#309).
 *
 * Prevents high-volume wallets or notification channels from starving other users
 * with explicit concurrency caps and token-bucket provider budgets.
 */

import { env } from '../config/env';

export interface ProviderBudgetConfig {
  capacity: number; // Max burst capacity
  refillRatePerSec: number; // Tokens refilled per second
}

export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  public readonly capacity: number;
  public readonly refillRatePerSec: number;

  constructor(capacity: number, refillRatePerSec: number) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRatePerSec);
      this.lastRefill = now;
    }
  }

  /**
   * Tries to consume tokens immediately.
   */
  tryConsume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  /**
   * Consumes tokens, waiting up to maxWaitMs if insufficient tokens.
   */
  async consume(tokens = 1, maxWaitMs = 1000): Promise<boolean> {
    if (this.tryConsume(tokens)) {
      return true;
    }

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const waitTime = Math.min(50, maxWaitMs - (Date.now() - start));
      await new Promise((r) => setTimeout(r, waitTime));
      if (this.tryConsume(tokens)) {
        return true;
      }
    }

    return false;
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

export class WorkerFairnessManager {
  private providerBuckets: Map<string, TokenBucketLimiter> = new Map();
  private activeWalletDispatches: Map<string, number> = new Map();
  private walletDispatchesInWindow: Map<string, { count: number; windowStart: number }> = new Map();

  public readonly maxConcurrentPerWallet: number;
  public readonly walletBurstLimit: number;
  public readonly walletWindowMs: number;

  constructor(options: {
    maxConcurrentPerWallet?: number;
    walletBurstLimit?: number;
    walletWindowMs?: number;
  } = {}) {
    this.maxConcurrentPerWallet = options.maxConcurrentPerWallet ?? 2;
    this.walletBurstLimit = options.walletBurstLimit ?? env.WALLET_BURST_ALLOWANCE ?? 20;
    this.walletWindowMs = options.walletWindowMs ?? 10_000; // 10s window

    // Initialize provider rate budgets
    this.initProviderBudgets();
  }

  private initProviderBudgets(): void {
    this.providerBuckets.set(
      'telegram',
      new TokenBucketLimiter(
        env.PROVIDER_RATE_BUDGET_TELEGRAM * 2,
        env.PROVIDER_RATE_BUDGET_TELEGRAM,
      ),
    );
    this.providerBuckets.set(
      'discord',
      new TokenBucketLimiter(
        env.PROVIDER_RATE_BUDGET_DISCORD * 2,
        env.PROVIDER_RATE_BUDGET_DISCORD,
      ),
    );
    this.providerBuckets.set(
      'slack',
      new TokenBucketLimiter(
        env.PROVIDER_RATE_BUDGET_SLACK * 2,
        env.PROVIDER_RATE_BUDGET_SLACK,
      ),
    );
    this.providerBuckets.set(
      'webhook',
      new TokenBucketLimiter(
        env.PROVIDER_RATE_BUDGET_WEBHOOK * 2,
        env.PROVIDER_RATE_BUDGET_WEBHOOK,
      ),
    );
    this.providerBuckets.set(
      'email',
      new TokenBucketLimiter(
        env.PROVIDER_RATE_BUDGET_EMAIL * 2,
        env.PROVIDER_RATE_BUDGET_EMAIL,
      ),
    );
  }

  /**
   * Acquires rate budget for a notification provider channel.
   * If budget is exhausted, waits up to maxWaitMs before returning false.
   */
  async acquireProviderBudget(provider: string, maxWaitMs = 1500): Promise<boolean> {
    const bucket = this.providerBuckets.get(provider.toLowerCase());
    if (!bucket) {
      return true; // No rate budget configured for this provider, allow
    }
    return bucket.consume(1, maxWaitMs);
  }

  /**
   * Acquires a processing slot for a specific wallet to enforce fairness.
   * Prevents a single high-volume wallet from monopolizing concurrent worker threads.
   */
  async acquireWalletSlot(walletId: string, maxWaitMs = 1000): Promise<boolean> {
    if (!walletId) return true;

    const start = Date.now();
    while (Date.now() - start <= maxWaitMs) {
      const active = this.activeWalletDispatches.get(walletId) || 0;
      const windowData = this.walletDispatchesInWindow.get(walletId);
      const now = Date.now();

      // Check sliding window rate limit
      let count = 0;
      if (windowData && now - windowData.windowStart < this.walletWindowMs) {
        count = windowData.count;
      } else {
        this.walletDispatchesInWindow.set(walletId, { count: 0, windowStart: now });
      }

      if (active < this.maxConcurrentPerWallet && count < this.walletBurstLimit) {
        this.activeWalletDispatches.set(walletId, active + 1);
        const curWindow = this.walletDispatchesInWindow.get(walletId)!;
        curWindow.count++;
        return true;
      }

      // High-volume wallet has reached concurrency or burst cap; yield to allow other wallets to progress
      const waitMs = Math.min(100, Math.max(10, maxWaitMs - (Date.now() - start)));
      if (waitMs <= 10) break;
      await new Promise((r) => setTimeout(r, waitMs));
    }

    // Force proceed after wait to avoid permanent stall
    const active = this.activeWalletDispatches.get(walletId) || 0;
    this.activeWalletDispatches.set(walletId, active + 1);
    return false; // Indicating throttled / delayed
  }

  /**
   * Releases an active processing slot for a wallet.
   */
  releaseWalletSlot(walletId: string): void {
    if (!walletId) return;
    const active = this.activeWalletDispatches.get(walletId) || 0;
    if (active <= 1) {
      this.activeWalletDispatches.delete(walletId);
    } else {
      this.activeWalletDispatches.set(walletId, active - 1);
    }
  }

  /**
   * Gets current in-flight dispatch count for a wallet.
   */
  getActiveWalletDispatches(walletId: string): number {
    return this.activeWalletDispatches.get(walletId) || 0;
  }

  /**
   * Gets available token count for a provider.
   */
  getProviderAvailableTokens(provider: string): number {
    const bucket = this.providerBuckets.get(provider.toLowerCase());
    return bucket ? bucket.getAvailableTokens() : Infinity;
  }

  /**
   * Resets all internal counters (for testing).
   */
  reset(): void {
    this.activeWalletDispatches.clear();
    this.walletDispatchesInWindow.clear();
    this.initProviderBudgets();
  }
}

export const workerFairnessManager = new WorkerFairnessManager();
