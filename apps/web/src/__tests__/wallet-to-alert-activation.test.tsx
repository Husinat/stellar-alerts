import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WalletAlertActivationWizard } from '../components/dashboard/WalletAlertActivationWizard';

describe('End-to-End Wallet-to-Alert Activation Flow (#325)', () => {
  const originalFetch = global.fetch;
  const sampleWallet = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const sampleChatId = '123456789';

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('validates Stellar public key format before allowing registration', async () => {
    const { getByLabelText, getByRole, getByText } = render(
      <WalletAlertActivationWizard />
    );

    const input = getByLabelText(/Stellar Public Key/i);
    const submitBtn = getByRole('button', { name: /Continue to Telegram Setup/i });

    // Enter invalid address
    fireEvent.change(input, { target: { value: 'INVALID_NOT_STELLAR' } });
    fireEvent.click(submitBtn);

    expect(getByText(/Invalid Stellar public key/i)).toBeTruthy();
  });

  it('completes the full flow: connect -> telegram -> preferences -> test ping -> activation', async () => {
    // Mock API endpoints
    // @ts-expect-error mock fetch
    global.fetch.mockImplementation((url: string) => {
      if (url.includes('/wallets')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, id: 'w_123' }),
        });
      }
      if (url.includes('/notifications/preferences')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      if (url.includes('/notifications/test-ping')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            providerRequestId: 'req_telegram_test_999',
            latencyMs: 42,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const onActivated = vi.fn();
    const { getByLabelText, getByRole, getByText } = render(
      <WalletAlertActivationWizard onActivated={onActivated} />
    );

    // ── Phase 1: Wallet Connect & Registration ──
    const keyInput = getByLabelText(/Stellar Public Key/i);
    fireEvent.change(keyInput, { target: { value: sampleWallet } });
    fireEvent.click(getByRole('button', { name: /Continue to Telegram Setup/i }));

    await waitFor(() => {
      expect(getByText('Link Telegram Channel')).toBeTruthy();
    });

    // ── Phase 2: Telegram Link ──
    const tgInput = getByLabelText(/Telegram Chat ID/i);
    fireEvent.change(tgInput, { target: { value: sampleChatId } });
    fireEvent.click(getByRole('button', { name: /Confirm Telegram & Configure Rules/i }));

    await waitFor(() => {
      expect(getByText('Configure Filter Rules')).toBeTruthy();
    });

    // ── Phase 3: Preferences Configuration ──
    const minAmountInput = getByLabelText(/Minimum Alert Amount/i);
    fireEvent.change(minAmountInput, { target: { value: '25' } });
    fireEvent.click(getByRole('button', { name: /Save & Proceed to Test Ping/i }));

    await waitFor(() => {
      expect(getByText('Test Notification Dispatch')).toBeTruthy();
      expect(getByText(sampleWallet)).toBeTruthy();
      expect(getByText(sampleChatId)).toBeTruthy();
      expect(getByText('25 XLM')).toBeTruthy();
    });

    // ── Phase 4: Test Ping Alert ──
    const pingBtn = getByRole('button', { name: /Send Test Alert Ping/i });
    fireEvent.click(pingBtn);

    await waitFor(() => {
      expect(getByText(/Test Alert Delivered Successfully!/i)).toBeTruthy();
      expect(getByText(/req_telegram_test_999/)).toBeTruthy();
    });

    // ── Phase 5: Activation ──
    const activateBtn = getByRole('button', { name: /Activate Live Alerts/i });
    fireEvent.click(activateBtn);

    await waitFor(() => {
      expect(getByText('Alert Ingestion Active')).toBeTruthy();
      expect(getByText('Live Ingestion Active')).toBeTruthy();
    });

    expect(onActivated).toHaveBeenCalledWith({
      walletAddress: sampleWallet,
      telegramChatId: sampleChatId,
      preferences: {
        minAmount: 25,
        emailEnabled: true,
      },
    });
  });

  it('handles provider delivery faults and offers retry recovery', async () => {
    let shouldFail = true;

    // @ts-expect-error mock fetch
    global.fetch.mockImplementation((url: string) => {
      if (url.includes('/wallets')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      if (url.includes('/notifications/preferences')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      if (url.includes('/notifications/test-ping')) {
        if (shouldFail) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ success: false, error: 'Telegram bot API timeout 504' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            providerRequestId: 'req_recovered_123',
            latencyMs: 65,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { getByLabelText, getByRole, getByText } = render(
      <WalletAlertActivationWizard />
    );

    // Fast-forward to step 4
    fireEvent.change(getByLabelText(/Stellar Public Key/i), { target: { value: sampleWallet } });
    fireEvent.click(getByRole('button', { name: /Continue to Telegram Setup/i }));

    await waitFor(() => getByLabelText(/Telegram Chat ID/i));
    fireEvent.change(getByLabelText(/Telegram Chat ID/i), { target: { value: sampleChatId } });
    fireEvent.click(getByRole('button', { name: /Confirm Telegram & Configure Rules/i }));

    await waitFor(() => getByRole('button', { name: /Save & Proceed to Test Ping/i }));
    fireEvent.click(getByRole('button', { name: /Save & Proceed to Test Ping/i }));

    await waitFor(() => getByRole('button', { name: /Send Test Alert Ping/i }));
    fireEvent.click(getByRole('button', { name: /Send Test Alert Ping/i }));

    // ── Phase 6: Recovery State on Failure ──
    await waitFor(() => {
      expect(getByText(/Delivery Fault Detected/i)).toBeTruthy();
      expect(getByText(/Telegram bot API timeout 504/i)).toBeTruthy();
      expect(getByRole('button', { name: /Retry Test Ping/i })).toBeTruthy();
    });

    // Clear fault and retry
    shouldFail = false;
    fireEvent.click(getByRole('button', { name: /Retry Test Ping/i }));

    await waitFor(() => {
      expect(getByRole('button', { name: /Send Test Alert Ping/i })).toBeTruthy();
    });

    fireEvent.click(getByRole('button', { name: /Send Test Alert Ping/i }));

    await waitFor(() => {
      expect(getByText(/Test Alert Delivered Successfully!/i)).toBeTruthy();
      expect(getByText(/req_recovered_123/)).toBeTruthy();
      expect(getByRole('button', { name: /Activate Live Alerts/i })).toBeTruthy();
    });
  });
});
