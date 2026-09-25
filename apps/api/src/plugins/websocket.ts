import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import { FastifyInstance } from 'fastify';
import { redis } from '../lib/redis';
import { verifyToken, UserPayload } from '../utils/jwt';
import { REALTIME_CHANNELS, RealtimeEnvelope } from '../lib/realtime';
import { ClientRegistry, WebSocketMessage } from '../lib/clientRegistry';

export type { WebSocketMessage } from '../lib/clientRegistry';

declare module 'fastify' {
  interface FastifyInstance {
    broadcastToUser: (userId: string, message: WebSocketMessage) => void;
  }
}

export default fp(async (server: FastifyInstance) => {
  // Register the websocket plugin for type augmentation
  await server.register(websocket);

  const registry = new ClientRegistry();

  // Create Redis subscriber for pub/sub
  const subscriber = redis.duplicate();

  try {
    await subscriber.connect();
    server.log.info('🔌 Redis subscriber connected for WebSocket');
  } catch (error) {
    server.log.warn({ err: error }, '⚠️ Redis subscriber connection failed, WebSocket will not work');
  }

  // Subscribe to persisted-event channels published by the watcher worker
  // (payments) and the webhook dispatcher (deliveries) — see lib/realtime.ts.
  const channels = [REALTIME_CHANNELS.PAYMENTS, REALTIME_CHANNELS.DELIVERIES];
  await subscriber.subscribe(...channels, (err) => {
    if (err) {
      server.log.error({ err }, '❌ Failed to subscribe to realtime channels');
    } else {
      server.log.info({ channels }, '📡 Subscribed to realtime channels');
    }
  });

  // Relay each Redis-published event only to the sockets belonging to the
  // user it names — this is the tenant-isolation boundary: routing is keyed
  // off the JWT-verified userId captured at connect time (registry), never
  // off anything the client sends.
  subscriber.on('message', (_channel, message) => {
    try {
      const envelope = JSON.parse(message) as RealtimeEnvelope;
      if (!envelope?.userId) return;

      registry.broadcastToUser(envelope.userId, {
        type: envelope.type,
        payload: envelope.payload,
        timestamp: envelope.timestamp,
      });
    } catch (error) {
      server.log.error({ err: error }, '❌ Error processing realtime message');
    }
  });

  server.decorate('broadcastToUser', (userId: string, message: WebSocketMessage) => {
    registry.broadcastToUser(userId, message);
  });

  // Register WebSocket upgrade endpoint
  server.get('/ws', { websocket: true } as any, (socket: any, request: any) => {
    clients.add(socket);
    server.log.info(`🔗 WebSocket client connected (total: ${clients.size})`);

    const entry = registry.register(user.id, socket);
    server.log.info(
      `🔗 WebSocket client connected for user ${user.id.substring(0, 8)}... (total for user: ${registry.clientCountForUser(user.id)})`,
    );

    registry.sendToEntry(entry, {
      type: 'connection',
      payload: { status: 'connected' },
      timestamp: new Date().toISOString(),
    });

    socket.on('message', (data: import('ws').RawData) => {
      try {
        const message = JSON.parse(data.toString());
        server.log.debug({ message }, '📩 Received WebSocket message');
      } catch (error: unknown) {
        server.log.warn({ err: error }, '⚠️ Invalid WebSocket message');
      }
    });

    socket.on('close', () => {
      registry.unregister(user.id, entry);
      server.log.info(`🔌 WebSocket client disconnected for user ${user.id.substring(0, 8)}...`);
    });

    socket.on('error', (error: Error) => {
      server.log.error({ err: error }, '❌ WebSocket error');
      registry.unregister(user.id, entry);
    });
  });

  // Cleanup on server close
  server.addHook('onClose', async () => {
    for (const entry of registry.getAllEntries()) {
      try {
        (entry.socket as unknown as import('ws').WebSocket).close();
      } catch {}
    }

    await subscriber.quit();
    server.log.info('🔌 WebSocket and Redis subscriber cleaned up');
  });
});
