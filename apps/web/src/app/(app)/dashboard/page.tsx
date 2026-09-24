'use client';

import { useCallback, useEffect, useState } from 'react';
import NetworkVisualizer3D from '@/components/dashboard/NetworkVisualizer3D';
import AuditWorkspace from '@/components/dashboard/AuditWorkspace';
import { useSession } from 'next-auth/react';
import { WalletDTO, PaymentDTO } from '@stellar-alerts/shared';
import { WatcherForm } from '@/components/WatcherForm';
import {
  DashboardGrid,
  SummaryStats,
  VolumeChart,
  WebhookSandbox,
  WalletList,
  PaymentTable,
  ActivityHeatmap,
  EmailTemplatePreview,
  type EmailTemplateConfig,
} from '@/components/dashboard';
import { useBatchReader } from '@/lib/hooks/useBatchReader';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export default function DashboardPage() {
  const { data: session } = useSession();
  const batchReader = useBatchReader();

  const [wallets, setWallets] = useState<WalletDTO[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentDTO[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState<boolean>(false);
  const [totalVolumeXLM, setTotalVolumeXLM] = useState<number>(0);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState<number>(0);
  const [crossLedgerAnalytics] = useState<any>(null);

  const fetchDashboardData = useCallback(async () => {
    if (!session) return;
    setIsLoadingPayments(true);
    try {
      const data = await batchReader.fetchUserPortfolioBatched(selectedWalletId || undefined);
      setWallets(data.wallets);
      setPayments(data.payments);
      setTotalVolumeXLM(Number(data.summary.totalVolumeXLM || 0));
      setTotalPaymentsCount(Number(data.summary.totalPayments || 0));
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setIsLoadingPayments(false);
    }
  }, [session, selectedWalletId, batchReader]);

  useEffect(() => {
    if (session) void fetchDashboardData();
  }, [session, selectedWalletId, fetchDashboardData]);

  const refreshAfterMutation = useCallback(() => {
    batchReader.invalidateAll();
    void fetchDashboardData();
  }, [batchReader, fetchDashboardData]);

  const handleRemoveWallet = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/wallets/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : '',
        },
      });
      if (res.ok) {
        if (selectedWalletId === id) setSelectedWalletId(null);
        refreshAfterMutation();
      }
    } catch (err) {
      console.error('Failed to remove wallet:', err);
    }
  };

  const handleSaveEmailTemplate = async (template: EmailTemplateConfig) => {
    try {
      await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : '',
        },
        body: JSON.stringify({ emailTemplate: template }),
      });
    } catch (err) {
      console.error('Failed to save email template preferences:', err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="p-8 rounded-3xl bg-gradient-to-r from-cyan-950/40 via-blue-950/30 to-purple-950/20 border border-cyan-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            Watcher Service Active
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Your Real-Time Wallet Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1 max-w-xl">
            Monitor connected Stellar Testnet addresses, track live incoming transactions, and export recorded payment history.
          </p>
        </div>
      </div>

      {/* Customizable Dashboard Grid */}
      <DashboardGrid
        items={[
          {
            id: 'summary',
            label: 'Summary Overview',
            content: (
              <SummaryStats
                totalPaymentsCount={totalPaymentsCount || payments.length}
                totalVolumeXLM={totalVolumeXLM || payments.reduce((acc, p) => acc + Number(p.amount || 0), 0)}
                activeWalletsCount={wallets.length}
                crossLedgerAnalytics={crossLedgerAnalytics}
              />
            ),
          },
          {
            id: 'volume-chart',
            label: 'Currency Volume',
            content: (
              <VolumeChart
                payments={payments}
                totalVolumeXLM={totalVolumeXLM || payments.reduce((acc, p) => acc + Number(p.amount || 0), 0)}
              />
            ),
          },
          {
            id: 'activity-heatmap',
            label: 'Activity Heatmap',
            content: <ActivityHeatmap payments={payments} />,
          },
          {
            id: 'email-template-preview',
            label: 'Email Receipt Template',
            content: <EmailTemplatePreview onSaveTemplate={handleSaveEmailTemplate} />,
          },
          {
            id: 'webhook-sandbox',
            label: 'Webhook Sandbox',
            content: <WebhookSandbox />,
          },
          {
            id: 'wallets',
            label: 'Monitored Wallets',
            content: (
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
            ),
          },
          {
            id: 'watcher-and-payments',
            label: 'Watcher & Payment Ledger',
            content: (
              <div id="add-wallet-section" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-4 bg-[#0c0c14]/80 backdrop-blur-md rounded-3xl border border-white/10 p-7 shadow-2xl hover:border-cyan-500/30 transition-all duration-500">
                  <WatcherForm onWalletAdded={refreshAfterMutation} />
                </div>
                <div className="lg:col-span-8">
                  <PaymentTable payments={payments} isLoading={isLoadingPayments} />
                </div>
              </div>
            ),
          },
          {
            id: 'network-visualizer',
            label: 'Live Payment Stream Network',
            content: <NetworkVisualizer3D payments={payments} />,
          },
          {
            id: 'audit-workspace',
            label: 'Collaborative Audit Workspace',
            content: (
              <AuditWorkspace
                payments={payments}
                currentUser={{
                  id: session?.user?.id || session?.user?.email || 'anonymous',
                  name: session?.user?.name || session?.user?.email || 'Auditor',
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}