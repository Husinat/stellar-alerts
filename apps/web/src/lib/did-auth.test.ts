import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  didForPublicKey,
  publicKeyFromDid,
  connectWallet,
  requestChallenge,
  signChallenge,
  verifyDid,
  getFreighter,
  DIDAuthError,
} from './did-auth';

const KEY = 'GBZ6HTKJTVCSYTWCQQ2PKS7XQYJ5RWMNXSPL5KL4PGQ2NQVD6QCKZ4B7';

describe('did-auth client (#270)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', { freighterApi: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('identity helpers', () => {
    it('builds a did:pkh:stellar identity from a public key', () => {
      expect(didForPublicKey(KEY)).toBe(`did:pkh:stellar:${KEY}`);
    });

    it('round-trips the public key out of the DID', () => {
      const did = `did:pkh:stellar:${KEY}`;
      expect(publicKeyFromDid(did)).toBe(KEY);
      expect(publicKeyFromDid('did:key:z6Mkkk')).toBeNull();
    });

    it('rejects an empty public key with a typed error', () => {
      expect(() => didForPublicKey('')).toThrowError(DIDAuthError);
    });
  });

  describe('connectWallet', () => {
    const freighter = {
      isConnected: vi.fn().mockResolvedValue(true),
      setAllowed: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(KEY),
    };

    beforeEach(() => {
      (window as any).freighterApi = freighter;
      vi.clearAllMocks();
    });

    it('returns publicKey + did for a connected wallet', async () => {
      const result = await connectWallet();
      expect(result).toEqual({ publicKey: KEY, did: `did:pkh:stellar:${KEY}` });
    });

    it('requests permission when the wallet is not yet connected', async () => {
      freighter.isConnected.mockResolvedValue(false);
      const result = await connectWallet();
      expect(freighter.setAllowed).toHaveBeenCalled();
      expect(result.publicKey).toBe(KEY);
    });

    it('fails with a typed error when Freighter is missing', async () => {
      (window as any).freighterApi = undefined;
      await expect(connectWallet()).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
    });

    it('rejects a mismatched (wrong wallet) account', async () => {
      await expect(connectWallet('GOTHERWALLETPUBLICKEY123456789')).rejects.toMatchObject({
        code: 'WRONG_WALLET',
      });
    });

    it('surfaces wallet rejection', async () => {
      freighter.isConnected.mockResolvedValue(false);
      freighter.setAllowed.mockRejectedValue(new Error('user rejected'));
      await expect(connectWallet()).rejects.toMatchObject({ code: 'WALLET_REJECTED' });
    });
  });

  describe('challenge round-trip', () => {
    it('requests a challenge from the backend', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, did: `did:pkh:stellar:${KEY}`, challenge: 'c-1', expiresAt: '2026-01-01T00:05:00.000Z' }),
      } as Response);

      const result = await requestChallenge(`did:pkh:stellar:${KEY}`);
      expect(result.challenge).toBe('c-1');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/did/challenge'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ did: `did:pkh:stellar:${KEY}` }) })
      );
    });

    it('maps failed challenge requests to a typed error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid DID parameter' }),
      } as Response);

      await expect(requestChallenge('not-a-did')).rejects.toMatchObject({ code: 'CHALLENGE_FAILED' });
    });

    it('signs the challenge through Freighter', async () => {
      (window as any).freighterApi = { signMessage: vi.fn().mockResolvedValue('c2ln') };
      await expect(signChallenge('challenge-1')).resolves.toBe('c2ln');
    });

    it('maps a cancelled signature to a typed error', async () => {
      (window as any).freighterApi = { signMessage: vi.fn().mockRejectedValue(new Error('cancelled')) };
      await expect(signChallenge('challenge-1')).rejects.toMatchObject({ code: 'SIGNATURE_REJECTED' });
    });
  });

  describe('verifyDid', () => {
    it('verifies and returns the session token', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, token: 'session-jwt', user: { id: 'u', email: 'e', did: `did:pkh:stellar:${KEY}` } }),
      } as Response);

      const result = await verifyDid(`did:pkh:stellar:${KEY}`, 'c', 'sig');
      expect(result.token).toBe('session-jwt');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/did/verify'),
        expect.objectContaining({ body: JSON.stringify({ did: `did:pkh:stellar:${KEY}`, challenge: 'c', signature: 'sig' }) })
      );
    });

    it('surfaces expired-challenge responses as CHALLENGE_EXPIRED', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'DID Authentication failed', message: 'DID challenge expired or not requested' }),
      } as Response);

      await expect(verifyDid(`did:pkh:stellar:${KEY}`, 'c', 'sig')).rejects.toMatchObject({
        code: 'CHALLENGE_EXPIRED',
      });
    });
  });

  it('getFreighter detects the injected extension safely', () => {
    expect(getFreighter(null)).toBeUndefined();
    expect(getFreighter({ freighterApi: { getPublicKey: () => Promise.resolve('x') } })).toBeDefined();
    expect(getFreighter({})).toBeUndefined();
  });
});