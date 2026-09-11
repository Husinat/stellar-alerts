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

export class PaymentAdapter extends ApiAdapter {
  async getPayments(walletId?: string): Promise<PaymentDTO[]> {
    const endpoint = walletId
      ? `/payments?walletId=${encodeURIComponent(walletId)}`
      : '/payments';
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
