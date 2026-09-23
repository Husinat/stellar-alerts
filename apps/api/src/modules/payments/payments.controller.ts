import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { generateTaxExportCsv } from '../../utils/tax-exporter';
import { generateTransactionReceiptPdf } from '../../utils/receipt-generator';
import { prisma } from '../../lib/prisma';
import { paymentsService } from './payments.service';

const getPaymentsSchema = z.object({
  // Optional: omitted by the dashboard's "All Wallets" view (see apps/web
  // src/app/page.tsx fetchPayments/fetchSummary), which previously 400'd here.
  walletId: z.string().optional(),
  limit: z.coerce.number().optional().default(20),
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

  async getReceipt(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const { txHash } = request.params as { txHash: string };
    if (!txHash) {
      return reply.status(400).send({ error: 'Missing transaction hash parameter' });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [
          { txHash: txHash },
          { id: txHash },
        ],
      },
      include: {
        wallet: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!payment) {
      return reply.status(404).send({ error: 'Payment transaction not found' });
    }

    if (payment.wallet.userId !== request.user.id) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Unauthorized access to transaction receipt' });
    }

    const { buffer, verificationHash } = await generateTransactionReceiptPdf({
      paymentId: payment.id,
      txHash: payment.txHash,
      fromAddress: payment.fromAddress,
      toWalletPublicKey: payment.wallet.publicKey,
      walletLabel: payment.wallet.label,
      amount: payment.amount.toString(),
      asset: payment.asset,
      assetIssuer: payment.assetIssuer,
      memo: payment.memo,
      receivedAt: payment.receivedAt,
      userEmail: payment.wallet.user.email,
    });

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="receipt-${payment.txHash.slice(0, 12)}.pdf"`)
      .header('X-Receipt-Verification-Hash', verificationHash)
      .send(buffer);
  }
}

export const paymentsController = new PaymentsController();
