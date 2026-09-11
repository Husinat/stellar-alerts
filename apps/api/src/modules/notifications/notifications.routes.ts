/**
 * Notifications Routes
 */

import { FastifyInstance } from 'fastify';
import { notificationsController } from './notifications.controller';
import { authenticateHook } from '../../middleware/auth.middleware';

export async function notificationsRoutes(app: FastifyInstance) {
  app.post(
    '/notifications/preferences',
    { preHandler: [authenticateHook] },
    notificationsController.updatePreferences.bind(notificationsController)
  );

  app.get(
    '/notifications/preferences',
    { preHandler: [authenticateHook] },
    notificationsController.getPreferences.bind(notificationsController)
  );
}
