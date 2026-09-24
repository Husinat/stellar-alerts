import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as StellarSdk from 'stellar-sdk';
import { AuthService } from '../auth.service';
import { generateDIDChallenge } from '../../../utils/did';

const mockRedis = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../../config/env', () => ({
  env: {
    JWT_SECRET: 'test-super-secret-jwt-key-12345',
    TELEGRAM_BOT_TOKEN: 'test-bot-token',
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../lib/redis', () => ({
  redis: mockRedis,
}));

import { prisma } from '../../../lib/prisma';

describe('DID sign-in backend (#270)', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
    (prisma.user.upsert as any).mockResolvedValue({ id: 'user-1', email: 'did@synthetic.org' });
  });

  it('issues a challenge and persists it under a 5-minute TTL', async () => {
    const keypair = StellarSdk.Keypair.random();
    const did = `did:pkh:stellar:${keypair.publicKey()}`;

    const challenge = await authService.requestDIDChallenge(did);

    expect(challenge.challenge).toContain('StellarAlerts-Auth-Challenge');
    expect(mockRedis.set).toHaveBeenCalledWith(
      `did:challenge:${did}`,
      challenge.challenge,
      'EX',
      300,
    );
  });

  it('accepts a fresh challenge signed by the wallet that owns the DID', async () => {
    const keypair = StellarSdk.Keypair.random();
    const did = `did:pkh:stellar:${keypair.publicKey()}`;
    const challengeObj = generateDIDChallenge(did);
    mockRedis.get.mockResolvedValue(challengeObj.challenge);

    const signature = keypair
      .sign(Buffer.from(challengeObj.challenge, 'utf-8'))
      .toString('base64');

    const result = await authService.verifyDIDAuth(did, challengeObj.challenge, signature);

    expect(mockRedis.del).toHaveBeenCalledWith(`did:challenge:${did}`);
    expect(typeof result.token).toBe('string');
    expect(result.user.did).toBe(did);
  });

  it('rejects a challenge that was never issued or already expired', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(
      authService.verifyDIDAuth('did:pkh:stellar:GCREATE', 'any-challenge', 'any-signature'),
    ).rejects.toThrow('DID challenge expired or not requested');
  });

  it('rejects a stale challenge that does not match the one issued', async () => {
    mockRedis.get.mockResolvedValue('issued-challenge-X');

    await expect(
      authService.verifyDIDAuth('did:pkh:stellar:GCREATE', 'different-challenge', 'sig'),
    ).rejects.toThrow('DID challenge does not match the one that was issued');
  });

  it('rejects a signature from the wrong wallet (forged/swap)', async () => {
    const realWallet = StellarSdk.Keypair.random();
    const attackerWallet = StellarSdk.Keypair.random();
    const did = `did:pkh:stellar:${realWallet.publicKey()}`;
    const challengeObj = generateDIDChallenge(did);
    mockRedis.get.mockResolvedValue(challengeObj.challenge);

    const signature = attackerWallet
      .sign(Buffer.from(challengeObj.challenge, 'utf-8'))
      .toString('base64');

    await expect(
      authService.verifyDIDAuth(did, challengeObj.challenge, signature),
    ).rejects.toThrow('Invalid DID challenge signature');
    // The signed challenge must not be consumed on failure.
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('rejects a signature over a tampered challenge string', async () => {
    const keypair = StellarSdk.Keypair.random();
    const did = `did:pkh:stellar:${keypair.publicKey()}`;
    const challengeObj = generateDIDChallenge(did);
    mockRedis.get.mockResolvedValue(challengeObj.challenge);

    const signature = keypair
      .sign(Buffer.from(`${challengeObj.challenge}-tampered`, 'utf-8'))
      .toString('base64');

    await expect(
      authService.verifyDIDAuth(did, challengeObj.challenge, signature),
    ).rejects.toThrow('Invalid DID challenge signature');
  });

  it('consumes the challenge on success so a replayed payload is rejected', async () => {
    const keypair = StellarSdk.Keypair.random();
    const did = `did:pkh:stellar:${keypair.publicKey()}`;
    const challengeObj = generateDIDChallenge(did);
    const signature = keypair
      .sign(Buffer.from(challengeObj.challenge, 'utf-8'))
      .toString('base64');

    mockRedis.get.mockResolvedValueOnce(challengeObj.challenge);

    const first = await authService.verifyDIDAuth(did, challengeObj.challenge, signature);
    expect(typeof first.token).toBe('string');

    // Second verify — challenge has been consumed.
    mockRedis.get.mockResolvedValue(null);
    await expect(
      authService.verifyDIDAuth(did, challengeObj.challenge, signature),
    ).rejects.toThrow('DID challenge expired or not requested');
  });
});