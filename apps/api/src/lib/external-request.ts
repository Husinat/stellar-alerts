/**
 * Shared deadline and cancellation utilities for external provider requests (#303).
 *
 * Propagates timeouts and AbortSignals across Horizon, Soroban RPC,
 * notification dispatchers (Telegram, Discord, Slack, WhatsApp, Push), and Webhooks.
 */

export class ExternalRequestTimeoutError extends Error {
  public readonly provider: string;
  public readonly timeoutMs: number;
  public readonly url?: string;

  constructor(message: string, options: { provider?: string; timeoutMs: number; url?: string }) {
    super(message);
    this.name = 'ExternalRequestTimeoutError';
    this.provider = options.provider || 'ExternalProvider';
    this.timeoutMs = options.timeoutMs;
    this.url = options.url;
  }
}

/**
 * Combines an optional parent AbortSignal with a timeout deadline.
 */
export function createDeadlineSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; isTimedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Operation exceeded deadline of ${timeoutMs}ms`));
  }, timeoutMs);

  let onParentAbort: (() => void) | null = null;
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      controller.abort(parentSignal.reason);
    } else {
      onParentAbort = () => {
        clearTimeout(timer);
        controller.abort(parentSignal.reason);
      };
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (parentSignal && onParentAbort) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return {
    signal: controller.signal,
    cleanup,
    isTimedOut: () => timedOut,
  };
}

/**
 * Standard fetch with an enforced deadline and AbortSignal cancellation propagation.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 10000,
  parentSignal?: AbortSignal,
  provider = 'ExternalProvider',
): Promise<Response> {
  const { signal, cleanup, isTimedOut } = createDeadlineSignal(timeoutMs, parentSignal);

  try {
    const response = await fetch(url, {
      ...init,
      signal,
    });
    return response;
  } catch (err: any) {
    if (isTimedOut() || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      if (isTimedOut()) {
        throw new ExternalRequestTimeoutError(
          `Request to ${provider} (${url.toString()}) timed out after ${timeoutMs}ms`,
          { provider, timeoutMs, url: url.toString() },
        );
      }
      // If aborted by parent signal
      throw err;
    }
    throw err;
  } finally {
    cleanup();
  }
}

/**
 * Executes any arbitrary async provider call under a strict deadline with AbortSignal cancellation.
 */
export async function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
  provider = 'ExternalProvider',
): Promise<T> {
  const { signal, cleanup, isTimedOut } = createDeadlineSignal(timeoutMs, parentSignal);

  const timeoutPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      if (isTimedOut()) {
        reject(
          new ExternalRequestTimeoutError(
            `Call to ${provider} timed out after ${timeoutMs}ms`,
            { provider, timeoutMs },
          ),
        );
      } else {
        reject(signal.reason ?? new Error('Operation aborted'));
      }
      return;
    }

    signal.addEventListener(
      'abort',
      () => {
        if (isTimedOut()) {
          reject(
            new ExternalRequestTimeoutError(
              `Call to ${provider} timed out after ${timeoutMs}ms`,
              { provider, timeoutMs },
            ),
          );
        } else {
          reject(signal.reason ?? new Error('Operation aborted'));
        }
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([fn(signal), timeoutPromise]);
  } finally {
    cleanup();
  }
}
