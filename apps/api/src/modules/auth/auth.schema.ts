import { z } from 'zod';

export const requestLinkSchema = z.object({
  email: z.string().email(),
});

export const verifyLinkSchema = z.object({
  token: z.string(),
});

export const telegramInitDataSchema = z.object({
  initData: z.string().min(1),
});

export const didChallengeSchema = z.object({
  did: z.string().min(1).max(2048),
});

export const didVerifySchema = z.object({
  did: z.string().min(1).max(2048),
  challenge: z.string().min(1).max(4096),
  signature: z.string().min(1).max(8192),
});
