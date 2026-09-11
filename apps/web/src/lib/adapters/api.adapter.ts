/**
 * Base API Adapter
 * 
 * Provides low-level fetch utilities for making requests to the Stellar Alerts API.
 * This adapter handles authentication headers and basic error handling.
 */

export interface ApiConfig {
  baseUrl: string;
  getAuthHeaders: () => Record<string, string>;
}

export class ApiAdapter {
  constructor(private config: ApiConfig) {}

  protected async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.config.getAuthHeaders(),
      ...options?.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'API request returned unsuccessful response');
    }

    return data;
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.fetch<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.fetch<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.fetch<T>(endpoint, { method: 'DELETE' });
  }
}
