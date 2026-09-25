'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  isReconnecting: boolean;
  offlineSince: Date | null;
  lastOnlineAt: Date | null;
  reconnectAttempts: number;
  retry: () => Promise<boolean>;
}

type NetworkCallback = (isOnline: boolean) => void;
const subscribers = new Set<NetworkCallback>();

export function subscribeNetworkStatus(cb: NetworkCallback): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function notifySubscribers(isOnline: boolean) {
  subscribers.forEach((cb) => cb(isOnline));
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    return true;
  });

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(() => new Date());
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return true;
    try {
      // Fast HEAD request to verify actual Internet / API reachability
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);

      // If we got any response or browser navigator says online, consider reachable
      const reachable = res !== null || navigator.onLine;
      return reachable;
    } catch {
      return navigator.onLine;
    }
  }, []);

  const retry = useCallback(async (): Promise<boolean> => {
    setIsReconnecting(true);
    setReconnectAttempts((prev) => prev + 1);

    const reachable = await checkConnectivity();
    setIsReconnecting(false);

    if (reachable) {
      setIsOnline(true);
      setOfflineSince(null);
      setLastOnlineAt(new Date());
      setReconnectAttempts(0);
      notifySubscribers(true);
      return true;
    } else {
      setIsOnline(false);
      return false;
    }
  }, [checkConnectivity]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = async () => {
      setIsReconnecting(true);
      const reachable = await checkConnectivity();
      setIsReconnecting(false);

      if (reachable) {
        setIsOnline(true);
        setOfflineSince(null);
        setLastOnlineAt(new Date());
        setReconnectAttempts(0);
        notifySubscribers(true);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setOfflineSince(new Date());
      notifySubscribers(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial state check
    if (!navigator.onLine) {
      handleOffline();
    }

    const timeoutRef = reconnectTimeoutRef.current;
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timeoutRef) {
        clearTimeout(timeoutRef);
      }
    };
  }, [checkConnectivity]);

  return {
    isOnline,
    isReconnecting,
    offlineSince,
    lastOnlineAt,
    reconnectAttempts,
    retry,
  };
}
