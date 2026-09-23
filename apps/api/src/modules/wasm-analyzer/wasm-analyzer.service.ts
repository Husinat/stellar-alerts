import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { analyzeWasmBytecode, type WasmAnalysisResult } from '../../utils/wasm-analyzer';

export interface WasmUploadMeta {
  filename?: string;
  contentType: string;
  sizeBytes: number;
  userId?: string;
}

export interface WasmAnalysisResponse {
  analysis: WasmAnalysisResult;
  meta: {
    filename?: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  };
  /** True once riskScore crosses a threshold worth a human's attention. */
  suspicious: boolean;
}

// Findings at/above this score are surfaced as "suspicious" for callers that
// just want a boolean gate rather than parsing the full findings list.
const SUSPICIOUS_RISK_THRESHOLD = 25;

/**
 * Runs the static analyzer with a wall-clock budget. `analyzeWasmBytecode`
 * is synchronous and its own internal loops are already bounded (LEB128
 * caps at 5 bytes, section/function iteration is bounded by the section's
 * declared size), so it cannot hang — this timeout is a defense-in-depth
 * backstop against any future change to that invariant, and gives the
 * endpoint a single well-defined "analysis timed out" outcome to return
 * instead of letting a pathological input block a request indefinitely.
 */
async function analyzeWithTimeout(bytes: Uint8Array, timeoutMs: number): Promise<WasmAnalysisResult> {
  return Promise.race([
    Promise.resolve().then(() => analyzeWasmBytecode(bytes)),
    new Promise<WasmAnalysisResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            valid: false,
            parseError: `Analysis did not complete within ${timeoutMs}ms`,
            findings: [],
            riskScore: 100,
            stats: {
              sectionCount: 0,
              functionCount: 0,
              hasMemorySection: false,
              hasUnboundedMemory: false,
              importedFunctionCount: 0,
            },
          }),
        timeoutMs,
      ),
    ),
  ]);
}

export class WasmAnalyzerService {
  async analyze(bytes: Uint8Array, meta: WasmUploadMeta): Promise<WasmAnalysisResponse> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const analysis = await analyzeWithTimeout(bytes, env.WASM_ANALYZER_TIMEOUT_MS);
    const suspicious = !analysis.valid || analysis.riskScore >= SUSPICIOUS_RISK_THRESHOLD;

    await this.logAudit({
      eventType: 'WASM_ANALYSIS_UPLOAD',
      severity: suspicious ? 'HIGH' : 'LOW',
      details: {
        filename: meta.filename,
        contentType: meta.contentType,
        sizeBytes: meta.sizeBytes,
        sha256,
        userId: meta.userId,
        valid: analysis.valid,
        riskScore: analysis.riskScore,
        findingCodes: analysis.findings.map((f) => f.code),
        parseError: analysis.parseError,
      },
    });

    return {
      analysis,
      meta: {
        filename: meta.filename,
        contentType: meta.contentType,
        sizeBytes: meta.sizeBytes,
        sha256,
      },
      suspicious,
    };
  }

  /**
   * Audit logging must never fail the request it's attached to: a DB hiccup
   * on the logging side shouldn't turn a successful (or cleanly rejected)
   * analysis into a 500. Failures are logged and swallowed.
   */
  async logAudit(entry: { eventType: string; severity: 'HIGH' | 'LOW'; details: Record<string, unknown> }) {
    try {
      await prisma.securityAuditLog.create({
        data: {
          eventType: entry.eventType,
          severity: entry.severity,
          details: entry.details as any,
        },
      });
    } catch (err: any) {
      console.error(`[WasmAnalyzer] Failed to write audit log: ${err?.message || err}`);
    }
  }
}

export const wasmAnalyzerService = new WasmAnalyzerService();
