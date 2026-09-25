'use client';

import React, { useState, useEffect } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function OfflineRecoveryBanner() {
  const { isOnline, isReconnecting, offlineSince, retry } = useNetworkStatus();
  const [showRestored, setShowRestored] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline) {
      setShowRestored(true);
      const timer = setTimeout(() => {
        setShowRestored(false);
        setWasOffline(false);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (isOnline && !showRestored) {
    return null;
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={isOnline ? 'Online status notification' : 'Offline warning'}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-2.5 sm:px-6 transition-all duration-300 backdrop-blur-md border-b shadow-lg"
      style={{
        backgroundColor: isOnline
          ? 'rgba(16, 185, 129, 0.15)'
          : 'rgba(239, 68, 68, 0.15)',
        borderColor: isOnline
          ? 'rgba(16, 185, 129, 0.35)'
          : 'rgba(239, 68, 68, 0.35)',
      }}
    >
      <div className="flex items-center gap-3">
        {isOnline ? (
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
        ) : (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
          </span>
        )}

        <div className="text-sm">
          {isOnline ? (
            <span className="font-semibold text-emerald-300">
              Connection restored. Resumed real-time ledger monitoring.
            </span>
          ) : (
            <span className="font-semibold text-red-300">
              You are currently offline.{' '}
              <span className="hidden sm:inline text-red-200/80 font-normal">
                {offlineSince
                  ? `Disconnected at ${offlineSince.toLocaleTimeString()}. Updates are paused.`
                  : 'Live alerts and updates are paused.'}
              </span>
            </span>
          )}
        </div>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => retry()}
            disabled={isReconnecting}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isReconnecting ? (
              <>
                <svg
                  className="animate-spin h-3.5 w-3.5 text-red-200"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                <span>Reconnecting…</span>
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>Retry</span>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
