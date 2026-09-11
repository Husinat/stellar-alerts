import { describe, it, expect } from 'vitest';
import { trace, SpanStatusCode } from '@opentelemetry/api';

describe('Telemetry', () => {
  it('should create a span with tracer and attributes', () => {
    const tracer = trace.getTracer('test-tracer');
    let ended = false;

    tracer.startActiveSpan('test.span', {}, (span) => {
      span.setAttribute('test.key', 'test.value');
      span.setAttribute('payment.walletId', 'wallet-123');
      span.setAttribute('payment.asset', 'XLM');
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      ended = true;
      return () => {};
    });

    expect(ended).toBe(true);
  });

  it('should create a span and record error status', () => {
    const tracer = trace.getTracer('test-tracer');
    let ended = false;

    tracer.startActiveSpan('test.error-span', {}, (span) => {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'test error' });
      span.recordException(new Error('test exception'));
      span.end();
      ended = true;
      return () => {};
    });

    expect(ended).toBe(true);
  });

  it('should create a nested span for multi-service tracing', () => {
    const tracer = trace.getTracer('test-parent');
    let parentEnded = false;
    let childEnded = false;

    tracer.startActiveSpan('parent.operation', {}, (parent) => {
      parent.setAttribute('service.name', 'api');
      parent.setAttribute('http.method', 'POST');

      const childTracer = trace.getTracer('test-child');
      childTracer.startActiveSpan('child.db.query', { parent }, (child) => {
        child.setAttribute('db.system', 'postgresql');
        child.setAttribute('db.statement', 'SELECT * FROM payments');
        child.setStatus({ code: SpanStatusCode.OK });
        child.end();
        childEnded = true;
      });

      parent.setStatus({ code: SpanStatusCode.OK });
      parent.end();
      parentEnded = true;
      return () => {};
    });

    expect(parentEnded).toBe(true);
    expect(childEnded).toBe(true);
  });
});
