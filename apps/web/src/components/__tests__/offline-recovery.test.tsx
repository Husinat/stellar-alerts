import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNetworkStatus, subscribeNetworkStatus } from '../../hooks/useNetworkStatus';
import { OfflineRecoveryBanner } from '../OfflineRecoveryBanner';

describe('Global Offline Recovery Model (#324)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error mock fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('useNetworkStatus Hook', () => {
    function NetworkStatusProbe({ onStatus }: { onStatus: (status: any) => void }) {
      const status = useNetworkStatus();
      useEffectProbe(status, onStatus);
      return (
        <div>
          <span>{status.isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          <button onClick={() => status.retry()}>Retry</button>
        </div>
      );
    }

    function useEffectProbe(status: any, onStatus: (status: any) => void) {
      React.useEffect(() => {
        onStatus(status);
      }, [status, onStatus]);
    }

    it('subscribes to network status events and updates on online/offline events', async () => {
      let currentStatus: any = null;
      const callback = vi.fn();
      const unsubscribe = subscribeNetworkStatus(callback);

      const { getByText } = render(
        <NetworkStatusProbe onStatus={(s) => { currentStatus = s; }} />
      );

      expect(getByText('ONLINE')).toBeTruthy();
      expect(currentStatus.isOnline).toBe(true);

      // Simulate going offline
      act(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
      });

      expect(getByText('OFFLINE')).toBeTruthy();
      expect(currentStatus.isOnline).toBe(false);
      expect(currentStatus.offlineSince).toBeInstanceOf(Date);
      expect(callback).toHaveBeenCalledWith(false);

      // Simulate going back online
      await act(async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        window.dispatchEvent(new Event('online'));
      });

      expect(getByText('ONLINE')).toBeTruthy();
      expect(currentStatus.isOnline).toBe(true);
      expect(callback).toHaveBeenCalledWith(true);

      unsubscribe();
    });

    it('retry trigger checks connectivity and resets offline state', async () => {
      let currentStatus: any = null;
      const { getByText } = render(
        <NetworkStatusProbe onStatus={(s) => { currentStatus = s; }} />
      );

      act(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
      });

      expect(currentStatus.isOnline).toBe(false);

      // Trigger retry while online
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      // @ts-expect-error mock fetch
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      await act(async () => {
        fireEvent.click(getByText('Retry'));
      });

      await waitFor(() => {
        expect(currentStatus.isOnline).toBe(true);
      });
    });
  });

  describe('OfflineRecoveryBanner Component', () => {
    it('is hidden when online and displays banner when offline', async () => {
      const { queryByText, getByText } = render(<OfflineRecoveryBanner />);

      expect(queryByText(/You are currently offline/i)).toBeNull();

      act(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
      });

      expect(getByText(/You are currently offline/i)).toBeTruthy();
      expect(getByText(/Retry/i)).toBeTruthy();
    });

    it('clicking Retry triggers reconnection attempt', async () => {
      // @ts-expect-error mock fetch
      global.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100)));

      act(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      });

      const { getByText } = render(<OfflineRecoveryBanner />);

      const retryBtn = getByText(/Retry/i);
      fireEvent.click(retryBtn);

      // Shows reconnecting state
      await waitFor(() => {
        expect(getByText(/Reconnecting…/i)).toBeTruthy();
      });
    });

    it('displays restored banner when transitioning back online', async () => {
      const { getByText } = render(<OfflineRecoveryBanner />);

      // Go offline first
      act(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
      });

      expect(getByText(/You are currently offline/i)).toBeTruthy();

      // Return online
      await act(async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        window.dispatchEvent(new Event('online'));
      });

      await waitFor(() => {
        expect(getByText(/Connection restored/i)).toBeTruthy();
      });
    });
  });
});
