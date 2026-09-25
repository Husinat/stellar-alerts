import { createLogger } from './logger';
import { prisma } from './prisma';

const log = createLogger({ module: 'WorkerLifecycle' });

export type WorkerState = 'INITIALIZING' | 'RUNNING' | 'DRAINING' | 'STOPPED';

export interface WorkerLifecycleOptions {
  workerName: string;
  drainTimeoutMs?: number;
  maxInFlight?: number;
  autoRegisterSignals?: boolean;
}

export class WorkerLifecycleManager {
  public readonly workerName: string;
  public readonly drainTimeoutMs: number;
  public readonly maxInFlight: number;

  private state: WorkerState = 'INITIALIZING';
  private activeTasks = new Set<Promise<any>>();
  private cleanupHandlers: Array<{ name: string; fn: () => Promise<void> | void }> = [];
  private activeIntervals: NodeJS.Timeout[] = [];
  private activeTimeouts: NodeJS.Timeout[] = [];

  constructor(options: WorkerLifecycleOptions) {
    this.workerName = options.workerName;
    this.drainTimeoutMs = options.drainTimeoutMs ?? 10_000;
    this.maxInFlight = options.maxInFlight ?? 50;

    if (options.autoRegisterSignals && process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      this.registerSignalHandlers();
    }
  }

  public getState(): WorkerState {
    return this.state;
  }

  public isRunning(): boolean {
    return this.state === 'RUNNING';
  }

  public isDraining(): boolean {
    return this.state === 'DRAINING';
  }

  public isStopped(): boolean {
    return this.state === 'STOPPED';
  }

  public getInFlightCount(): number {
    return this.activeTasks.size;
  }

  public markRunning(): void {
    if (this.state === 'INITIALIZING') {
      this.state = 'RUNNING';
      log.info(`[${this.workerName}] 🟢 Worker running`);
    }
  }

  /**
   * Tracks an active timer so it is automatically cleared during shutdown.
   */
  public trackInterval(interval: NodeJS.Timeout): NodeJS.Timeout {
    this.activeIntervals.push(interval);
    return interval;
  }

  public trackTimeout(timeout: NodeJS.Timeout): NodeJS.Timeout {
    this.activeTimeouts.push(timeout);
    return timeout;
  }

  /**
   * Registers a resource teardown callback (e.g., closing DB, Redis, BullMQ).
   */
  public registerCleanup(name: string, fn: () => Promise<void> | void): void {
    this.cleanupHandlers.push({ name, fn });
  }

  /**
   * Executes a worker task with concurrency bounding and in-flight tracking.
   * If the worker is DRAINING or STOPPED, the task is rejected/skipped.
   */
  public async runTask<T>(taskFn: () => Promise<T>): Promise<T | null> {
    if (this.state === 'DRAINING' || this.state === 'STOPPED') {
      log.warn(`[${this.workerName}] 🚫 Worker is ${this.state}. Rejecting new work.`);
      return null;
    }

    if (this.state === 'INITIALIZING') {
      this.state = 'RUNNING';
    }

    if (this.activeTasks.size >= this.maxInFlight) {
      log.warn(
        `[${this.workerName}] ⚠️ Concurrency limit reached (${this.activeTasks.size}/${this.maxInFlight}). Skipping task pass.`,
      );
      return null;
    }

    let resolveTask!: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    this.activeTasks.add(taskPromise);

    try {
      return await taskFn();
    } finally {
      this.activeTasks.delete(taskPromise);
      resolveTask();
    }
  }

  /**
   * Initiates graceful drain:
   * 1. Stops accepting new tasks.
   * 2. Clears registered intervals and timeouts.
   * 3. Awaits all active in-flight tasks up to `drainTimeoutMs`.
   * 4. Executes registered cleanup handlers.
   * 5. Transitions to STOPPED.
   */
  public async drainAndShutdown(reason = 'SIGTERM'): Promise<void> {
    if (this.state === 'DRAINING' || this.state === 'STOPPED') {
      return;
    }

    this.state = 'DRAINING';
    log.info(
      `[${this.workerName}] 🛑 Initiating graceful drain (${reason}) with ${this.activeTasks.size} in-flight tasks (timeout: ${this.drainTimeoutMs}ms)...`,
    );

    // Clear active timers immediately so no new iterations fire
    for (const interval of this.activeIntervals) {
      clearInterval(interval);
    }
    this.activeIntervals = [];

    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts = [];

    // Bounded wait for in-flight tasks
    if (this.activeTasks.size > 0) {
      const drainPromise = Promise.allSettled(Array.from(this.activeTasks));
      let timeoutHandle: NodeJS.Timeout;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          log.warn(
            `[${this.workerName}] ⚠️ Drain timeout (${this.drainTimeoutMs}ms) exceeded with ${this.activeTasks.size} remaining in-flight tasks. Forcing cleanup.`,
          );
          resolve();
        }, this.drainTimeoutMs);
      });

      await Promise.race([drainPromise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
    }

    // Run registered teardowns
    log.info(`[${this.workerName}] 🧹 Running ${this.cleanupHandlers.length} cleanup handlers...`);
    for (const { name, fn } of this.cleanupHandlers) {
      try {
        await fn();
        log.info(`[${this.workerName}] ✅ Cleanup "${name}" completed`);
      } catch (err: any) {
        log.error(`[${this.workerName}] ❌ Cleanup "${name}" failed: ${err.message}`);
      }
    }

    this.state = 'STOPPED';
    log.info(`[${this.workerName}] ✅ Drain completed successfully. Worker stopped.`);

    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      process.exit(0);
    }
  }

  /**
   * Registers SIGTERM and SIGINT process listeners.
   */
  public registerSignalHandlers(processObj: NodeJS.Process = process): void {
    const handler = (sig: string) => {
      void this.drainAndShutdown(sig);
    };

    processObj.on('SIGTERM', () => handler('SIGTERM'));
    processObj.on('SIGINT', () => handler('SIGINT'));
  }
}
