import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import { FastifyInstance } from 'fastify';
import { redis } from '../lib/redis';
import { PaymentDTO } from '@stellar-alerts/shared';

export interface WebSocketMessage {
  type: 'payment' | 'wallet_update' | 'connection';
  payload: any;
  timestamp: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcast: (message: WebSocketMessage) => void;
    broadcastPayment: (payment: PaymentDTO) => void;
  }
}

// Store connected clients
const clients = new Set<any>();

// Redis pub/sub channels
const CHANNELS = {
  PAYMENTS: 'stellar-alerts:payments',
  WALLET_UPDATES: 'stellar-alerts:wallet-updates',
} as const;

export default fp(async (server: FastifyInstance) => {
  // Register the websocket plugin for type augmentation
  await server.register(websocket);
  // Create Redis subscriber for pub/sub
  const subscriber = redis.duplicate();

  try {
    await subscriber.connect();
    server.log.info('🔌 Redis subscriber connected for WebSocket');
  } catch (error) {
    server.log.warn({ err: error }, '⚠️ Redis subscriber connection failed, WebSocket will not work');
  }

  // Subscribe to payment events
  await subscriber.subscribe(CHANNELS.PAYMENTS, (err) => {
    if (err) {
      server.log.error({ err }, '❌ Failed to subscribe to payments channel');
    } else {
      server.log.info('📡 Subscribed to payments channel');
    }
  });

  // Handle incoming Redis messages
  subscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      
      // Broadcast to all connected WebSocket clients
      for (const client of clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(JSON.stringify(data));
        }
      }
    } catch (error) {
      server.log.error({ err: error }, '❌ Error processing Redis message');
    }
  });

  // Broadcast function for sending to all clients
  server.decorate('broadcast', (message: WebSocketMessage) => {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  });

  // Convenience function for broadcasting payments
  server.decorate('broadcastPayment', (payment: PaymentDTO) => {
    const message: WebSocketMessage = {
      type: 'payment',
      payload: payment,
      timestamp: new Date().toISOString(),
    };
    server.broadcast(message);
  });

  // Register WebSocket upgrade endpoint
  server.get('/ws', { websocket: true }, (socket: import('ws').WebSocket, request) => {
    clients.add(socket);
    server.log.info(`🔗 WebSocket client connected (total: ${clients.size})`);

    // Send welcome message
    const welcome: WebSocketMessage = {
      type: 'connection',
      payload: { status: 'connected', clients: clients.size },
      timestamp: new Date().toISOString(),
    };
    socket.send(JSON.stringify(welcome));

    // Handle incoming messages from client
    socket.on('message', (data: import('ws').RawData) => {
      try {
        const message = JSON.parse(data.toString());
        server.log.debug({ message }, '📩 Received WebSocket message');

        // Handle subscription requests
        if (message.type === 'subscribe') {
          // Client can subscribe to specific wallets
          server.log.info(`📡 Client subscribed to: ${message.payload}`);
        }
      } catch (error: unknown) {
        server.log.warn({ err: error }, '⚠️ Invalid WebSocket message');
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      clients.delete(socket);
      server.log.info(`🔌 WebSocket client disconnected (total: ${clients.size})`);
    });

    // Handle errors
    socket.on('error', (error: Error) => {
      server.log.error({ err: error }, '❌ WebSocket error');
      clients.delete(socket);
    });
  });

  // Cleanup on server close
  server.addHook('onClose', async () => {
    // Close all client connections
    for (const client of clients) {
      client.close();
    }
    clients.clear();

    // Disconnect Redis subscriber
    await subscriber.quit();
    server.log.info('🔌 WebSocket and Redis subscriber cleaned up');
  });
});
