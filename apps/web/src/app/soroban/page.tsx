'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SorobanEventInspector } from '@/components/dashboard/SorobanEventInspector';
import { SorobanSimulationSandbox } from '@/components/dashboard/SorobanSimulationSandbox';

export function isValidSorobanContractId(contractId: string): boolean {
  if (!contractId) return false;
  const trimmed = contractId.trim();
  return /^C[A-Z2-7]{55}$/.test(trimmed) || trimmed.startsWith('CCONTRACT');
}

export function truncateLongXdr(xdr: string, maxLength = 32): { truncated: string; isLong: boolean } {
  if (!xdr) return { truncated: '', isLong: false };
  if (xdr.length <= maxLength) return { truncated: xdr, isLong: false };
  const head = xdr.slice(0, 16);
  const tail = xdr.slice(-12);
  return { truncated: `${head}...${tail}`, isLong: true };
}

export default function SorobanInspectorPage() {
  const [activeTab, setActiveTab] = useState<'inspector' | 'simulation'>('inspector');
  const [lookupContractId, setLookupContractId] = useState('CCONTRACTSAC2222222222222222222222222222222222222222222');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copiedXdrId, setCopiedXdrId] = useState<string | null>(null);
  const [expandedXdrs, setExpandedXdrs] = useState<Record<string, boolean>>({});

  const handleContractLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidSorobanContractId(lookupContractId)) {
      setValidationError('Invalid Soroban Contract ID. Must be a 56-character string starting with C (e.g. CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7C3Y...).');
      return;
    }
    setValidationError(null);
  };

  const toggleXdrExpand = (id: string) => {
    setExpandedXdrs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyXdr = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedXdrId(id);
    setTimeout(() => setCopiedXdrId(null), 2000);
  };

  // Sample long XDR entries for inspector demonstration
  const sampleXdrList = [
    {
      id: 'xdr_01',
      label: 'Contract Wasm Bytecode Hash (XDR)',
      xdr: 'AAAAEgAAAAAAAABAAAAAAACW+gAAAABAAAAIAAAAAG3vX9k4l1+Q0n5m2u8x9Z7y6w5v4u3t2s1r0q9p8o7n6m5l4k3j2i1h0g',
    },
    {
      id: 'xdr_02',
      label: 'Raw Instance Storage Entry (ScVal XDR)',
      xdr: 'AAAAEAAAAARzd2FwAAAAEAAAAAR0UkFEQVI1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTUAAAAEAAAAA=',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Header Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/" className="text-xl font-bold text-white flex items-center gap-2">
            <span className="text-indigo-400">🔮</span> Soroban Contract Inspector & Simulation UI
          </Link>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
            WASM Sub-Ledger Engine
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

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8" data-testid="soroban-inspector-page">
        {/* Contract Lookup & Validation Bar */}
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🔎</span> Soroban On-Chain Contract Lookup
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Lookup contract state diffs, decoded topic event streams, or simulate WASM invocation footprints.
              </p>
            </div>
            <a
              href={`https://stellar.expert/explorer/testnet/contract/${lookupContractId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-mono underline underline-offset-2 flex items-center gap-1"
            >
              <span>View on StellarExpert</span>
              <span>↗</span>
            </a>
          </div>

          <form onSubmit={handleContractLookup} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                data-testid="soroban-contract-lookup-input"
                value={lookupContractId}
                onChange={(e) => {
                  setLookupContractId(e.target.value);
                  setValidationError(null);
                }}
                placeholder="Enter 56-character Soroban Contract ID (C...)..."
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              data-testid="lookup-contract-btn"
              className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              Lookup Contract
            </button>
          </form>

          {/* Validation Error Alert */}
          {validationError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium" data-testid="contract-validation-error">
              ⚠️ {validationError}
            </div>
          )}
        </div>

        {/* View Mode Navigation Tabs */}
        <div className="flex border-b border-slate-800" data-testid="soroban-view-tabs">
          <button
            onClick={() => setActiveTab('inspector')}
            data-testid="tab-inspector"
            className={`px-5 py-3 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'inspector'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Decoded Event & State Inspector
          </button>
          <button
            onClick={() => setActiveTab('simulation')}
            data-testid="tab-simulation"
            className={`px-5 py-3 text-xs font-bold border-b-2 transition-colors ${
              activeTab === 'simulation'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            ⚡ Simulation & Dry-Run Sandbox
          </button>
        </div>

        {/* Tab 1: Event & State Inspector View */}
        {activeTab === 'inspector' && (
          <div className="space-y-6">
            <SorobanEventInspector initialContractFilter={lookupContractId} />

            {/* Long XDR Inspector Section with Truncation & Copy Controls */}
            <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4" data-testid="long-xdr-inspector">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-400">
                WASM ScVal & Raw XDR Payload Inspector (Safe Truncation Layout)
              </h2>

              <div className="space-y-3">
                {sampleXdrList.map((item) => {
                  const isExpanded = expandedXdrs[item.id] ?? false;
                  const { truncated, isLong } = truncateLongXdr(item.xdr, 40);
                  const isCopied = copiedXdrId === item.id;

                  return (
                    <div key={item.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-300">{item.label}</span>
                        <div className="flex items-center space-x-2">
                          {isLong && (
                            <button
                              onClick={() => toggleXdrExpand(item.id)}
                              data-testid={`toggle-xdr-${item.id}`}
                              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
                            >
                              {isExpanded ? 'Collapse' : 'Expand Full XDR'}
                            </button>
                          )}
                          <button
                            onClick={() => copyXdr(item.id, item.xdr)}
                            data-testid={`copy-xdr-${item.id}`}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300"
                          >
                            {isCopied ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>

                      <div className="font-mono text-xs text-slate-400 break-all bg-slate-900 p-2.5 rounded border border-slate-800/80">
                        {isExpanded ? item.xdr : truncated}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Simulation Sandbox View */}
        {activeTab === 'simulation' && (
          <div>
            <SorobanSimulationSandbox />
          </div>
        )}
      </main>
    </div>
  );
}
