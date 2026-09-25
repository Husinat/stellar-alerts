import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { wasmAnalyzerController } from './wasm-analyzer.controller';

export async function wasmAnalyzerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);

  app.post(
    '/wasm-analyzer/analyze',
    // Tighter than the global rate limit: analysis is CPU/DB work per
    // request, so uploads get their own stricter per-client budget on top
    // of the app-wide limiter.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    wasmAnalyzerController.analyze.bind(wasmAnalyzerController),
  );
}
