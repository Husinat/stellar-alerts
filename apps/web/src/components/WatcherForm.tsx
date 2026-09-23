'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useFreighterWallet } from '@/lib/hooks/useFreighterWallet';
import { looksLikeStellarPublicKey, truncateAddress } from '@/lib/wallet/strkey';

export function WatcherForm({ onWalletAdded }: { onWalletAdded?: () => void }) {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const { data: session } = useSession();
  const freighter = useFreighterWallet();

  const addressLooksValid = address.trim().length === 0 || looksLikeStellarPublicKey(address);

  const handleConnectFreighter = async () => {
    setStatus(null);
    const publicKey = await freighter.connect();
    if (publicKey) {
      setAddress(publicKey);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!looksLikeStellarPublicKey(address)) {
      setStatus('Error: Not a valid Stellar public key (must be 56 characters, starting with G).');
      return;
    }

    setStatus('Submitting...');

    const accessToken = (session as (typeof session & { accessToken?: string }) | null)?.accessToken;
    if (!accessToken) {
      setStatus('Error: You must be logged in.');
      return;
    }

    try {
      const res = await fetch('http://localhost:3001/wallets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ publicKey: address, label: 'Watched Wallet' })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatus('Successfully submitted!');
        setAddress('');
        freighter.reset();
        if (onWalletAdded) onWalletAdded();
      } else {
        setStatus(`Error: ${data.error || 'Failed to submit'}`);
      }
    } catch (e) {
      console.error(e);
      setStatus('Network error occurred.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border p-6 rounded shadow-md max-w-md mt-6">
      <h2 className="text-xl font-bold">Add Stellar Watcher</h2>

      <button
        type="button"
        onClick={handleConnectFreighter}
        disabled={freighter.connectionState === 'connecting'}
        data-testid="connect-freighter-button"
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded flex items-center justify-center gap-2"
      >
        {freighter.connectionState === 'connecting' ? 'Connecting...' : '🔗 Connect Freighter Wallet'}
      </button>

      {freighter.connectionState === 'connected' && freighter.publicKey && (
        <div
          data-testid="freighter-connection-status"
          className="text-xs rounded border border-green-600/40 bg-green-600/10 p-3 space-y-1"
        >
          <p className="font-semibold text-green-500">Connected: {truncateAddress(freighter.publicKey)}</p>
          {freighter.network && <p className="text-gray-500 dark:text-gray-400">Network: {freighter.network}</p>}
          {freighter.isFunded ? (
            freighter.balances.length > 0 ? (
              <ul className="text-gray-600 dark:text-gray-300">
                {freighter.balances.map((b) => (
                  <li key={`${b.assetCode}-${b.assetIssuer ?? 'native'}`}>
                    {b.balance} {b.assetCode}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No balances detected.</p>
            )
          ) : (
            <p className="text-amber-500">Account not yet funded on this network.</p>
          )}
        </div>
      )}

      {freighter.connectionState === 'error' && freighter.errorMessage && (
        <p data-testid="freighter-error" className="text-xs text-red-500">
          {freighter.errorMessage}
        </p>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex-1 border-t border-gray-300 dark:border-gray-700" />
        or enter manually
        <span className="flex-1 border-t border-gray-300 dark:border-gray-700" />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="address" className="text-sm font-semibold">
          Stellar Public Key
        </label>
        <input
          id="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="G..."
          className={`border p-2 rounded text-black ${!addressLooksValid ? 'border-red-500' : ''}`}
          required
        />
        {!addressLooksValid && (
          <p className="text-xs text-red-500">
            Must be 56 characters, starting with &quot;G&quot;.
          </p>
        )}
      </div>

      <button
        type="submit"
        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded w-full"
      >
        Watch Address
      </button>

      {status && <p className="text-sm mt-2 text-gray-600 dark:text-gray-300">{status}</p>}
    </form>
  );
}
