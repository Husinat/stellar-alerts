import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sorobanStateService } from './soroban-state.service';

const timelineSchema = z.object({
  contractId: z.string().min(1),
  ledgerKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional().default(100),
});

export class SorobanStateController {
  async getTimeline(request: FastifyRequest, reply: FastifyReply) {
    const parsed = timelineSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }

    const timeline = await sorobanStateService.getTimeline(
      parsed.data.contractId,
      parsed.data.ledgerKey,
      parsed.data.limit,
    );
    return reply.send({ success: true, timeline });
  }
}

export const sorobanStateController = new SorobanStateController();
