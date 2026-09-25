'use client';

import React from 'react';

export interface LoadingStateProps {
  message?: string;
  variant?: 'page' | 'card' | 'inline';
}

export function LoadingState({
  message = 'Loading…',
  variant = 'page',
}: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
        <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <span>{message}</span>
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="p-8 rounded-2xl bg-[#0c0c14] border border-white/5 space-y-4 animate-pulse">
        <div className="h-6 w-1/3 bg-white/10 rounded-lg" />
        <div className="space-y-2">
          <div className="h-4 w-full bg-white/5 rounded-md" />
          <div className="h-4 w-5/6 bg-white/5 rounded-md" />
          <div className="h-4 w-4/6 bg-white/5 rounded-md" />
        </div>
        <div className="flex items-center gap-2 pt-2 text-xs text-gray-500">
          <div className="w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center space-y-4"
    >
      <div className="relative flex items-center justify-center">
        <div className="w-12 h-12 border-3 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
        <div className="absolute w-6 h-6 border-3 border-cyan-400/30 border-b-cyan-400 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.2s' }} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-300">{message}</p>
        <p className="text-xs text-gray-500 mt-1">Connecting to Stellar Horizon ledger nodes…</p>
      </div>
    </div>
  );
}
