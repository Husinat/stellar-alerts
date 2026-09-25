'use client';

import { useEffect } from 'react';

export default function TMAError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[TMAError] Mini App boundary caught error:', error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center space-y-5"
    >
      <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-lg font-bold text-white">Mini App Error</h2>
        <p className="text-xs text-gray-400 max-w-xs mx-auto">
          {error.message || 'Failed to authenticate or load Telegram Mini App preferences.'}
        </p>
      </div>

      <button
        onClick={reset}
        className="w-full max-w-xs py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 active:scale-98 text-white font-medium text-sm transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Retry Mini App
      </button>
    </div>
  );
}
