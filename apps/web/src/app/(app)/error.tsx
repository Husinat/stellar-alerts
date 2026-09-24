'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App route error:', error);
  }, [error]);

  return (
    <div className="py-24 max-w-xl mx-auto text-center space-y-6">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-bold text-white">Something went wrong</h2>
        <p className="text-sm text-gray-400 mt-2">{error.message}</p>
      </div>
      <button
        onClick={reset}
        className="px-6 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-sm font-bold transition-all cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}