import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestAccess = vi.fn();
const isConnected = vi.fn();
const getNetworkDetails = vi.fn();

vi.mock('@stellar/freighter-api', () => ({
  requestAccess: (...args: unknown[]) => requestAccess(...args),
  isConnected: (...args: unknown[]) => isConnected(...args),
  getNetworkDetails: (...args: unknown[]) => getNetworkDetails(...args),
}));

import { connectFreighter, isFreighterAvailable, FreighterConnectError } from './freighter';

const VALID_ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';

describe('connectFreighter', () => {
  beforeEach(() => {
    requestAccess.mockReset();
    isConnected.mockReset();
    getNetworkDetails.mockReset();
  });

  it('resolves with the public key and network on success', async () => {
    requestAccess.mockResolvedValue({ address: VALID_ADDRESS });
    getNetworkDetails.mockResolvedValue({
      network: 'TESTNET',
      networkUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    const result = await connectFreighter();

    expect(result.publicKey).toBe(VALID_ADDRESS);
    expect(result.network).toBe('TESTNET');
  });

  it('throws a REJECTED FreighterConnectError when the user declines', async () => {
    requestAccess.mockResolvedValue({ error: 'User declined access' });

    await expect(connectFreighter()).rejects.toMatchObject({
      code: 'REJECTED',
    });
  });

  it('throws a REJECTED error when requestAccess itself rejects with a decline message', async () => {
    requestAccess.mockRejectedValue(new Error('User rejected the request'));

    await expect(connectFreighter()).rejects.toMatchObject({ code: 'REJECTED' });
  });

  it('throws NOT_INSTALLED when requestAccess throws for any other reason', async () => {
    requestAccess.mockRejectedValue(new Error('freighterApi is not defined'));

    await expect(connectFreighter()).rejects.toMatchObject({ code: 'NOT_INSTALLED' });
  });

  it('throws MALFORMED_ADDRESS when Freighter returns an invalid key', async () => {
    requestAccess.mockResolvedValue({ address: 'not-a-valid-key' });

    await expect(connectFreighter()).rejects.toMatchObject({ code: 'MALFORMED_ADDRESS' });
  });

  it('still resolves the connection when network details lookup fails', async () => {
    requestAccess.mockResolvedValue({ address: VALID_ADDRESS });
    getNetworkDetails.mockRejectedValue(new Error('network lookup failed'));

    const result = await connectFreighter();
    expect(result.publicKey).toBe(VALID_ADDRESS);
    expect(result.network).toBeUndefined();
  });

  it('error instances are instanceof FreighterConnectError', async () => {
    requestAccess.mockResolvedValue({ error: 'User declined access' });
    try {
      await connectFreighter();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FreighterConnectError);
    }
  });
});

describe('isFreighterAvailable', () => {
  beforeEach(() => {
    isConnected.mockReset();
  });

  it('returns true when the extension reports connected with no error', async () => {
    isConnected.mockResolvedValue({ isConnected: true });
    await expect(isFreighterAvailable()).resolves.toBe(true);
  });

  it('returns false when isConnected throws (extension absent)', async () => {
    isConnected.mockRejectedValue(new Error('not found'));
    await expect(isFreighterAvailable()).resolves.toBe(false);
  });

  it('returns false when isConnected reports an error', async () => {
    isConnected.mockResolvedValue({ isConnected: false, error: 'unavailable' });
    await expect(isFreighterAvailable()).resolves.toBe(false);
  });
});
