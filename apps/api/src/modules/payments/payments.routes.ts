import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { paymentsController } from './payments.controller';

export async function paymentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);

  app.get('/payments', paymentsController.getPayments.bind(paymentsController));
  app.get('/payments/summary', paymentsController.getPaymentsSummary.bind(paymentsController));
  app.get('/payments/tax-export', paymentsController.getTaxExport.bind(paymentsController));
  app.get('/payments/export/pdf', paymentsController.getLedgerPdfExport.bind(paymentsController));
  app.get('/payments/analytics/cross-ledger', paymentsController.getCrossLedgerAnalytics.bind(paymentsController));
  app.get('/payments/:txHash/receipt', paymentsController.getReceipt.bind(paymentsController));
}
