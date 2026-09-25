import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerLifecycleManager } from '../worker-lifecycle';

describe('Worker Graceful Shutdown & Drain Semantics (#308)', () => {
  let manager: WorkerLifecycleManager;

  beforeEach(() => {
    manager = new WorkerLifecycleManager({
      workerName: 'TestWorker',
      drainTimeoutMs: 200,
      maxInFlight: 2,
    });
  });

  it('initializes in INITIALIZING state and transitions to RUNNING on first task', async () => {
    expect(manager.getState()).toBe('INITIALIZING');
    expect(manager.getInFlightCount()).toBe(0);

    const result = await manager.runTask(async () => 'completed');
    expect(result).toBe('completed');
    expect(manager.getState()).toBe('RUNNING');
    expect(manager.getInFlightCount()).toBe(0);
  });

  it('bounds in-flight concurrency to maxInFlight', async () => {
    let resolveTask1!: () => void;
    let resolveTask2!: () => void;

    const task1 = manager.runTask(
      () =>
        new Promise((resolve) => {
          resolveTask1 = () => resolve('task1');
        }),
    );
    const task2 = manager.runTask(
      () =>
        new Promise((resolve) => {
          resolveTask2 = () => resolve('task2');
        }),
    );

    expect(manager.getInFlightCount()).toBe(2);

    // Third task should be rejected due to maxInFlight=2
    const task3 = await manager.runTask(async () => 'task3');
    expect(task3).toBeNull();

    resolveTask1();
    resolveTask2();

    await Promise.all([task1, task2]);
    expect(manager.getInFlightCount()).toBe(0);
  });

  it('drains in-flight tasks and runs cleanup handlers on shutdown', async () => {
    const cleanupMock = vi.fn().mockResolvedValue(undefined);
    manager.registerCleanup('db-cleanup', cleanupMock);

    let finishedInFlight = false;

    // Start a long-running in-flight task
    const inFlightPromise = manager.runTask(async () => {
      await new Promise((r) => setTimeout(r, 50));
      finishedInFlight = true;
      return 'done';
    });

    expect(manager.getInFlightCount()).toBe(1);

    // Trigger drain while task is running
    const shutdownPromise = manager.drainAndShutdown('TEST_SIGNAL');

    expect(manager.isDraining()).toBe(true);

    // New tasks should be rejected immediately during drain
    const rejectedTask = await manager.runTask(async () => 'should_not_run');
    expect(rejectedTask).toBeNull();

    await shutdownPromise;
    await inFlightPromise;

    expect(finishedInFlight).toBe(true);
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    expect(manager.isStopped()).toBe(true);
    expect(manager.getInFlightCount()).toBe(0);
  });

  it('forces cleanup when in-flight tasks exceed drain timeout', async () => {
    const cleanupMock = vi.fn().mockResolvedValue(undefined);
    manager.registerCleanup('timeout-cleanup', cleanupMock);

    // Task that takes longer than drainTimeoutMs (200ms)
    void manager.runTask(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });

    const start = Date.now();
    await manager.drainAndShutdown('TIMEOUT_TEST');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    expect(manager.isStopped()).toBe(true);
  });
});
