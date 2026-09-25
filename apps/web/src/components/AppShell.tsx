'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { CommandPalette } from '@/components/CommandPalette';
import { NotificationModal } from '@/components/dashboard';
import { OnboardingWizard } from '@/components/onboarding';
import { WalletAdapter } from '@/lib/adapters/wallet.adapter';
import { NotificationsAdapter } from '@/lib/adapters/notifications.adapter';
import { useBatchReader } from '@/lib/hooks/useBatchReader';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', match: '/dashboard' },
  { href: '/inspectors', label: 'Inspectors', match: '/inspectors' },
  { href: '/api-hub', label: 'API Hub', match: '/api-hub' },
  { href: '/onboarding', label: 'Onboarding', match: '/onboarding' },
  { href: '/settings', label: 'Settings', match: '/settings' },
  { href: '/docs', label: 'Docs', match: '/docs' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const getHeaders = useSessionHeaders();
  const batchReader = useBatchReader();

  const handleSavePreferences = async (prefs: { telegramChatId?: string; emailEnabled: boolean }) => {
    try {
      await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify(prefs),
      });
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
    }
  };

  // Adapters for the onboarding wizard: each step throws on failure so the
  // wizard can show an inline, retryable error instead of silently advancing.
  const walletAdapter = useMemo(
    () => new WalletAdapter({ baseUrl: API_BASE_URL, getAuthHeaders: getHeaders }),
    [getHeaders],
  );
  const notificationsAdapter = useMemo(
    () => new NotificationsAdapter({ baseUrl: API_BASE_URL, getAuthHeaders: getHeaders }),
    [getHeaders],
  );

  const handleOnboardingConnectWallet = async (publicKey: string) => {
    await walletAdapter.createWallet({ publicKey, label: 'Watched Wallet' });
    batchReader.invalidateAll();
  };

  const handleOnboardingLinkTelegram = async (chatId: string) => {
    await notificationsAdapter.updatePreferences({ telegramChatId: chatId, telegramEnabled: true });
  };

  const handleOnboardingTestPing = async () => {
    return notificationsAdapter.sendTestPing('telegram');
  };

  const handleOnboardingSavePreferences = async (prefs: { emailEnabled: boolean; telegramEnabled: boolean }) => {
    await notificationsAdapter.updatePreferences(prefs);
  };

  const handleOnboardingActivate = () => {
    batchReader.invalidateAll();
  };

  return (
    <div className="min-h-screen bg-[#050508] text-gray-100 font-sans selection:bg-cyan-500/30 overflow-x-hidden relative">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-cyan-900/15 blur-[160px] mix-blend-screen"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-blue-900/15 blur-[160px] mix-blend-screen"></div>
      </div>

      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 bg-[#07070c]/70 backdrop-blur-xl border-b border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.3)]">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 group cursor-pointer">
            <Link href="/dashboard" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-[0_0_25px_rgba(6,182,212,0.4)] group-hover:scale-105 transition-transform duration-300">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-100 to-gray-400">
                Stellar<span className="text-cyan-400">Alerts</span>
              </span>
            </Link>

            <nav className="hidden lg:flex items-center gap-1 ml-6">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3.5 py-2 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                    pathname?.startsWith(item.match)
                      ? 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                  data-testid={`nav-${item.match.slice(1)}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Search commands (?K)"
              className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-300 flex items-center gap-2 transition-colors cursor-pointer hover:border-cyan-500/40"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-gray-400">
                ?K
              </kbd>
            </button>
            <button
              onClick={() => setIsNotificationModalOpen(true)}
              className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-gray-300 flex items-center gap-2 transition-colors cursor-pointer hover:border-cyan-500/40"
            >
              <span className="text-sm leading-none">🔔</span> Alert Settings
            </button>
            <button
              onClick={() => setIsOnboardingOpen(true)}
              className="px-4 py-2 rounded-full bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-xs font-semibold text-purple-200 flex items-center gap-2 transition-colors cursor-pointer"
            >
              <span>🚀</span> Get Started
            </button>
            <div className="hidden sm:flex flex-col items-end">
              <p className="font-semibold text-sm text-gray-200">{session?.user?.name || 'Explorer'}</p>
              <p className="text-xs text-cyan-400/80 font-mono">{session?.user?.email}</p>
            </div>
            <button
              onClick={() => void signOut({ callbackUrl: '/' })}
              className="group relative px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-red-500/50 transition-all duration-300 overflow-hidden cursor-pointer"
            >
              <span className="relative z-10 text-sm font-medium text-gray-300 group-hover:text-red-400 transition-colors">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-10 space-y-8">
        {children}
      </main>

      <NotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        onSavePreferences={handleSavePreferences}
      />

      {/* Three-step onboarding wizard: wallet connection → Telegram linking → notification preferences */}
      {isOnboardingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <OnboardingWizard
            isOpen={isOnboardingOpen}
            onClose={() => setIsOnboardingOpen(false)}
            onConnectWallet={handleOnboardingConnectWallet}
            onLinkTelegram={handleOnboardingLinkTelegram}
            onSendTestPing={handleOnboardingTestPing}
            onSavePreferences={handleOnboardingSavePreferences}
            onActivate={handleOnboardingActivate}
          />
        </div>
      )}

      <CommandPalette
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
        groups={[
          {
            id: 'navigation',
            label: 'Navigation',
            items: NAV_ITEMS.map((item) => ({
              id: `nav-${item.match.slice(1)}`,
              label: item.label,
              keywords: [item.label.toLowerCase(), item.match],
              icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10l5 3 8-6 5 2V6l-5-2-8 6-5-2z" />
                </svg>
              ),
              onSelect: () => router.push(item.href),
            })),
          },
          {
            id: 'account',
            label: 'Account',
            items: [
              {
                id: 'sign-out',
                label: 'Sign out',
                keywords: ['logout', 'exit', 'session'],
                icon: (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                ),
                onSelect: () => void signOut({ callbackUrl: '/' }),
              },
            ],
          },
        ]}
      />
    </div>
  );
}

/** Memoized auth header builder sourced from the NextAuth session. */
function useSessionHeaders() {
  const { data: session } = useSession();
  return () => {
    const headers: Record<string, string> = {};
    const accessToken = session?.accessToken;
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    return headers;
  };
}