import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { walletsController } from './wallets.controller';

export async function walletsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);

  app.post('/wallets', walletsController.addWallet.bind(walletsController));
  app.get('/wallets', walletsController.getWallets.bind(walletsController));
  app.get('/wallets/:id/ingestion-status', walletsController.getIngestionStatus.bind(walletsController));
  app.delete('/wallets/:id', walletsController.deleteWallet.bind(walletsController));
}
