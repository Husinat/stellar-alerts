import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { WebhooksService } from '../webhooks.service';
import { KeyRotationManager } from '../../../utils/webhook-signer';

describe('WebhooksService Health Scorecard & Diagnostics (#161)', () => {
  let service: WebhooksService;

  beforeEach(() => {
    service = new WebhooksService();
  });

  it('should return 100% health and HEALTHY status for a fresh webhook with no logs', () => {
    const scorecard = service.calculateHealthScorecard([]);
    expect(scorecard.healthPercentage).be(100.0);
    expect(scorecard.status).toBe('HEALTHY');
    expect(scorecard.totalDeliveries7d).toBe(0);
    expect(scorecard.successfulDeliveries7d).toBe(0);
    expect(scorecard.failedDeliveries7d).toBe(0);
  });

  it('should calculate 100% health and HEALTHY status when all deliveries succeed', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 201 },
      { statusCode: 204 },
      { statusCode: 200 },
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(100.0);
    expect(scorecard.status).toBe('HEALTHY');
    expect(scorecard.totalDeliveries7d).toBe(4);
    expect(scorecard.successfulDeliveries7d).toBe(4);
    expect(scorecard.failedDeliveries7d).toBe(0);
  });

  it('should flag endpoint with <90% uptime as DEGRADED (e.g. 75% success rate)', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 500 }, // 3 success / 4 total = 75%
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(75.0);
    expect(scorecard.status).toBe('DEGRADED');
    expect(scorecard.totalDeliveries7d).toBe(4);
    expect(scorecard.successfulDeliveries7d).toBe(3);
    expect(scorecard.failedDeliveries7d).toBe(1);
  });

  it('should flag endpoint with 80% uptime as DEGRADED', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 502 }, // 4/5 = 80%
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(80.0);
    expect(scorecard.status).toBe('DEGRADED');
  });

  it('should flag endpoint with exactly 90% or higher uptime as HEALTHY', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 500 }, // 9/10 = 90%
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(90.0);
    expect(scorecard.status).toBe('HEALTHY');
  });
});

describe('KeyRotationManager Dual-Signature Key Rotation', () => {
  function hmacSignature(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should generate dual HMAC signatures during the 48-hour key rotation transition', () => {
    const manager = new KeyRotationManager({ primarySecret: 'old-secret' });
    manager.rotate('new-secret');
    const payload = '{"heartshot":"issue_updated"}';

    const headers = manager.sign(payload);

    expect(headers['X-Signature']).toBe(hmacSignature('new-secret', payload));
    expect(headers['X-Signature-Secondary']).toBe(hmacSignature('old-secret', payload));
  });

  it('should only include the primary signature when no rotation is in progress', () => {
    const manager = new KeyRotationManager({ primarySecret: 'current-secret' });
    const payload = '{"heartshot":"issue_created"}';

    const headers = manager.sign(payload);

    expect(headers['X-Signature']).toBe(hmacSignature('current-secret', payload));
    expect(headers['X-Signature-Secondary']).toBeUndefined();
  });

  it('should automatically retire the old secret after the 48-hour grace period', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const manager = new KeyRotationManager({ primarySecret: 'old-secret' });
    manager.rotate('new-secret');
    const payload = '{"heartshot":"issue_closed"}';

    // Within the grace period, both signatures should be present.
    const headersBefore = manager.sign(payload);
    expect(headersBefore['X-Signature-Secondary']).toBeDefined();

    // Advance beyond the 48-hour transition window.
    vi.advanceTimersByTime(48 * 60 * 60 * 1000 + 1);

    const headersAfter = manager.sign(payload);
    expect(headersAfter['X-Signature-Secondary']).toBeUndefined();
    expect(headersAfter['X-Signature']).toBe(hmacSignature('new-secret', payload));
  });
});
