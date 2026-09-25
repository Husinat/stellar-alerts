import { describe, it, expect, vi } from 'vitest';
import {
  fetchWithTimeout,
  withDeadline,
  ExternalRequestTimeoutError,
  createDeadlineSignal,
} from '../external-request';

describe('External Request Deadlines & Cancellation Engine (#303)', () => {
  describe('createDeadlineSignal', () => {
    it('aborts when timeout expires', async () => {
      const { signal, cleanup } = createDeadlineSignal(50);
      expect(signal.aborted).toBe(false);

      await new Promise((r) => setTimeout(r, 60));
      expect(signal.aborted).toBe(true);
      cleanup();
    });

    it('forwards parent abort signal immediately', () => {
      const parentController = new AbortController();
      const { signal, cleanup } = createDeadlineSignal(5000, parentController.signal);

      expect(signal.aborted).toBe(false);
      parentController.abort();
      expect(signal.aborted).toBe(true);
      cleanup();
    });
  });

  describe('withDeadline', () => {
    it('returns result when operation completes within deadline', async () => {
      const result = await withDeadline(
        async () => {
          return 'fast-response';
        },
        500,
        undefined,
        'TestProvider',
      );
      expect(result).toBe('fast-response');
    });

    it('throws ExternalRequestTimeoutError when operation exceeds deadline', async () => {
      await expect(
        withDeadline(
          async () => {
            await new Promise((r) => setTimeout(r, 100));
            return 'too-slow';
          },
          30,
          undefined,
          'SlowHorizon',
        ),
      ).rejects.toThrow(ExternalRequestTimeoutError);
    });

    it('passes abort signal to worker function so it can cancel in-flight work', async () => {
      let abortedInside = false;

      await expect(
        withDeadline(
          async (signal) => {
            signal.addEventListener('abort', () => {
              abortedInside = true;
            });
            await new Promise((r) => setTimeout(r, 100));
          },
          30,
          undefined,
          'SorobanRPC',
        ),
      ).rejects.toThrow();

      expect(abortedInside).toBe(true);
    });
  });

  describe('fetchWithTimeout', () => {
    it('throws ExternalRequestTimeoutError on network request timeout', async () => {
      // Mock global fetch to simulate a delayed response
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url, init) => {
        return new Promise((resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              reject(new DOMException('The user aborted a request.', 'AbortError'));
            });
          }
        });
      });

      try {
        await expect(
          fetchWithTimeout('https://api.telegram.org/bot123/getMe', {}, 50, undefined, 'Telegram'),
        ).rejects.toThrow(ExternalRequestTimeoutError);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('aborts immediately when parent signal is already aborted', async () => {
      const parentController = new AbortController();
      parentController.abort(new Error('User cancelled'));

      await expect(
        fetchWithTimeout('https://webhook.site/test', {}, 5000, parentController.signal, 'Webhook'),
      ).rejects.toThrow();
    });
  });
});
