'use client';

import { useState } from 'react';

interface EndpointDoc {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  auth: 'Public' | 'Session' | 'Ownership';
}

const AUTH_ENDPOINTS: EndpointDoc[] = [
  { method: 'POST', path: '/auth/request-link', summary: 'Request a passwordless magic link.', auth: 'Public' },
  { method: 'GET', path: '/auth/verify?token=', summary: 'Validate a magic link token & mint a session.', auth: 'Public' },
  { method: 'POST', path: '/auth/did/challenge', summary: 'Issue a sign-in challenge for a did:pkh:stellar identity (single-use, 5 min TTL).', auth: 'Public' },
  { method: 'POST', path: '/auth/did/verify', summary: 'Verify the wallet signature and mint a session JWT.', auth: 'Public' },
  { method: 'GET', path: '/auth/me', summary: 'Return the currently authenticated profile.', auth: 'Session' },
];

const WALLET_ENDPOINTS: EndpointDoc[] = [
  { method: 'GET', path: '/wallets', summary: 'List the authenticated user’s watched wallets.', auth: 'Session' },
  { method: 'POST', path: '/wallets', summary: 'Add a watch-only Stellar public key (G...).', auth: 'Session' },
  { method: 'DELETE', path: '/wallets/:id', summary: 'Remove a watched wallet.', auth: 'Ownership' },
];

const PAYMENT_ENDPOINTS: EndpointDoc[] = [
  { method: 'GET', path: '/payments', summary: 'List recorded payments (optionally filtered by walletId).', auth: 'Session' },
  { method: 'GET', path: '/payments/summary', summary: 'Aggregate volume + count over recorded payments.', auth: 'Session' },
];

const NOTIFICATION_ENDPOINTS: EndpointDoc[] = [
  { method: 'GET', path: '/notifications/preferences', summary: 'Read notification preferences.', auth: 'Session' },
  { method: 'POST', path: '/notifications/preferences', summary: 'Persist telegram/email/emailTemplate preferences.', auth: 'Session' },
];

const DEAD_LETTER_ENDPOINTS: EndpointDoc[] = [
  { method: 'GET', path: '/dead-letters', summary: 'List dead letters; filter by channel, status, q, maxAgeDays (paginated).', auth: 'Ownership' },
  { method: 'GET', path: '/dead-letters/:id', summary: 'Fetch a dead letter with its audit history.', auth: 'Ownership' },
  { method: 'POST', path: '/dead-letters/:id/replay', summary: 'Re-dispatch through the idempotent delivery pipeline.', auth: 'Ownership' },
  { method: 'POST', path: '/dead-letters/:id/suppress', summary: 'Suppress a dead letter and record an audit entry.', auth: 'Ownership' },
];

const METHOD_STYLES: Record<EndpointDoc['method'], string> = {
  GET: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  POST: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  PUT: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  DELETE: 'text-red-300 bg-red-500/10 border-red-500/30',
};

const AUTH_STYLES: Record<EndpointDoc['auth'], string> = {
  Public: 'text-gray-400 bg-white/5 border-white/10',
  Session: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  Ownership: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
};

function EndpointTable({ title, description, endpoints }: { title: string; description: string; endpoints: EndpointDoc[] }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-3xl bg-[#0c0c14]/80 border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-7 py-5 text-left hover:bg-white/5 transition-colors cursor-pointer"
      >
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
        <span className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-white/10">
                <th className="px-6 py-3">Method</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-6 py-3 text-right">Auth</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep) => (
                <tr key={ep.method + ep.path} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-6 py-3">
                    <span className={`px-2.5 py-1 rounded-full border text-xs font-bold ${METHOD_STYLES[ep.method]}`}>
                      {ep.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-300">{ep.path}</td>
                  <td className="px-4 py-3 text-xs text-gray-300 max-w-md">{ep.summary}</td>
                  <td className="px-6 py-3 text-right">
                    <span className={`px-2.5 py-1 rounded-full border text-xs ${AUTH_STYLES[ep.auth]}`}>{ep.auth}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">API Reference</h1>
        <p className="text-gray-400 text-sm mt-1 max-w-xl">
          All endpoints expect JSON. The base URL is <code className="text-cyan-300 font-mono">http://localhost:3001</code> in development.
        </p>
      </div>

      <EndpointTable title="Authentication" description="Passwordless magic links and Stellar wallet (DID) sign-in." endpoints={AUTH_ENDPOINTS} />
      <EndpointTable title="Wallets" description="Manage watch-only Stellar addresses." endpoints={WALLET_ENDPOINTS} />
      <EndpointTable title="Payments" description="Payment ledger inspection & aggregates." endpoints={PAYMENT_ENDPOINTS} />
      <EndpointTable title="Notifications" description="Alert channel & email template preferences." endpoints={NOTIFICATION_ENDPOINTS} />
      <EndpointTable title="Dead Letters" description="Terminal delivery failures — inspect, replay, suppress with audit history (#273)." endpoints={DEAD_LETTER_ENDPOINTS} />

      <section className="rounded-3xl bg-cyan-950/30 border border-cyan-500/30 p-7 space-y-3">
        <h2 className="text-lg font-bold text-cyan-200">Authentication model</h2>
        <ul className="text-sm text-gray-300 space-y-2 list-disc list-inside">
          <li>Session routes require <code className="text-cyan-300 font-mono">Authorization: Bearer &lt;JWT&gt;</code>, exposed to the browser as <code className="text-cyan-300 font-mono">session.accessToken</code>.</li>
          <li>Ownership-scoped routes additionally verify the resource belongs to the caller&apos;s user id.</li>
          <li>DID challenges are single-use and expire after 5 minutes; verify requires the exact issued challenge.</li>
          <li>Idempotent delivery: webhook/telegram/email dispatches deduplicate through <code className="text-cyan-300 font-mono">notificationDeliveryAttempt</code> (#272).</li>
        </ul>
      </section>
    </div>
  );
}