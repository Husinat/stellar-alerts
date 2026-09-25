/**
 * End-to-end tests for POST /wasm-analyzer/analyze, exercising the real
 * @fastify/multipart parsing + controller + service stack. Auth is
 * exercised separately by the shared auth.middleware tests, so this app
 * registers the route directly (no authenticateHook) to stay independent
 * of Redis/DB availability in CI — request.user is set the same way the
 * hook would set it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';

vi.mock('../../../config/env', () => ({
  env: {
    WASM_ANALYZER_MAX_UPLOAD_BYTES: 1024, // small on purpose to exercise the 413 path
    WASM_ANALYZER_TIMEOUT_MS: 5000,
  },
}));

const createMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    securityAuditLog: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

import { wasmAnalyzerController } from '../wasm-analyzer.controller';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 1024, files: 1 } });
  app.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user' } as any;
  });
  app.post('/wasm-analyzer/analyze', wasmAnalyzerController.analyze.bind(wasmAnalyzerController));
  return app;
}

function multipartRequest(form: FormData) {
  return {
    method: 'POST' as const,
    url: '/wasm-analyzer/analyze',
    payload: form,
    headers: form.getHeaders(),
  };
}

describe('POST /wasm-analyzer/analyze', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    createMock.mockClear();
  });

  it('returns 200 with structured findings for a valid WASM upload', async () => {
    const form = new FormData();
    form.append('file', WASM_HEADER, { filename: 'contract.wasm', contentType: 'application/wasm' });

    const response = await app.inject(multipartRequest(form));

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.analysis.valid).toBe(true);
    expect(body.suspicious).toBe(false);
    expect(body.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with valid:false for a malformed (non-WASM) upload', async () => {
    const form = new FormData();
    form.append('file', Buffer.from([0x01, 0x02, 0x03, 0x04]), {
      filename: 'not-wasm.bin',
      contentType: 'application/octet-stream',
    });

    const response = await app.inject(multipartRequest(form));

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.analysis.valid).toBe(false);
    expect(body.analysis.parseError).toBeTruthy();
    expect(body.suspicious).toBe(true);
  });

  it('returns 415 for a disallowed content-type', async () => {
    const form = new FormData();
    form.append('file', WASM_HEADER, { filename: 'contract.txt', contentType: 'text/plain' });

    const response = await app.inject(multipartRequest(form));

    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe('UNSUPPORTED_CONTENT_TYPE');
  });

  it('returns 413 for an oversized upload', async () => {
    const oversized = Buffer.concat([WASM_HEADER, Buffer.alloc(2048, 0xff)]);
    const form = new FormData();
    form.append('file', oversized, { filename: 'huge.wasm', contentType: 'application/wasm' });

    const response = await app.inject(multipartRequest(form));

    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('FILE_TOO_LARGE');
  });

  it('returns 400 when no file field is present', async () => {
    const form = new FormData();
    form.append('note', 'no file here');

    const response = await app.inject(multipartRequest(form));

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('FILE_MISSING');
  });

  it('returns 400 for a non-multipart request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/wasm-analyzer/analyze',
      payload: { hello: 'world' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('NOT_MULTIPART');
  });
});
