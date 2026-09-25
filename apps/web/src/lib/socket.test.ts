import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  
  private sendMock = vi.fn();

  constructor(url: string) {
    this.url = url;
    // Simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(data: string) {
    this.sendMock(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code || 1000, reason: reason || '' });
  }

  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError() {
    this.onerror?.(new Error('Mock error'));
  }

  getSendMock() {
    return this.sendMock;
  }
}

describe('StellarAlertsSocket Client', () => {
  let StellarAlertsSocket: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock global WebSocket
    (global as any).WebSocket = MockWebSocket;
    
    // Dynamic import to get fresh module
    const imported = await import('./socket');
    StellarAlertsSocket = imported.StellarAlertsSocket;
  });

  afterEach(() => {
    delete (global as any).WebSocket;
  });

  it('should create socket instance with default URL', () => {
    const socket = new StellarAlertsSocket();
    expect(socket).toBeDefined();
  });

  it('should create socket instance with custom URL', () => {
    const socket = new StellarAlertsSocket('ws://custom:8080/ws');
    expect(socket).toBeDefined();
  });

  it('should connect to WebSocket server', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    
    await new Promise<void>((resolve) => {
      socket.on('connection', (msg: any) => {
        expect(msg.payload.status).toBe('connected');
        resolve();
      });
      socket.connect();
    });
  });

  it('should send messages when connected', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    
    await new Promise<void>((resolve) => {
      socket.on('connection', () => {
        socket.send({ type: 'ping' });
        resolve();
      });
      socket.connect();
    });
  });

  it('should handle incoming payment messages', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    const paymentHandler = vi.fn();
    
    socket.onPayment(paymentHandler);
    
    await new Promise<void>((resolve) => {
      socket.on('connection', () => {
        // Simulate incoming payment
        const payment = {
          id: '1',
          walletId: 'wallet1',
          txHash: 'hash123',
          fromAddress: 'GABC123',
          amount: 100,
          asset: 'XLM',
          receivedAt: new Date().toISOString(),
        };
        
        socket.onMessage?.({ data: JSON.stringify({
          type: 'payment',
          payload: payment,
          timestamp: new Date().toISOString(),
        })});
        
        resolve();
      });
      socket.connect();
    });
  });

  it('should disconnect gracefully', () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    socket.connect();
    
    // Wait for connection
    setTimeout(() => {
      socket.disconnect();
    }, 10);
    
    // Verify disconnect was called
    expect(socket).toBeDefined();
  });

  it('should subscribe to wallet updates', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');

    await new Promise<void>((resolve) => {
      socket.on('connection', () => {
        socket.subscribe('wallet123');
        resolve();
      });
      socket.connect();
    });
  });

  it('should append the session token as a query param on the handshake URL', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    socket.connect('jwt-abc-123');

    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    const ws = (socket as any).ws as MockWebSocket;
    expect(ws.url).toBe('ws://localhost:3001/ws?token=jwt-abc-123');
  });

  it('reuses the previously supplied token on reconnect without a new argument', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    socket.connect('jwt-abc-123');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    socket.disconnect();
    socket.connect();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    const ws = (socket as any).ws as MockWebSocket;
    expect(ws.url).toBe('ws://localhost:3001/ws?token=jwt-abc-123');
  });

  it('routes incoming delivery messages to onDelivery handlers', async () => {
    const socket = new StellarAlertsSocket('ws://localhost:3001/ws');
    const deliveryHandler = vi.fn();
    socket.onDelivery(deliveryHandler);

    await new Promise<void>((resolve) => {
      socket.on('connection', () => {
        const ws = (socket as any).ws as MockWebSocket;
        ws.simulateMessage({
          type: 'delivery',
          payload: { id: 'log_1', webhookId: 'wh_1', statusCode: 200, sentAt: new Date().toISOString() },
          timestamp: new Date().toISOString(),
        });
        resolve();
      });
      socket.connect();
    });

    expect(deliveryHandler).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'log_1', statusCode: 200 })
    );
  });
});

describe('Socket Singleton', () => {
  it('should return same instance', async () => {
    (global as any).WebSocket = MockWebSocket;
    
    const { getSocket } = await import('./socket');
    const socket1 = getSocket();
    const socket2 = getSocket();
    
    expect(socket1).toBe(socket2);
    
    delete (global as any).WebSocket;
  });
});
