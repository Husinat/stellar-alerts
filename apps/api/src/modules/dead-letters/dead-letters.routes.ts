import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { deadLettersController } from './dead-letters.controller';

export async function deadLettersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);

  app.get('/dead-letters', deadLettersController.list.bind(deadLettersController));
  app.get('/dead-letters/:id', deadLettersController.get.bind(deadLettersController));
  app.post('/dead-letters/:id/replay', deadLettersController.replay.bind(deadLettersController));
  app.post('/dead-letters/:id/suppress', deadLettersController.suppress.bind(deadLettersController));
}