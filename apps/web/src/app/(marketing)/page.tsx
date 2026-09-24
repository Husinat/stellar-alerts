'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { DIDSignInButton } from '@/components/DIDSignInButton';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/** Marketing / landing page. Authenticated visitors are forwarded to the app. */
export default function LandingPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [emailInput, setEmailInput] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [devMagicUrl, setDevMagicUrl] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState<'input' | 'sent'>('input');
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (session) router.replace('/dashboard');
  }, [session, router]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleRequestMagicLink = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!emailInput) return;

    setIsLoadingAuth(true);
    setAuthStatus('Sending magic link...');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/request-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSentEmail(emailInput);
        setAuthStep('sent');
        setResendCooldown(30);
        if (data.token) {
          setDevMagicUrl(`${window.location.origin}/verify?token=${data.token}`);
        }
        setAuthStatus(null);
      } else {
        setAuthStatus(data.error || 'Failed to send magic link');
      }
    } catch (err) {
      console.error(err);
      setAuthStatus('Could not reach API server. Ensure Fastify is running.');
    } finally {
      setIsLoadingAuth(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030307] text-gray-100 font-sans selection:bg-cyan-500/30 overflow-x-hidden relative">
      {/* Background Ambient Glows & Grid Pattern */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[50vw] h-[50vw] rounded-full bg-cyan-600/15 blur-[160px] mix-blend-screen"></div>
        <div className="absolute bottom-[0%] right-[10%] w-[45vw] h-[45vw] rounded-full bg-blue-600/15 blur-[160px] mix-blend-screen"></div>
        <div className="absolute top-[40%] right-[30%] w-[40vw] h-[40vw] rounded-full bg-purple-600/10 blur-[180px] mix-blend-screen"></div>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#05050a]/70 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.4)]">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-100 to-gray-300">
              Stellar<span className="text-cyan-400">Alerts</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-300">
            <a href="#features" className="hover:text-cyan-400 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-cyan-400 transition-colors">How It Works</a>
            <a href="#demo" className="hover:text-cyan-400 transition-colors">Live Preview</a>
            <a href="#architecture" className="hover:text-cyan-400 transition-colors">Architecture</a>
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              Stellar Testnet Live
            </div>
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-sm shadow-[0_0_25px_rgba(6,182,212,0.4)] hover:shadow-[0_0_35px_rgba(6,182,212,0.6)] transition-all duration-300 transform hover:-translate-y-0.5 cursor-pointer"
            >
              Sign In
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold mb-8 animate-bounce">
          <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Horizon Network Ingestion — Zero-Delay Alerts
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white max-w-5xl mx-auto leading-[1.1] mb-8">
          Never miss an incoming <br className="hidden sm:block" />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400">
            Stellar payment again.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto font-normal leading-relaxed mb-12">
          Real-time payment tracking, multi-wallet ledger monitoring, and instant alert dispatch for Stellar freelancers, creators, and decentralized apps.
        </p>

        {/* Auth Section Card */}
        <div className="max-w-xl mx-auto bg-[#0d0d16]/90 backdrop-blur-2xl p-6 sm:p-8 rounded-3xl border border-white/15 shadow-[0_0_60px_rgba(6,182,212,0.2)] mb-16">
          {authStep === 'input' ? (
            <div className="space-y-5">
              <form onSubmit={handleRequestMagicLink} className="space-y-4">
                <div className="text-left">
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Enter your email to sign in
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="name@example.com"
                      className="flex-1 px-5 py-3.5 rounded-xl bg-[#141422] border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/60 text-sm font-medium transition-all"
                    />
                    <button
                      type="submit"
                      disabled={isLoadingAuth}
                      className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm shadow-lg transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isLoadingAuth ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <>
                          Send Magic Link
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {authStatus && (
                  <p className="text-xs text-red-400 font-medium text-left">{authStatus}</p>
                )}
              </form>

              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-gray-500">
                <span className="h-px flex-1 bg-white/10"></span>
                or use a wallet
                <span className="h-px flex-1 bg-white/10"></span>
              </div>

              <DIDSignInButton />
            </div>
          ) : (
            <div className="space-y-6 text-center animate-in zoom-in-95 duration-500">
              <div className="relative w-16 h-16 mx-auto">
                <div className="absolute inset-0 rounded-2xl bg-cyan-500/30 blur-lg animate-pulse"></div>
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-xl">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">Check your email</h3>
                <p className="text-sm text-gray-300 mt-2">
                  We sent a magic login link to <strong className="text-cyan-400 font-mono">{sentEmail}</strong>.
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Click the link inside your email to sign in automatically. No passwords or code copying required!
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <a
                  href="https://mail.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                >
                  Open Gmail
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>

                <button
                  type="button"
                  disabled={resendCooldown > 0 || isLoadingAuth}
                  onClick={() => handleRequestMagicLink()}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Magic Link'}
                </button>
              </div>

              {devMagicUrl && (
                <div className="mt-4 pt-4 border-t border-white/10 text-left bg-cyan-950/30 p-4 rounded-2xl border border-cyan-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      Dev Mode Direct Link
                    </span>
                    <span className="text-[10px] text-gray-500">1-Click Test Login</span>
                  </div>
                  <a
                    href={devMagicUrl}
                    className="block w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs text-center shadow-lg transition-all cursor-pointer"
                  >
                    Click to Authenticate Instantly
                  </a>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setAuthStep('input');
                  setDevMagicUrl(null);
                }}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors pt-2 underline cursor-pointer"
              >
                Use a different email address
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 mt-6 border-t border-white/10">
            <div className="rounded-xl bg-white/5 border border-white/5 p-3">
              <h4 className="text-lg font-extrabold text-cyan-400">100%</h4>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">Non-Custodial</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-3">
              <h4 className="text-lg font-extrabold text-blue-400">&lt; 2s</h4>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">Alert Latency</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-3">
              <h4 className="text-lg font-extrabold text-indigo-400">Multi</h4>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">Channels</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/5 p-3">
              <h4 className="text-lg font-extrabold text-emerald-400">Zero</h4>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">Keys Stored</p>
            </div>
          </div>
        </div>
      </section>

      {/* Live Transaction Preview Demo Section */}
      <section id="demo" className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Live Ingestion Preview</h2>
          <p className="text-gray-400 text-sm mt-2 max-w-md mx-auto">Watch real-time transaction detection in action as payment events hit the Stellar Testnet ledger.</p>
        </div>

        <div className="bg-[#0b0b14]/90 backdrop-blur-2xl rounded-3xl border border-white/10 p-6 md:p-8 shadow-[0_0_60px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-sm font-semibold text-white">Live Horizon Stream</span>
            </div>
            <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded-full">
              https://horizon-testnet.stellar.org
            </span>
          </div>

          <div className="rounded-2xl bg-[#121222]/60 border border-white/10 p-8 text-center">
            <p className="text-xs text-gray-500">
              Sign in and add a watch-only <code className="text-cyan-300 font-mono">G...</code> address to see live payments here.
            </p>
          </div>
        </div>
      </section>

      {/* Core Features Grid */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">Built for Stellar Builders & Freelancers</h2>
          <p className="text-gray-400 text-base mt-3 max-w-xl mx-auto">Everything you need to monitor wallet health, maintain financial records, and get instant payment alerts.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-8 rounded-3xl bg-[#0c0c16]/80 border border-white/10 hover:border-cyan-500/40 transition-all duration-300 group">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Instant Horizon Ingestion</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Our background worker directly checks Stellar Horizon payment streams, catching incoming transactions seconds after ledger validation.
            </p>
          </div>

          <div className="p-8 rounded-3xl bg-[#0c0c16]/80 border border-white/10 hover:border-blue-500/40 transition-all duration-300 group">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">100% Non-Custodial</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Only public key addresses starting with <code className="text-cyan-300 font-mono">G...</code> are accepted. Your secret keys remain 100% private and untouched.
            </p>
          </div>

          <div className="p-8 rounded-3xl bg-[#0c0c16]/80 border border-white/10 hover:border-purple-500/40 transition-all duration-300 group">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Multi-Channel Dispatch</h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              Configure alert preferences across Telegram bot messages, email digests, and custom HTTP webhooks for automated workflows.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works Step-by-Step */}
      <section id="how-it-works" className="relative z-10 max-w-5xl mx-auto px-6 py-20 border-t border-white/10">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-extrabold text-white tracking-tight">How It Works</h2>
          <p className="text-gray-400 text-sm mt-2">Get up and running in under 2 minutes.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-3">
            <span className="w-10 h-10 rounded-full bg-cyan-500/20 text-cyan-400 font-extrabold text-sm flex items-center justify-center mx-auto border border-cyan-500/30">1</span>
            <h4 className="text-lg font-bold text-white">Add Public Wallet</h4>
            <p className="text-xs text-gray-400 leading-relaxed">Enter your Stellar public key (<code className="text-cyan-300 font-mono">G...</code>). No secret keys or wallet signing required.</p>
          </div>

          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-3">
            <span className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 font-extrabold text-sm flex items-center justify-center mx-auto border border-blue-500/30">2</span>
            <h4 className="text-lg font-bold text-white">Watcher Ingestion</h4>
            <p className="text-xs text-gray-400 leading-relaxed">Our background worker listens to Horizon ledger operations and writes transaction metadata into PostgreSQL.</p>
          </div>

          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-center space-y-3">
            <span className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 font-extrabold text-sm flex items-center justify-center mx-auto border border-emerald-500/30">3</span>
            <h4 className="text-lg font-bold text-white">Instant Alerts</h4>
            <p className="text-xs text-gray-400 leading-relaxed">Receive immediate notifications when XLM or custom token payments land in your account.</p>
          </div>
        </div>
      </section>

      {/* Architecture Showcase */}
      <section id="architecture" className="relative z-10 max-w-6xl mx-auto px-6 py-20 border-t border-white/10">
        <div className="bg-gradient-to-br from-[#0e0e1a] to-[#07070e] rounded-3xl border border-white/10 p-8 md:p-12 shadow-2xl">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="max-w-xl space-y-4">
              <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">Open Source Architecture</span>
              <h2 className="text-3xl font-extrabold text-white tracking-tight">Decoupled, Scalable Stack</h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Stellar Alerts uses a 3-tier architecture separating ingestion, storage, and API presentation.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 font-mono">Fastify + TS</span>
                <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 font-mono">Prisma ORM</span>
                <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 font-mono">Stellar SDK</span>
                <span className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 font-mono">Next.js App Router</span>
              </div>
            </div>

            <div className="w-full lg:w-auto flex flex-col gap-4">
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all cursor-pointer text-center"
              >
                Launch Dashboard App
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Auth Modal Drawer */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-md bg-[#0a0a14] border border-white/15 rounded-3xl p-8 shadow-2xl relative">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-5 right-5 text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold mx-auto mb-3">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white">Sign In to StellarAlerts</h3>
              <p className="text-xs text-gray-400 mt-1">Passwordless email magic link or sign with your Stellar wallet.</p>
            </div>

            {authStep === 'input' ? (
              <div className="space-y-5">
                <form onSubmit={handleRequestMagicLink} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-4 py-3 rounded-xl bg-[#141422] border border-white/10 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-cyan-500/60"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoadingAuth}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm shadow-lg hover:from-cyan-400 hover:to-blue-500 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isLoadingAuth ? 'Sending...' : 'Send Magic Link'}
                  </button>
                </form>

                <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-gray-500">
                  <span className="h-px flex-1 bg-white/10"></span>
                  or use a wallet
                  <span className="h-px flex-1 bg-white/10"></span>
                </div>

                <DIDSignInButton onAuthenticated={() => setShowAuthModal(false)} />
              </div>
            ) : (
              <div className="space-y-4 text-center">
                <div className="w-12 h-12 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h4 className="text-base font-bold text-white">Check Your Inbox</h4>
                <p className="text-xs text-gray-300">We sent a magic link to <strong className="text-cyan-400">{sentEmail}</strong>. Click the link in the email to log in.</p>

                {devMagicUrl && (
                  <a
                    href={devMagicUrl}
                    className="block w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs text-center shadow-lg transition-all cursor-pointer mt-2"
                  >
                    Click to Authenticate Instantly (Dev)
                  </a>
                )}
              </div>
            )}

            {authStatus && (
              <div className="mt-4 p-3 rounded-xl bg-cyan-950/50 border border-cyan-500/30 text-cyan-300 text-xs text-center">
                {authStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-10 bg-[#020205]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">StellarAlerts</span>
            <span className="text-xs text-gray-500">Non-Custodial Stellar Payment Tracker</span>
          </div>
          <p className="text-xs text-gray-500">Released under the MIT License</p>
        </div>
      </footer>
    </div>
  );
}