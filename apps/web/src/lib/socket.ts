import { PaymentDTO } from '@stellar-alerts/shared';

export interface WebSocketMessage {
  type: 'payment' | 'wallet_update' | 'connection';
  payload: any;
  timestamp: string;
}

export type MessageHandler = (message: WebSocketMessage) => void;
export type PaymentHandler = (payment: PaymentDTO) => void;

export class StellarAlertsSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private paymentHandlers: Set<PaymentHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;

  constructor(url?: string) {
    this.url = url || this.getDefaultUrl();
  }

  private getDefaultUrl(): string {
    if (typeof window === 'undefined') {
      return 'ws://localhost:3001/ws';
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = process.env.NEXT_PUBLIC_API_URL || window.location.host;
    return `${protocol}//${host}/ws`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('🔗 WebSocket connected');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.emit('connection', { status: 'connected' });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        this.isConnecting = false;
        this.emit('connection', { status: 'disconnected', code: event.code });

        // Auto-reconnect with exponential backoff
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
          
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
          }, delay);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.isConnecting = false;
    }
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  private handleMessage(message: WebSocketMessage): void {
    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(message.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(message);
      }
    }

    // Notify payment-specific handlers
    if (message.type === 'payment') {
      for (const handler of this.paymentHandlers) {
        handler(message.payload as PaymentDTO);
      }
    }

    // Notify all-message handlers
    const allHandlers = this.handlers.get('*');
    if (allHandlers) {
      for (const handler of allHandlers) {
        handler(message);
      }
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onPayment(handler: PaymentHandler): () => void {
    this.paymentHandlers.add(handler);
    return () => {
      this.paymentHandlers.delete(handler);
    };
  }

  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  }

  subscribe(walletId: string): void {
    this.send({
      type: 'subscribe',
      payload: walletId,
    });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private emit(type: string, payload: any): void {
    const message: WebSocketMessage = {
      type: type as any,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.handleMessage(message);
  }
}

// Singleton instance
let instance: StellarAlertsSocket | null = null;

export function getSocket(): StellarAlertsSocket {
  if (!instance) {
    instance = new StellarAlertsSocket();
  }
  return instance;
}

export function connectSocket(): StellarAlertsSocket {
  const socket = getSocket();
  socket.connect();
  return socket;
}
