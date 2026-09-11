/**
 * Notifications Controller
 * 
 * Handles HTTP requests for notification preferences.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { notificationsService } from './notifications.service';

export class NotificationsController {
  /**
   * Update notification preferences
   */
  async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as any;
    const { mfaToken, ...preferences } = body;

    try {
      await notificationsService.updatePreferences(
        request.user.id,
        preferences,
        mfaToken
      );

      return reply.send({
        success: true,
        message: 'Notification preferences updated successfully',
      });
    } catch (error: any) {
      if (error.message === 'MFA token required') {
        return reply.status(403).send({
          error: 'MFA token required',
          message: 'Multi-factor authentication is enabled. Please provide a valid TOTP token.',
        });
      }

      if (error.message === 'Invalid MFA token') {
        return reply.status(403).send({
          error: 'Invalid MFA token',
          message: 'The provided TOTP token is invalid or expired.',
        });
      }

      return reply.status(500).send({
        error: 'Failed to update preferences',
        message: error.message,
      });
    }
  }

  /**
   * Get notification preferences
   */
  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const preferences = await notificationsService.getPreferences(request.user.id);
      return reply.send({
        success: true,
        preferences: preferences || {},
      });
    } catch (error: any) {
      return reply.status(500).send({
        error: 'Failed to get preferences',
        message: error.message,
      });
    }
  }
}

export const notificationsController = new NotificationsController();
