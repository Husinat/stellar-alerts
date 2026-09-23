'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PaymentDTO } from '@stellar-alerts/shared';
import {
  PaymentTable,
  WebhookSandbox,
  SorobanSimulationSandbox,
} from '@/components/dashboard';
import { DeadLettersInspector } from '@/components/dashboard/DeadLettersInspector';
import { useBatchReader } from '@/lib/hooks/useBatchReader';

export default function InspectorsPage() {
  const { data: session } = useSession();
  const batchReader = useBatchReader();
  const [payments, setPayments] = useState<PaymentDTO[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPayments = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const data = await batchReader.fetchUserPortfolioBatched(selectedWalletId || undefined);
      setPayments(data.payments);
    } catch (err) {
      console.error('Failed to fetch payments:', err);
    } finally {
      setIsLoading(false);
    }
  }, [session, selectedWalletId, batchReader]);

  useEffect(() => {
    if (session) void fetchPayments();
  }, [session, selectedWalletId, fetchPayments]);

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Inspectors & Delivery Debugging</h1>
        <p className="text-gray-400 text-sm mt-1 max-w-xl">
          Audit payment history and inspect terminal notification failures with replay &amp; suppression controls.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-bold text-white">Payment Ledger</h2>
        <PaymentTable payments={payments} isLoading={isLoading} />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Dead Letter Queue</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Terminal notification failures — replay idempotently, suppress, or audit history (#273).
            </p>
          </div>
        </div>
        <DeadLettersInspector />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">Webhook Sandbox</h2>
          <p className="text-xs text-gray-400 mt-0.5">Preview and test webhook payload delivery behavior.</p>
        </div>
        <WebhookSandbox />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">Soroban Simulation Sandbox</h2>
          <p className="text-xs text-gray-400 mt-0.5">Simulate Soroban contract behavior against your watched wallets.</p>
        </div>
        <SorobanSimulationSandbox />
      </section>
    </div>
  );
}