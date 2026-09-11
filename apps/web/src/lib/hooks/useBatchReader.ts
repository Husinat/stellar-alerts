/**
 * React hook for using the batched reader with session authentication.
 * 
 * Provides a pre-configured BatchReader instance that automatically
 * includes auth headers from the current session.
 */

import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { WalletAdapter } from '../adapters/wallet.adapter';
import { PaymentAdapter } from '../adapters/payment.adapter';
import { BatchReader } from '../batch/batch-reader';

const API_BASE_URL = 'http://localhost:3001';
const DEFAULT_CACHE_TTL_MS = 30000; // 30 seconds

export function useBatchReader(cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
  const { data: session } = useSession();

  const batchReader = useMemo(() => {
    const getAuthHeaders = () => {
      const headers: Record<string, string> = {};
      if (session && (session as any).accessToken) {
        headers['Authorization'] = `Bearer ${(session as any).accessToken}`;
      }
      return headers;
    };

    const config = {
      baseUrl: API_BASE_URL,
      getAuthHeaders,
    };

    const walletAdapter = new WalletAdapter(config);
    const paymentAdapter = new PaymentAdapter(config);

    return new BatchReader({
      walletAdapter,
      paymentAdapter,
      cacheTtlMs,
    });
  }, [session, cacheTtlMs]);

  return batchReader;
}
