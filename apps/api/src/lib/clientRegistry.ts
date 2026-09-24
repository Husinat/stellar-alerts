/**
 * Tracks WebSocket clients per authenticated user and delivers messages
 * only within that user's own connections (tenant isolation), with a
 * bounded per-client outbound queue so a slow/reconnecting consumer can't
 * grow memory without limit while still receiving events in order.
 */
export interface RegistrySocket {
  readyState: number;
  send: (data: string) => void;
}

export type RealtimeMessageType = 'payment' | 'wallet_update' | 'connection' | 'delivery';

export interface WebSocketMessage {
  type: RealtimeMessageType;
  payload: any;
  timestamp: string;
}

const SOCKET_OPEN = 1;

export const DEFAULT_MAX_QUEUE_SIZE = 50;

export interface ClientEntry {
  socket: RegistrySocket;
  queue: WebSocketMessage[];
}

export class ClientRegistry {
  private clientsByUser = new Map<string, Set<ClientEntry>>();

  constructor(private readonly maxQueueSize: number = DEFAULT_MAX_QUEUE_SIZE) {}

  register(userId: string, socket: RegistrySocket): ClientEntry {
    const entry: ClientEntry = { socket, queue: [] };
    if (!this.clientsByUser.has(userId)) {
      this.clientsByUser.set(userId, new Set());
    }
    this.clientsByUser.get(userId)!.add(entry);
    return entry;
  }

  unregister(userId: string, entry: ClientEntry): void {
    const entries = this.clientsByUser.get(userId);
    if (!entries) return;
    entries.delete(entry);
    if (entries.size === 0) {
      this.clientsByUser.delete(userId);
    }
  }

  /** Queues a message for one client and flushes, dropping the oldest queued
   * message if the bound is exceeded so delivery stays order-preserving for
   * whatever remains rather than growing without limit. */
  sendToEntry(entry: ClientEntry, message: WebSocketMessage): void {
    entry.queue.push(message);
    if (entry.queue.length > this.maxQueueSize) {
      entry.queue.shift();
    }
    this.flush(entry);
  }

  /** Re-attempts delivery of anything still queued for an entry; call after
   * a socket transitions to OPEN (e.g. once auth/upgrade completes). */
  flush(entry: ClientEntry): void {
    if (entry.socket.readyState !== SOCKET_OPEN) return;
    while (entry.queue.length > 0) {
      const next = entry.queue[0];
      try {
        entry.socket.send(JSON.stringify(next));
        entry.queue.shift();
      } catch {
        // Leave the remaining queue intact; a later flush() will retry.
        break;
      }
    }
  }

  broadcastToUser(userId: string, message: WebSocketMessage): void {
    const entries = this.clientsByUser.get(userId);
    if (!entries) return;
    for (const entry of entries) {
      this.sendToEntry(entry, message);
    }
  }

  clientCountForUser(userId: string): number {
    return this.clientsByUser.get(userId)?.size ?? 0;
  }

  connectedUserIds(): string[] {
    return Array.from(this.clientsByUser.keys());
  }

  getAllEntries(): ClientEntry[] {
    return Array.from(this.clientsByUser.values()).flatMap((set) => Array.from(set));
  }
}
