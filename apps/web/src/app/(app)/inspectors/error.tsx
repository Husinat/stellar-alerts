'use client';

import { useEffect } from 'react';

export default function InspectorsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[InspectorsError] Route boundary caught error:', error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="py-16 px-4 max-w-xl mx-auto text-center space-y-6"
    >
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 shadow-xl">
        <svg
          className="w-8 h-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-bold text-white tracking-tight">
          Inspectors Could Not Be Loaded
        </h2>
        <p className="text-sm text-gray-400">
          Failed to load ledger inspectors or dead-letter queue records.
        </p>
        {error.message && (
          <p className="text-xs font-mono text-amber-400/80 bg-amber-950/20 p-2.5 rounded-xl border border-amber-900/30 break-all max-w-md mx-auto">
            {error.message}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/40 border border-purple-500/40 text-purple-200 text-sm font-semibold transition-all cursor-pointer flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Retry Inspectors
        </button>
      </div>
    </div>
  );
}
