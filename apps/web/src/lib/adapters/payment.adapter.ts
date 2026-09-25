/**
 * Payment Adapter
 * 
 * Handles individual payment-related API calls.
 * Each method represents a single RPC round-trip.
 */

import { PaymentDTO } from '@stellar-alerts/shared';
import { ApiAdapter } from './api.adapter';

export interface GetPaymentsResponse {
  success: boolean;
  payments: PaymentDTO[];
}

export interface GetPaymentsSummaryResponse {
  success: boolean;
  summary: {
    totalVolumeXLM: string | number;
    totalPayments: number;
  };
}

export interface GetPaymentsFilters {
  walletId?: string;
  asset?: string;
  memo?: string;
  dateFrom?: string | Date;
  dateTo?: string | Date;
  sortBy?: 'receivedAt' | 'amount' | 'asset';
  sortOrder?: 'asc' | 'desc';
}

export class PaymentAdapter extends ApiAdapter {
  /**
   * Backward compatible: a bare walletId string still works exactly as
   * before. Pass a filters object to also apply asset/memo/date/sort
   * filtering, which the API now evaluates server-side against indexed
   * columns (see backend/payments.service.ts) instead of over-fetching and
   * filtering client-side.
   */
  async getPayments(walletIdOrFilters?: string | GetPaymentsFilters): Promise<PaymentDTO[]> {
    const filters: GetPaymentsFilters =
      typeof walletIdOrFilters === 'string' ? { walletId: walletIdOrFilters } : walletIdOrFilters || {};

    const params = new URLSearchParams();
    if (filters.walletId) params.set('walletId', filters.walletId);
    if (filters.asset) params.set('asset', filters.asset);
    if (filters.memo) params.set('memo', filters.memo);
    if (filters.dateFrom) params.set('dateFrom', new Date(filters.dateFrom).toISOString());
    if (filters.dateTo) params.set('dateTo', new Date(filters.dateTo).toISOString());
    if (filters.sortBy) params.set('sortBy', filters.sortBy);
    if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

    const query = params.toString();
    const endpoint = query ? `/payments?${query}` : '/payments';
    const response = await this.get<GetPaymentsResponse>(endpoint);
    return response.payments;
  }

  async getPaymentsSummary(): Promise<{
    totalVolumeXLM: number;
    totalPayments: number;
  }> {
    const response = await this.get<GetPaymentsSummaryResponse>(
      '/payments/summary'
    );
    return {
      totalVolumeXLM: Number(response.summary.totalVolumeXLM || 0),
      totalPayments: Number(response.summary.totalPayments || 0),
    };
  }
}
