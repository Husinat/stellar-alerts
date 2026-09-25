import { z } from 'zod';
import {
  requestLinkSchema,
  verifyLinkSchema,
  didChallengeSchema,
  didVerifySchema,
} from '../../../api/src/modules/auth/auth.schema';

export type RequestLinkDto = z.infer<typeof requestLinkSchema>;
export type VerifyLinkDto = z.infer<typeof verifyLinkSchema>;
export type DIDChallengeDto = z.infer<typeof didChallengeSchema>;
export type DIDVerifyDto = z.infer<typeof didVerifySchema>;
