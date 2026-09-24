import { FastifyRequest, FastifyReply } from 'fastify';
import {
  deadLetterIdSchema,
  listDeadLettersQuerySchema,
  suppressDeadLetterSchema,
} from './dead-letters.schema';
import { deadLettersService } from './dead-letters.service';

export class DeadLettersController {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const parsed = listDeadLettersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }

    const userId = (request as any).user.id;
    const result = await deadLettersService.list(userId, parsed.data);
    return reply.send({ success: true, ...result });
  }

  async get(request: FastifyRequest, reply: FastifyReply) {
    const parsed = deadLetterIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parsed.error.format() });
    }

    const userId = (request as any).user.id;
    const deadLetter = await deadLettersService.get(parsed.data.id, userId);
    return reply.send({ success: true, deadLetter });
  }

  async replay(request: FastifyRequest, reply: FastifyReply) {
    const parsed = deadLetterIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parsed.error.format() });
    }

    try {
      const userId = (request as any).user.id;
      const result = await deadLettersService.replay(parsed.data.id, userId);
      return reply.send({ success: result.success, message: result.message });
    } catch (error: any) {
      if (error.message.startsWith('Dead letter')) {
        return reply.status(404).send({ error: 'Not Found', message: error.message });
      }
      if (error.message.includes('Suppressed')) {
        return reply.status(409).send({ error: 'Conflict', message: error.message });
      }
      throw error;
    }
  }

  async suppress(request: FastifyRequest, reply: FastifyReply) {
    const params = deadLetterIdSchema.safeParse(request.params);
    const body = suppressDeadLetterSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: 'Invalid request', details: params.success ? body.error?.format() : params.error.format() });
    }

    try {
      const userId = (request as any).user.id;
      const deadLetter = await deadLettersService.suppress(params.data.id, userId, body.data.note);
      return reply.send({ success: true, deadLetter });
    } catch (error: any) {
      if (error.message.startsWith('Dead letter')) {
        return reply.status(404).send({ error: 'Not Found', message: error.message });
      }
      if (error.message.includes('already suppressed')) {
        return reply.status(409).send({ error: 'Conflict', message: error.message });
      }
      throw error;
    }
  }
}

export const deadLettersController = new DeadLettersController();