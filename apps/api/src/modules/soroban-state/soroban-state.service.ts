import { prisma } from '../../lib/prisma';
import { createJsonPatch, type JsonValue } from '../../utils/state-diff';

export interface SorobanStateSnapshotInput {
  contractId: string;
  ledgerKey: string;
  ledgerSeq: number;
  snapshot: JsonValue;
}

export class SorobanStateService {
  async recordSnapshot(input: SorobanStateSnapshotInput) {
    const previous = await prisma.sorobanStateAudit.findFirst({
      where: {
        contractId: input.contractId,
        ledgerKey: input.ledgerKey,
        ledgerSeq: { lt: input.ledgerSeq },
      },
      orderBy: { ledgerSeq: 'desc' },
    });

    const patch = createJsonPatch(previous?.snapshot as JsonValue | undefined, input.snapshot);
    return prisma.sorobanStateAudit.upsert({
      where: {
        contractId_ledgerKey_ledgerSeq: {
          contractId: input.contractId,
          ledgerKey: input.ledgerKey,
          ledgerSeq: input.ledgerSeq,
        },
      },
      create: {
        contractId: input.contractId,
        ledgerKey: input.ledgerKey,
        ledgerSeq: input.ledgerSeq,
        snapshot: input.snapshot as any,
        patch: patch as any,
        previousLedger: previous?.ledgerSeq ?? null,
      },
      update: {
        snapshot: input.snapshot as any,
        patch: patch as any,
        previousLedger: previous?.ledgerSeq ?? null,
      },
    });
  }

  async getTimeline(contractId: string, ledgerKey?: string, limit = 100) {
    return prisma.sorobanStateAudit.findMany({
      where: { contractId, ...(ledgerKey ? { ledgerKey } : {}) },
      orderBy: { ledgerSeq: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }
}

export const sorobanStateService = new SorobanStateService();
