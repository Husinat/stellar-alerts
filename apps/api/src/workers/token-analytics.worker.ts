import { Decimal } from '@prisma/client/runtime/client';
import { prisma } from '../lib/prisma';
import {
  getActiveContractIds,
  getSorobanLatestLedger,
  fetchContractEventsInRange,
  parseSorobanMintBurnEvent,
  ParsedSorobanMintBurn,
  loadContractRegistry,
} from '../lib/soroban';
import { registerSupervisorHeartbeat } from './supervisor';

const POLL_INTERVAL_MS = 15_000;
const LARGE_OPERATION_THRESHOLD = 100_000;

async function processMintBurn(parsed: ParsedSorobanMintBurn): Promise<void> {
  const { contractId, eventType, amount, from, to, ledgerSeq } = parsed;
  const amountDecimal = new Decimal(amount);
  const ledger = ledgerSeq ?? 0;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.sacTokenSupply.findUnique({ where: { contractId } });

    if (existing) {
      if (eventType === 'MINT') {
        const newMinted = (existing.totalMinted as any).plus(amountDecimal);
        const newCirculating = (existing.circulatingSupply as any).plus(amountDecimal);
        await tx.sacTokenSupply.update({
          where: { contractId },
          data: {
            circulatingSupply: newCirculating,
            totalMinted: newMinted,
          },
        });
      } else {
        const newBurned = (existing.totalBurned as any).plus(amountDecimal);
        const diff = (existing.circulatingSupply as any).minus(amountDecimal);
        const newCirculating = diff.lessThan(0) ? new Decimal(0) : diff;
        await tx.sacTokenSupply.update({
          where: { contractId },
          data: {
            circulatingSupply: newCirculating,
            totalBurned: newBurned,
          },
        });
      }
    } else {
      await tx.sacTokenSupply.create({
        data: {
          contractId,
          circulatingSupply: eventType === 'MINT' ? amountDecimal : new Decimal(0),
          totalMinted: eventType === 'MINT' ? amountDecimal : new Decimal(0),
          totalBurned: eventType === 'BURN' ? amountDecimal : new Decimal(0),
        },
      });
    }

    await tx.sacTokenMintBurnEvent.create({
      data: {
        contractId,
        eventType,
        amount: amountDecimal,
        from: from || null,
        to: to || null,
        ledgerSeq: ledger,
      },
    });
  });

  if (amountDecimal.greaterThan(LARGE_OPERATION_THRESHOLD)) {
    console.warn(`[TokenAnalytics] 📈 Large ${eventType} on ${contractId}: ${amount} units (ledger ${ledger})`);
  }
}

async function processContract(contractId: string): Promise<void> {
  const lastEvent = await prisma.sacTokenMintBurnEvent.findFirst({
    where: { contractId },
    orderBy: { ledgerSeq: 'desc' },
    select: { ledgerSeq: true },
  });
  const startLedger = (lastEvent?.ledgerSeq ?? 0) + 1;
  const latestLedger = await getSorobanLatestLedger();
  if (startLedger > latestLedger) return;

  for await (const batch of fetchContractEventsInRange(contractId, startLedger, latestLedger)) {
    for (const event of batch) {
      const parsed = parseSorobanMintBurnEvent(event);
      if (parsed && parsed.ledgerSeq) {
        await processMintBurn(parsed);
      }
    }
  }
}

async function runAnalytics(): Promise<void> {
  const contractIds = getActiveContractIds();
  if (contractIds.length === 0) {
    await loadContractRegistry();
    return;
  }

  for (const contractId of contractIds) {
    try {
      await processContract(contractId);
    } catch (error: any) {
      console.error(`[TokenAnalytics] Error processing ${contractId}:`, error.message);
    }
  }
}

async function main() {
  registerSupervisorHeartbeat();
  await loadContractRegistry();
  await runAnalytics();
  setInterval(async () => {
    try {
      await runAnalytics();
    } catch (error: any) {
      console.error('[TokenAnalytics] Run error:', error.message);
    }
  }, POLL_INTERVAL_MS);
}

main();
