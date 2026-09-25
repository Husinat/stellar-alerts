'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';

export interface ApiEndpointSpec {
  id: string;
  group: 'Auth' | 'Wallets' | 'Payments' | 'Webhooks' | 'Soroban' | 'Receipts';
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  path: string;
  title: string;
  description: string;
  authRequired: boolean;
  requestSchema?: Record<string, any>;
  responseSchema?: Record<string, any>;
  sampleParams?: Record<string, any>;
  sampleBody?: Record<string, any>;
}

export const API_ENDPOINTS: ApiEndpointSpec[] = [
  {
    id: 'auth-request-link',
    group: 'Auth',
    method: 'POST',
    path: '/auth/request-link',
    title: 'Request Passwordless Magic Link',
    description: 'Generates a signed, single-use magic link token dispatched to user email for passwordless authentication.',
    authRequired: false,
    requestSchema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', description: 'User account email address' },
      },
    },
    sampleBody: { email: 'developer@stellar-alerts.org' },
  },
  {
    id: 'auth-verify-link',
    group: 'Auth',
    method: 'POST',
    path: '/auth/verify-link',
    title: 'Verify Magic Link Token',
    description: 'Verifies a magic link JWT token, invalidates it in Redis to prevent replay, and returns a session Bearer JWT.',
    authRequired: false,
    requestSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', description: 'Single-use magic link token string' },
      },
    },
    sampleBody: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
  },
  {
    id: 'wallets-list',
    group: 'Wallets',
    method: 'GET',
    path: '/wallets',
    title: 'List Watched Wallets',
    description: 'Retrieves all Stellar Ed25519 wallets being ingested and monitored for the authenticated user.',
    authRequired: true,
    responseSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          publicKey: { type: 'string' },
          label: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  {
    id: 'wallets-create',
    group: 'Wallets',
    method: 'POST',
    path: '/wallets',
    title: 'Register Watched Wallet',
    description: 'Adds a new Ed25519 public key (G...) to the account stream indexer with optional ZK ownership proof.',
    authRequired: true,
    requestSchema: {
      type: 'object',
      required: ['publicKey'],
      properties: {
        publicKey: { type: 'string', pattern: '^G[A-Z2-7]{55}$', description: 'Valid Stellar Ed25519 Public Key' },
        label: { type: 'string', description: 'Optional human-readable label' },
      },
    },
    sampleBody: {
      publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
      label: 'Treasury Hot Wallet',
    },
  },
  {
    id: 'payments-list',
    group: 'Payments',
    method: 'GET',
    path: '/payments',
    title: 'Get Ingested Payments History',
    description: 'Queries ingested payment operations for watched wallets with filtering, cursor pagination, and fiat rates.',
    authRequired: true,
    sampleParams: { limit: '20', walletId: 'wlt_123' },
  },
  {
    id: 'payments-summary',
    group: 'Payments',
    method: 'GET',
    path: '/payments/summary',
    title: 'Payment Aggregate Summary Stats',
    description: 'Returns total aggregate payment volume in XLM and count across watched wallets.',
    authRequired: true,
  },
  {
    id: 'payments-receipt',
    group: 'Receipts',
    method: 'GET',
    path: '/payments/{txHash}/receipt',
    title: 'Download Transaction Receipt PDF',
    description: 'Generates a deterministic PDF transaction receipt complete with StellarExpert link, memo, and verification hash.',
    authRequired: true,
    sampleParams: { txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' },
  },
  {
    id: 'webhooks-list',
    group: 'Webhooks',
    method: 'GET',
    path: '/webhooks',
    title: 'List Configured Webhooks',
    description: 'Lists all user-registered HTTP POST alert webhooks, complete with active status and circuit breaker health.',
    authRequired: true,
  },
  {
    id: 'webhooks-create',
    group: 'Webhooks',
    method: 'POST',
    path: '/webhooks',
    title: 'Create Webhook Target',
    description: 'Registers a new HTTP target URL to receive real-time HMAC SHA-256 signed payment JSON alerts.',
    authRequired: true,
    requestSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri', description: 'HTTPS target URL' },
        payloadTemplate: { type: 'string', description: 'Optional Handlebars JSON template string' },
      },
    },
    sampleBody: {
      url: 'https://api.yourdomain.com/webhooks/stellar',
    },
  },
  {
    id: 'soroban-simulate',
    group: 'Soroban',
    method: 'POST',
    path: '/soroban/simulate',
    title: 'Simulate Smart Contract Invocation',
    description: 'Dry-runs a Soroban smart contract WASM invocation, returning CPU/RAM instructions, footprint, and event topics.',
    authRequired: true,
    requestSchema: {
      type: 'object',
      required: ['contractId', 'functionName'],
      properties: {
        contractId: { type: 'string', description: 'Soroban Contract ID (C...)' },
        functionName: { type: 'string', description: 'Exported WASM method name' },
        argsJson: { type: 'string', description: 'JSON formatted arguments string' },
      },
    },
    sampleBody: {
      contractId: 'CCONTRACTSIMULATIONTESTADDRESS0000000000000000000000000000',
      functionName: 'transfer',
      argsJson: '{"to": "GUSER2", "amount": "1000000"}',
    },
  },
];

export function generateCodeExample(
  endpoint: ApiEndpointSpec,
  language: 'curl' | 'javascript' | 'python',
  baseUrl = 'https://api.stellar-alerts.org'
): string {
  const fullUrl = `${baseUrl}${endpoint.path}`;
  const authHeader = endpoint.authRequired ? 'Authorization: Bearer <YOUR_SESSION_JWT>' : null;

  if (language === 'curl') {
    const lines = [`curl -X ${endpoint.method} "${fullUrl}"`];
    lines.push(`  -H "Content-Type: application/json"`);
    if (authHeader) lines.push(`  -H "${authHeader}"`);
    if (endpoint.sampleBody) {
      lines.push(`  -d '${JSON.stringify(endpoint.sampleBody, null, 2)}'`);
    }
    return lines.join(' \\\n');
  }

  if (language === 'javascript') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (endpoint.authRequired) headers['Authorization'] = 'Bearer <YOUR_SESSION_JWT>';

    return `const response = await fetch('${fullUrl}', {
  method: '${endpoint.method}',
  headers: ${JSON.stringify(headers, null, 4)},${
      endpoint.sampleBody ? `\n  body: JSON.stringify(${JSON.stringify(endpoint.sampleBody, null, 4)})` : ''
    }
});
const data = await response.json();
console.log(data);`;
  }

  // Python
  return `import requests

headers = {
    "Content-Type": "application/json",${endpoint.authRequired ? '\n    "Authorization": "Bearer <YOUR_SESSION_JWT>",' : ''}
}
${endpoint.sampleBody ? `payload = ${JSON.stringify(endpoint.sampleBody, null, 4)}\n` : ''}
response = requests.${endpoint.method.toLowerCase()}(
    "${fullUrl}",
    headers=headers,${endpoint.sampleBody ? '\n    json=payload' : ''}
)
print(response.status_code, response.json())`;
}

export default function ApiHubPage() {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(API_ENDPOINTS[0].id);
  const [codeLanguage, setCodeLanguage] = useState<'curl' | 'javascript' | 'python'>('curl');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [copiedCode, setCopiedCode] = useState(false);
  const [executingExample, setExecutingExample] = useState(false);
  const [exampleResult, setExampleResult] = useState<{ status: number; data: any } | null>(null);

  const selectedEndpoint = useMemo(() => {
    return API_ENDPOINTS.find((e) => e.id === selectedEndpointId) || API_ENDPOINTS[0];
  }, [selectedEndpointId]);

  const filteredEndpoints = useMemo(() => {
    return API_ENDPOINTS.filter((e) => {
      const matchesGroup = selectedGroup === 'All' || e.group === selectedGroup;
      const matchesSearch =
        !searchQuery.trim() ||
        e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesGroup && matchesSearch;
    });
  }, [selectedGroup, searchQuery]);

  useEffect(() => {
    if (filteredEndpoints.length > 0 && !filteredEndpoints.some((e) => e.id === selectedEndpointId)) {
      setSelectedEndpointId(filteredEndpoints[0].id);
      setExampleResult(null);
    }
  }, [filteredEndpoints, selectedEndpointId]);

  // Keyboard Navigation shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('api-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const generatedCode = useMemo(() => {
    return generateCodeExample(selectedEndpoint, codeLanguage);
  }, [selectedEndpoint, codeLanguage]);

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleRunLiveExample = async () => {
    setExecutingExample(true);
    setExampleResult(null);
    try {
      // Simulate API response for documentation sandbox
      await new Promise((resolve) => setTimeout(resolve, 600));
      let responseBody: any = { success: true, timestamp: new Date().toISOString() };

      if (selectedEndpoint.id === 'auth-request-link') {
        responseBody = { success: true, message: 'Magic link sent to developer@stellar-alerts.org', token: 'magic_demo_token_xyz123' };
      } else if (selectedEndpoint.id === 'wallets-list') {
        responseBody = {
          success: true,
          wallets: [
            { id: 'wlt_01', publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72', label: 'Treasury Wallet' }
          ]
        };
      } else if (selectedEndpoint.id === 'payments-summary') {
        responseBody = { success: true, summary: { totalVolumeXLM: 125450.75, totalPayments: 412 } };
      } else if (selectedEndpoint.id === 'soroban-simulate') {
        responseBody = {
          success: true,
          footprint: { cpuInstructions: 184520, memoryBytes: 65536, estimatedFeeXlm: '0.0034812' },
          events: [{ topic: 'transfer', data: '10000000' }]
        };
      } else {
        responseBody = { success: true, endpoint: selectedEndpoint.path, status: 'mocked_ok', data: selectedEndpoint.sampleBody || {} };
      }

      setExampleResult({ status: 200, data: responseBody });
    } catch (err: any) {
      setExampleResult({ status: 500, data: { error: err.message } });
    } finally {
      setExecutingExample(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/" className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-indigo-400">⚡</span> Stellar Alerts Developer API Hub
          </Link>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            OpenAPI v3.0.3
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            href="/"
            className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
          >
            ← Back to Web Dashboard
          </Link>
        </div>
      </header>

      {/* Main Grid Container */}
      <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8" data-testid="developer-api-hub">
        {/* Left Sidebar Navigation */}
        <aside className="lg:col-span-4 space-y-6">
          {/* Search & Category Filter */}
          <div className="space-y-3">
            <div className="relative">
              <input
                id="api-search-input"
                type="text"
                data-testid="api-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search endpoints (Ctrl+K)..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap gap-1.5" data-testid="group-filter-pills">
              {['All', 'Auth', 'Wallets', 'Payments', 'Webhooks', 'Soroban', 'Receipts'].map((group) => (
                <button
                  key={group}
                  onClick={() => setSelectedGroup(group)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    selectedGroup === group
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>

          {/* Endpoint List */}
          <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1" data-testid="endpoint-list">
            {filteredEndpoints.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                No endpoints matched your search filter.
              </div>
            ) : (
              filteredEndpoints.map((ep) => {
                const isSelected = ep.id === selectedEndpoint.id;
                const methodColors: Record<string, string> = {
                  GET: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                  POST: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
                  DELETE: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                  PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                };
                return (
                  <button
                    key={ep.id}
                    onClick={() => {
                      setSelectedEndpointId(ep.id);
                      setExampleResult(null);
                    }}
                    data-testid={`endpoint-btn-${ep.id}`}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-slate-900 border-indigo-500 shadow-md'
                        : 'bg-slate-950/60 border-slate-900 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${methodColors[ep.method]}`}>
                        {ep.method}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{ep.group}</span>
                    </div>
                    <div className="text-xs font-bold text-slate-200">{ep.title}</div>
                    <div className="text-[11px] font-mono text-slate-400 truncate">{ep.path}</div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Main Screen Detail */}
        <main className="lg:col-span-8 space-y-6">
          {/* Endpoint Overview Card */}
          <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <span className="px-3 py-1 rounded-md text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {selectedEndpoint.method}
                </span>
                <h1 className="text-lg font-bold text-white font-mono">{selectedEndpoint.path}</h1>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                selectedEndpoint.authRequired
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                {selectedEndpoint.authRequired ? '🔒 Auth Required (Bearer)' : '🌐 Public Endpoint'}
              </span>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-slate-300">{selectedEndpoint.title}</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{selectedEndpoint.description}</p>
            </div>
          </div>

          {/* Interactive Code Examples & Try Runner */}
          <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">Request Examples</span>
                <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800">
                  {(['curl', 'javascript', 'python'] as const).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setCodeLanguage(lang)}
                      data-testid={`lang-tab-${lang}`}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        codeLanguage === lang ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {lang === 'curl' ? 'cURL' : lang === 'javascript' ? 'JavaScript' : 'Python'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={copyCode}
                  data-testid="copy-code-btn"
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors"
                >
                  {copiedCode ? '✓ Copied' : '📋 Copy Code'}
                </button>
                <button
                  onClick={handleRunLiveExample}
                  disabled={executingExample}
                  data-testid="run-live-example-btn"
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors flex items-center gap-1.5"
                >
                  {executingExample ? 'Running...' : '⚡ Try Endpoint'}
                </button>
              </div>
            </div>

            {/* Code Sample Block */}
            <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-indigo-300 overflow-x-auto">
              <pre data-testid="code-sample-pre">{generatedCode}</pre>
            </div>

            {/* Live Response Result Box */}
            {exampleResult && (
              <div className="mt-4 space-y-2 border-t border-slate-800 pt-4" data-testid="live-response-result">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Response Preview</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                    exampleResult.status === 200 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                    HTTP {exampleResult.status} OK
                  </span>
                </div>
                <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto">
                  <pre>{JSON.stringify(exampleResult.data, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Generated Schema Display */}
          {selectedEndpoint.requestSchema && (
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-3" data-testid="schema-display-card">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Generated OpenAPI Component Schema (Zod / Request Payload)
              </h3>
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
                <pre>{JSON.stringify(selectedEndpoint.requestSchema, null, 2)}</pre>
              </div>
            </div>
          )}

          {/* Authentication Guidance */}
          <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Authentication Guidance & Best Practices
            </h3>
            <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
              <p>
                <strong>Passwordless Magic Links:</strong> Request login tokens via <code className="text-indigo-300">POST /auth/request-link</code>. Verify them to obtain session Bearer JWTs.
              </p>
              <p>
                <strong>Bearer Token Header:</strong> Attach your JWT session token to protected endpoints:
                <br />
                <code className="text-indigo-300">Authorization: Bearer &lt;session_token&gt;</code>
              </p>
              <p>
                <strong>Webhook Cryptographic Signatures:</strong> All outgoing webhooks contain an <code className="text-indigo-300">X-Stellar-Signature</code> header generated via HMAC SHA-256 for origin verification.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
