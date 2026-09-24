import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WatcherForm } from './WatcherForm';

const requestAccess = vi.fn();
const isConnected = vi.fn();
const getNetworkDetails = vi.fn();

vi.mock('@stellar/freighter-api', () => ({
  requestAccess: (...args: unknown[]) => requestAccess(...args),
  isConnected: (...args: unknown[]) => isConnected(...args),
  getNetworkDetails: (...args: unknown[]) => getNetworkDetails(...args),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'test-token' } }),
}));

const VALID_ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';

describe('WatcherForm Freighter connect flow', () => {
  beforeEach(() => {
    requestAccess.mockReset();
    isConnected.mockReset();
    getNetworkDetails.mockReset();
    global.fetch = vi.fn();
  });

  it('populates the address field and shows connection state on success', async () => {
    requestAccess.mockResolvedValue({ address: VALID_ADDRESS });
    getNetworkDetails.mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'x', networkUrl: 'x' });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 404,
      json: async () => ({}),
    });

    render(<WatcherForm />);

    fireEvent.click(screen.getByTestId('connect-freighter-button'));

    await waitFor(() => {
      expect(screen.getByTestId('freighter-connection-status')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue(VALID_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/Network: TESTNET/)).toBeInTheDocument();
    expect(screen.getByText(/not yet funded/i)).toBeInTheDocument();
  });

  it('shows a friendly error when the user rejects the Freighter prompt', async () => {
    requestAccess.mockResolvedValue({ error: 'User declined access' });

    render(<WatcherForm />);

    fireEvent.click(screen.getByTestId('connect-freighter-button'));

    await waitFor(() => {
      expect(screen.getByTestId('freighter-error')).toHaveTextContent(/declined/i);
    });

    expect(screen.queryByTestId('freighter-connection-status')).not.toBeInTheDocument();
  });

  it('shows a friendly error when Freighter is not installed', async () => {
    requestAccess.mockRejectedValue(new Error('freighterApi is not defined'));

    render(<WatcherForm />);

    fireEvent.click(screen.getByTestId('connect-freighter-button'));

    await waitFor(() => {
      expect(screen.getByTestId('freighter-error')).toHaveTextContent(/not detected/i);
    });
  });

  it('rejects a malformed manually-entered public key on submit without calling the API', async () => {
    render(<WatcherForm />);

    fireEvent.change(screen.getByLabelText(/Stellar Public Key/i), {
      target: { value: 'not-a-real-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Watch Address/i }));

    await waitFor(() => {
      expect(screen.getByText(/Not a valid Stellar public key/i)).toBeInTheDocument();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
