import { describe, it, expect, vi } from 'vitest';
import { ClientRegistry, RegistrySocket, WebSocketMessage } from '../clientRegistry';

function makeSocket(readyState = 1): RegistrySocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    readyState,
    sent,
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
  };
}

function msg(type: WebSocketMessage['type'], payload: any): WebSocketMessage {
  return { type, payload, timestamp: new Date().toISOString() };
}

describe('ClientRegistry', () => {
  it('delivers a message only to the target user, not other connected users (tenant isolation)', () => {
    const registry = new ClientRegistry();
    const socketA = makeSocket();
    const socketB = makeSocket();
    registry.register('user-a', socketA);
    registry.register('user-b', socketB);

    registry.broadcastToUser('user-a', msg('payment', { id: 'p1' }));

    expect(socketA.sent).toHaveLength(1);
    expect(socketB.sent).toHaveLength(0);
  });

  it('fans a message out to every connection the same user has open', () => {
    const registry = new ClientRegistry();
    const socket1 = makeSocket();
    const socket2 = makeSocket();
    registry.register('user-a', socket1);
    registry.register('user-a', socket2);

    registry.broadcastToUser('user-a', msg('payment', { id: 'p1' }));

    expect(socket1.sent).toHaveLength(1);
    expect(socket2.sent).toHaveLength(1);
  });

  it('is a no-op when the target user has no connected clients', () => {
    const registry = new ClientRegistry();
    expect(() => registry.broadcastToUser('nobody', msg('payment', {}))).not.toThrow();
  });

  it('preserves message order for a connected client', () => {
    const registry = new ClientRegistry();
    const socket = makeSocket();
    registry.register('user-a', socket);

    registry.broadcastToUser('user-a', msg('payment', { seq: 1 }));
    registry.broadcastToUser('user-a', msg('payment', { seq: 2 }));
    registry.broadcastToUser('user-a', msg('payment', { seq: 3 }));

    const received = socket.sent.map((raw) => JSON.parse(raw).payload.seq);
    expect(received).toEqual([1, 2, 3]);
  });

  it('bounds the per-client queue, dropping the oldest message once the limit is exceeded', () => {
    const registry = new ClientRegistry(3);
    // readyState 0 = CONNECTING, so nothing flushes yet — everything queues.
    const socket = makeSocket(0);
    const entry = registry.register('user-a', socket);

    for (let i = 1; i <= 5; i++) {
      registry.broadcastToUser('user-a', msg('payment', { seq: i }));
    }

    expect(entry.queue.map((m) => m.payload.seq)).toEqual([3, 4, 5]);
  });

  it('flushes queued messages in order once the socket transitions to open', () => {
    const registry = new ClientRegistry();
    const socket = makeSocket(0); // CONNECTING
    const entry = registry.register('user-a', socket);

    registry.broadcastToUser('user-a', msg('payment', { seq: 1 }));
    registry.broadcastToUser('user-a', msg('payment', { seq: 2 }));
    expect(socket.sent).toHaveLength(0);

    socket.readyState = 1; // OPEN
    registry.flush(entry);

    const received = socket.sent.map((raw) => JSON.parse(raw).payload.seq);
    expect(received).toEqual([1, 2]);
  });

  it('stops removing a user entirely once their last connection unregisters', () => {
    const registry = new ClientRegistry();
    const socket = makeSocket();
    const entry = registry.register('user-a', socket);
    expect(registry.connectedUserIds()).toContain('user-a');

    registry.unregister('user-a', entry);
    expect(registry.connectedUserIds()).not.toContain('user-a');
    expect(registry.clientCountForUser('user-a')).toBe(0);
  });

  it('does not throw when a client-side send() fails, and leaves the message queued for retry', () => {
    const registry = new ClientRegistry();
    const socket = makeSocket();
    socket.send = vi.fn(() => {
      throw new Error('socket write failed');
    });
    const entry = registry.register('user-a', socket);

    expect(() => registry.broadcastToUser('user-a', msg('payment', { seq: 1 }))).not.toThrow();
    expect(entry.queue).toHaveLength(1);
  });
});
