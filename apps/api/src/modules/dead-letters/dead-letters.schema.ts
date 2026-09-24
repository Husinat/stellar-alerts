import { z } from 'zod';

export const deadLetterIdSchema = z.object({
  id: z.string().min(1),
});

export const listDeadLettersQuerySchema = z.object({
  channel: z.string().min(1).max(40).optional(),
  status: z.enum(['pending', 'retried', 'suppressed']).optional(),
  q: z.string().max(200).optional(),
  maxAgeDays: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const suppressDeadLetterSchema = z.object({
  note: z.string().max(2000).optional(),
});