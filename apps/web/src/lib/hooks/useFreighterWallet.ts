'use client';

import { useCallback, useState } from 'react';
import { connectFreighter, FreighterConnectError } from '@/lib/wallet/freighter';
import { fetchAccountBalances, WalletBalance } from '@/lib/wallet/balances';

export type FreighterConnectionState = 'idle' | 'connecting' | 'connected' | 'error';

export interface UseFreighterWalletResult {
  connectionState: FreighterConnectionState;
  publicKey: string | null;
  network: string | null;
  balances: WalletBalance[];
  isFunded: boolean;
  errorMessage: string | null;
  connect: () => Promise<string | null>;
  reset: () => void;
}

const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  NOT_INSTALLED: 'Freighter extension not detected. Install it from freighter.app and try again.',
  REJECTED: 'Connection request was declined in Freighter.',
  MALFORMED_ADDRESS: 'Freighter returned an address that could not be validated. Please try again.',
  UNKNOWN: 'Could not connect to Freighter. Please try again.',
};

export function useFreighterWallet(): UseFreighterWalletResult {
  const [connectionState, setConnectionState] = useState<FreighterConnectionState>('idle');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isFunded, setIsFunded] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setConnectionState('idle');
    setPublicKey(null);
    setNetwork(null);
    setBalances([]);
    setIsFunded(true);
    setErrorMessage(null);
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    setConnectionState('connecting');
    setErrorMessage(null);

    try {
      const result = await connectFreighter();
      setPublicKey(result.publicKey);
      setNetwork(result.network ?? null);
      setConnectionState('connected');

      try {
        const { balances: fetchedBalances, isFunded: funded } = await fetchAccountBalances(
          result.publicKey
        );
        setBalances(fetchedBalances);
        setIsFunded(funded);
      } catch {
        // Balance lookup is best-effort; the connection itself already succeeded.
        setBalances([]);
        setIsFunded(true);
      }

      return result.publicKey;
    } catch (err) {
      const code = err instanceof FreighterConnectError ? err.code : 'UNKNOWN';
      setConnectionState('error');
      setErrorMessage(FRIENDLY_ERROR_MESSAGES[code] || FRIENDLY_ERROR_MESSAGES.UNKNOWN);
      return null;
    }
  }, []);

  return { connectionState, publicKey, network, balances, isFunded, errorMessage, connect, reset };
}
