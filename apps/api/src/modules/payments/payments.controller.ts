import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { generateTaxExportCsv } from '../../utils/tax-exporter';
import { generateLedgerStatementPdf } from '../../utils/pdf-generator';
import { prismaRead } from '../../lib/prisma';
import { paymentsService } from './payments.service';

const getPaymentsSchema = z
  .object({
    // Optional: omitted by the dashboard's "All Wallets" view (see apps/web
    // src/app/(app)/dashboard/page.tsx fetchPayments), which previously 400'd here.
    walletId: z.string().optional(),
    limit: z.coerce.number().optional().default(20),
    asset: z.string().optional(),
    memo: z.string().optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    sortBy: z.enum(['receivedAt', 'amount', 'asset']).optional().default('receivedAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
    message: 'dateFrom must be before or equal to dateTo',
    path: ['dateFrom'],
  });

const getSummarySchema = z.object({
  walletId: z.string().optional(),
  fiat: z.string().optional(),
});

const getTaxExportSchema = z.object({
  walletId: z.string().optional(),
  format: z.enum(['cointracker', 'koinly', 'irs8949']).optional().default('cointracker'),
});

const getCrossLedgerSchema = z.object({
  walletId: z.string().optional(),
});

const getLedgerPdfExportSchema = z.object({
  walletId: z.string().optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
});

export class PaymentsController {
  async getPayments(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getPaymentsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const payments = await paymentsService.getPayments(
      request.user.id,
      parsed.data.walletId,
      parsed.data.limit,
      {
        asset: parsed.data.asset,
        memo: parsed.data.memo,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        sortBy: parsed.data.sortBy,
        sortOrder: parsed.data.sortOrder,
      },
    );
    return reply.send({ success: true, payments });
  }

  async getSummary(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getSummarySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const summary = await paymentsService.getPaymentsSummary(
      request.user.id,
      parsed.data.walletId,
      parsed.data.fiat,
    );
    return reply.send({ success: true, summary });
  }

  async getPaymentsSummary(request: FastifyRequest, reply: FastifyReply) {
    return this.getSummary(request, reply);
  }

  async getTaxExport(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getTaxExportSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const payments = await paymentsService.getPayments(request.user.id, parsed.data.walletId, 5000);
    const csv = generateTaxExportCsv(
      payments.map((payment) => ({
        date: payment.receivedAt,
        asset: payment.asset,
        quantity: payment.amount.toString(),
        usdValue: payment.amount.toString(),
        type: 'receive',
        txHash: payment.txHash,
        fromAddress: payment.fromAddress,
      })),
      parsed.data.format,
    );

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="tax-export-${parsed.data.format}.csv"`)
      .send(csv);
  }

  async getLedgerPdfExport(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getLedgerPdfExportSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const periodEnd = parsed.data.periodEnd ?? new Date();
    const periodStart =
      parsed.data.periodStart ?? new Date(periodEnd.getTime() - 365 * 24 * 60 * 60 * 1000);

    const payments = await paymentsService.getPayments(request.user.id, parsed.data.walletId, 5000);
    const inPeriod = payments.filter((payment) => {
      const receivedAt = new Date(payment.receivedAt);
      return receivedAt >= periodStart && receivedAt <= periodEnd;
    });

    const walletMeta = parsed.data.walletId
      ? await prismaRead.wallet.findFirst({
          where: { id: parsed.data.walletId, userId: request.user.id },
          select: { publicKey: true, label: true },
        })
      : null;

    const pdf = await generateLedgerStatementPdf({
      userEmail: request.user.email,
      walletLabel: walletMeta?.label ?? null,
      publicKey: walletMeta?.publicKey ?? 'All linked wallets',
      periodStart,
      periodEnd,
      payments: inPeriod.map((payment) => ({
        txHash: payment.txHash,
        fromAddress: payment.fromAddress,
        amount: payment.amount.toString(),
        asset: payment.asset,
        receivedAt: payment.receivedAt,
      })),
    });

    const filename = `ledger-statement-${periodStart.toISOString().slice(0, 10)}.pdf`;
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf);
  }

  async getCrossLedgerAnalytics(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getCrossLedgerSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const analytics = await paymentsService.getCrossLedgerAnalytics(
      request.user.id,
      parsed.data.walletId,
    );
    return reply.send({ success: true, analytics });
  }
}

export const paymentsController = new PaymentsController();
