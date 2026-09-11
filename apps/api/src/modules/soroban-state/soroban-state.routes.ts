import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { sorobanStateController } from './soroban-state.controller';

export async function sorobanStateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);
  app.get('/soroban/state-audit', sorobanStateController.getTimeline.bind(sorobanStateController));
}
