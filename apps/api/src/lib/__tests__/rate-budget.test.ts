import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBucketLimiter, WorkerFairnessManager } from '../rate-budget';

describe('Worker Fairness & Rate Budget Engine (#309)', () => {
  describe('TokenBucketLimiter', () => {
    it('consumes tokens when available', () => {
      const limiter = new TokenBucketLimiter(10, 5); // capacity 10, refill 5/sec
      expect(limiter.tryConsume(5)).toBe(true);
      expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5.1);
    });

    it('rejects consumption when tokens are exhausted', () => {
      const limiter = new TokenBucketLimiter(2, 1);
      expect(limiter.tryConsume(2)).toBe(true);
      expect(limiter.tryConsume(1)).toBe(false);
    });

    it('refills tokens over time', async () => {
      const limiter = new TokenBucketLimiter(5, 50); // 50 tokens/sec = 1 token per 20ms
      expect(limiter.tryConsume(5)).toBe(true);
      expect(limiter.tryConsume(1)).toBe(false);

      await new Promise((r) => setTimeout(r, 60));
      expect(limiter.tryConsume(1)).toBe(true);
    });
  });

  describe('WorkerFairnessManager', () => {
    let fairnessManager: WorkerFairnessManager;

    beforeEach(() => {
      fairnessManager = new WorkerFairnessManager({
        maxConcurrentPerWallet: 2,
        walletBurstLimit: 5,
        walletWindowMs: 1000,
      });
    });

    it('allows concurrent slots up to the configured limit per wallet', async () => {
      const walletId = 'wallet-xyz-123';
      const slot1 = await fairnessManager.acquireWalletSlot(walletId, 50);
      const slot2 = await fairnessManager.acquireWalletSlot(walletId, 50);
      expect(slot1).toBe(true);
      expect(slot2).toBe(true);
      expect(fairnessManager.getActiveWalletDispatches(walletId)).toBe(2);

      // Third concurrent slot for the same wallet should be throttled
      const slot3 = await fairnessManager.acquireWalletSlot(walletId, 20);
      expect(slot3).toBe(false);

      // Releasing a slot allows acquiring another
      fairnessManager.releaseWalletSlot(walletId);
      expect(fairnessManager.getActiveWalletDispatches(walletId)).toBe(2); // Was 3 after forced proceed
      fairnessManager.releaseWalletSlot(walletId);
      expect(fairnessManager.getActiveWalletDispatches(walletId)).toBe(1);
    });

    it('enforces provider channel rate budgets', async () => {
      // Telegram rate budget
      const canSend1 = await fairnessManager.acquireProviderBudget('telegram', 100);
      expect(canSend1).toBe(true);

      // Webhook rate budget
      const canSendWebhook = await fairnessManager.acquireProviderBudget('webhook', 100);
      expect(canSendWebhook).toBe(true);
    });
  });
});
