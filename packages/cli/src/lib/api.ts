import { WalletDTO, PaymentDTO, isValidStellarPublicKey } from './types.js';

const API_BASE_URL = process.env.STELLAR_ALERTS_API_URL || 'http://localhost:3001';

export class ApiClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = API_BASE_URL, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async getWallets(): Promise<WalletDTO[]> {
    const response = await fetch(`${this.baseUrl}/wallets`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch wallets: ${response.statusText}`);
    }
    return response.json();
  }

  async addWallet(publicKey: string, label?: string): Promise<WalletDTO> {
    if (!isValidStellarPublicKey(publicKey)) {
      throw new Error('Invalid Stellar public key. Must start with G and be 56 characters.');
    }

    const response = await fetch(`${this.baseUrl}/wallets`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ publicKey, label }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || 'Failed to add wallet');
    }

    return response.json();
  }

  async deleteWallet(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/wallets/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete wallet: ${response.statusText}`);
    }
  }

  async getPayments(walletId?: string, limit?: number): Promise<PaymentDTO[]> {
    const params = new URLSearchParams();
    if (walletId) params.append('walletId', walletId);
    if (limit) params.append('limit', limit.toString());

    const response = await fetch(`${this.baseUrl}/payments?${params}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch payments: ${response.statusText}`);
    }

    return response.json();
  }

  async streamPayments(
    onPayment: (payment: PaymentDTO) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/payments/stream`, {
      headers: this.getHeaders(),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to connect to payment stream: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const payment = JSON.parse(line);
          onPayment(payment);
        } catch {
          // Skip invalid JSON lines
        }
      }
    }
  }
}

export const apiClient = new ApiClient();
