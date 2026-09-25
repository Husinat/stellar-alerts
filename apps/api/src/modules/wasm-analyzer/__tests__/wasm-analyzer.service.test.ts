import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/env', () => ({
  env: {
    WASM_ANALYZER_MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
    WASM_ANALYZER_TIMEOUT_MS: 5000,
  },
}));

const createMock = vi.fn();
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    securityAuditLog: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

import { wasmAnalyzerService } from '../wasm-analyzer.service';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe('WasmAnalyzerService', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue(undefined);
  });

  it('analyzes a structurally valid (empty) module and reports low risk', async () => {
    const result = await wasmAnalyzerService.analyze(WASM_HEADER, {
      filename: 'contract.wasm',
      contentType: 'application/wasm',
      sizeBytes: WASM_HEADER.length,
      userId: 'user-1',
    });

    expect(result.analysis.valid).toBe(true);
    expect(result.analysis.riskScore).toBe(0);
    expect(result.suspicious).toBe(false);
    expect(result.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.meta.sizeBytes).toBe(WASM_HEADER.length);
  });

  it('flags a malformed binary as suspicious and still returns a structured result', async () => {
    const malformed = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const result = await wasmAnalyzerService.analyze(malformed, {
      contentType: 'application/octet-stream',
      sizeBytes: malformed.length,
    });

    expect(result.analysis.valid).toBe(false);
    expect(result.analysis.parseError).toBeTruthy();
    expect(result.analysis.riskScore).toBe(100);
    expect(result.suspicious).toBe(true);
  });

  it('writes a SecurityAuditLog entry for every analysis', async () => {
    await wasmAnalyzerService.analyze(WASM_HEADER, {
      filename: 'contract.wasm',
      contentType: 'application/wasm',
      sizeBytes: WASM_HEADER.length,
      userId: 'user-42',
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [call] = createMock.mock.calls[0];
    expect(call.data.eventType).toBe('WASM_ANALYSIS_UPLOAD');
    expect(call.data.severity).toBe('LOW');
    expect(call.data.details).toMatchObject({
      filename: 'contract.wasm',
      contentType: 'application/wasm',
      userId: 'user-42',
      valid: true,
    });
    expect(call.data.details.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not throw when audit logging fails', async () => {
    createMock.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(
      wasmAnalyzerService.analyze(WASM_HEADER, {
        contentType: 'application/wasm',
        sizeBytes: WASM_HEADER.length,
      }),
    ).resolves.toMatchObject({ suspicious: false });
  });
});
