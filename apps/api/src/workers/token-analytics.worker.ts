import { Prisma } from '@prisma/client';
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
  const amountDecimal = new Prisma.Decimal(amount);
  const ledger = ledgerSeq ?? 0;

  let newEventId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.sacTokenSupply.findUnique({ where: { contractId } });

    if (existing) {
      if (eventType === 'MINT') {
        await tx.sacTokenSupply.update({
          where: { contractId },
          data: {
            totalSupply: existing.totalSupply.plus(amountDecimal),
            totalMinted: existing.totalMinted.plus(amountDecimal),
            lastLedger: ledger,
          },
        });
      } else {
        const newSupply = existing.totalSupply.minus(amountDecimal);
        await tx.sacTokenSupply.update({
          where: { contractId },
          data: {
            totalSupply: newSupply.lessThan(0) ? new Prisma.Decimal(0) : newSupply,
            totalBurned: existing.totalBurned.plus(amountDecimal),
            lastLedger: ledger,
          },
        });
      }
    } else {
      await tx.sacTokenSupply.create({
        data: {
          contractId,
          totalSupply: eventType === 'MINT' ? amountDecimal : new Prisma.Decimal(0),
          totalMinted: eventType === 'MINT' ? amountDecimal : new Prisma.Decimal(0),
          totalBurned: eventType === 'BURN' ? amountDecimal : new Prisma.Decimal(0),
          lastLedger: ledger,
        },
      });
    }

    const alertRequired = amountDecimal.greaterThan(LARGE_OPERATION_THRESHOLD);
    const eventRecord = await tx.sacMintBurnEvent.create({
      data: {
        contractId,
        eventType,
        amount: amountDecimal,
        fromAddress: from || null,
        toAddress: to || null,
        ledgerSeq: ledger,
        alertRequired,
      },
    });
    if (alertRequired) {
      newEventId = eventRecord.id;
    }
  });

  if (newEventId) {
    console.warn(`[TokenAnalytics] 📈 Large ${eventType} on ${contractId}: ${amount} units (ledger ${ledger})`);
    await prisma.sacMintBurnEvent.update({
      where: { id: newEventId },
      data: { alertDispatched: true },
    });
  }
}

async function processContract(contractId: string): Promise<void> {
  const supply = await prisma.sacTokenSupply.findUnique({ where: { contractId } });
  const startLedger = (supply?.lastLedger ?? 0) + 1;
  const latestLedger = await getSorobanLatestLedger();
  if (startLedger > latestLedger) return;

  let lastProcessedLedger = startLedger - 1;

  for await (const batch of fetchContractEventsInRange(contractId, startLedger, latestLedger)) {
    for (const event of batch) {
      const parsed = parseSorobanMintBurnEvent(event);
      if (parsed && parsed.ledgerSeq) {
        await processMintBurn(parsed);
      }
      const eventLedger = event.ledger || parsed?.ledgerSeq || 0;
      if (eventLedger > lastProcessedLedger) {
        lastProcessedLedger = eventLedger;
      }
    }
  }

  if (lastProcessedLedger < startLedger) {
    // No events in the range, advance cursor to latest ledger
    lastProcessedLedger = latestLedger;
  }

  if (lastProcessedLedger > (supply?.lastLedger ?? 0)) {
    await prisma.sacTokenSupply.upsert({
      where: { contractId },
      create: { contractId, lastLedger: lastProcessedLedger },
      update: { lastLedger: lastProcessedLedger },
    });
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
