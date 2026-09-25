'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { WalletDTO } from '@stellar-alerts/shared';
import { WatcherForm } from '@/components/WatcherForm';
import { WalletList } from '@/components/dashboard';
import { useBatchReader } from '@/lib/hooks/useBatchReader';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function OnboardingPage() {
  const { data: session } = useSession();
  const batchReader = useBatchReader();
  const [wallets, setWallets] = useState<WalletDTO[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    if (!session) return;
    try {
      const data = await batchReader.fetchUserPortfolioBatched(undefined);
      setWallets(data.wallets);
      setSelectedWalletId((current) => current ?? data.wallets[0]?.id ?? null);
    } catch (err) {
      console.error('Failed to fetch wallets:', err);
    }
  }, [session, batchReader]);

  useEffect(() => {
    if (session) void fetchWallets();
  }, [session, fetchWallets]);

  const handleRemoveWallet = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/wallets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : '' },
      });
      if (res.ok) {
        if (selectedWalletId === id) setSelectedWalletId(null);
        batchReader.invalidateAll();
        void fetchWallets();
      }
    } catch (err) {
      console.error('Failed to remove wallet:', err);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold mb-3">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Setup Guide
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Connect Your First Wallet</h1>
        <p className="text-gray-400 text-sm mt-1 max-w-xl">
          Add a watch-only Stellar public key (<code className="text-cyan-300 font-mono">G...</code>). Alerts and ledger ingestion begin immediately.
        </p>
      </div>

      {/* Quick steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { step: '1', title: 'Add Public Wallet', body: 'Paste any Stellar public key. Keys are never touched.' },
          { step: '2', title: 'Watcher Ingestion', body: 'Our worker streams Horizon ledger operations for your address.' },
          { step: '3', title: 'Get Alerts', body: 'Telegram, email, or webhooks for every incoming payment.' },
        ].map((s) => (
          <div key={s.step} className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-2">
            <span className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 font-extrabold text-xs flex items-center justify-center border border-cyan-500/30">{s.step}</span>
            <h3 className="text-sm font-bold text-white">{s.title}</h3>
            <p className="text-xs text-gray-400 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-4 bg-[#0c0c14]/80 backdrop-blur-md rounded-3xl border border-white/10 p-7 shadow-2xl hover:border-cyan-500/30 transition-all duration-500">
          <h2 className="text-lg font-bold text-white mb-4">Add a Wallet</h2>
          <WatcherForm
            onWalletAdded={() => {
              batchReader.invalidateAll();
              void fetchWallets();
            }}
          />
        </div>
        <div className="lg:col-span-8">
          <WalletList
            wallets={wallets}
            selectedWalletId={selectedWalletId}
            onSelectWallet={(id) => setSelectedWalletId(id)}
            onRemoveWallet={handleRemoveWallet}
            onOpenAddModal={() => {
              const el = document.getElementById('add-wallet-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        </div>
      </div>
    </div>
  );
}