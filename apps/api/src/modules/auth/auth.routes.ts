import { FastifyInstance } from 'fastify';
import { authController } from './auth.controller';
import { authenticateHook } from '../../middleware/auth.middleware';
import { verifyThresholdSignature } from '../../utils/tss-verifier';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/request-link', authController.requestMagicLink.bind(authController));
  app.get('/auth/verify', authController.verifyMagicLink.bind(authController));
  app.post('/auth/did/challenge', authController.requestDIDChallenge.bind(authController));
  app.post('/auth/did/verify', authController.verifyDIDAuth.bind(authController));
  app.post('/auth/telegram', authController.verifyTelegramInitData.bind(authController));
  app.get('/auth/me', { preHandler: [authenticateHook] }, authController.getMe.bind(authController));
  app.post('/auth/logout', { preHandler: [authenticateHook] }, authController.logout.bind(authController));
  
  // MFA endpoints (require authentication)
  app.post('/auth/mfa/setup', { preHandler: [authenticateHook] }, authController.setupMFA.bind(authController));
  app.post('/auth/mfa/enable', { preHandler: [authenticateHook] }, authController.enableMFA.bind(authController));
  app.post('/auth/mfa/disable', { preHandler: [authenticateHook] }, authController.disableMFA.bind(authController));
  app.get('/auth/mfa/status', { preHandler: [authenticateHook] }, authController.getMFAStatus.bind(authController));
  app.post('/auth/mfa/recovery-codes', { preHandler: [authenticateHook] }, authController.generateRecoveryCodes.bind(authController));
  app.get('/auth/mfa/recovery-codes', { preHandler: [authenticateHook] }, authController.getRecoveryCodeStatus.bind(authController));

  // Lost device recovery (public)
  app.post('/auth/mfa/recover', authController.recoverAccount.bind(authController));
}

