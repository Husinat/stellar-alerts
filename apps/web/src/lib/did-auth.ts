/**
 * Client-side DID / wallet sign-in flow (#270).
 *
 * All secrets stay inside the user's wallet extension (Freighter): the client
 * only requests a challenge, asks the wallet to sign it, and forwards the
 * signature to the API. The session token returned by `/auth/did/verify` is a
 * normal session JWT that NextAuth then wraps so the rest of the app keeps
 * using `session.accessToken`.
 */

export type DIDAuthErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'WALLET_REJECTED'
  | 'NO_ACCOUNT'
  | 'WRONG_WALLET'
  | 'CHALLENGE_FAILED'
  | 'CHALLENGE_EXPIRED'
  | 'SIGNATURE_REJECTED'
  | 'VERIFY_FAILED';

export class DIDAuthError extends Error {
  readonly code: DIDAuthErrorCode;

  constructor(code: DIDAuthErrorCode, message: string) {
    super(message);
    this.name = 'DIDAuthError';
    this.code = code;
  }
}

export interface FreighterApi {
  isConnected: () => Promise<boolean>;
  setAllowed: () => Promise<boolean>;
  requestAccess: () => Promise<boolean>;
  getPublicKey: () => Promise<string>;
  signMessage: (
    message: string | { message?: string; messageBuffer?: Uint8Array }
  ) => Promise<string>;
}

export interface DIDChallengeResponse {
  did: string;
  challenge: string;
  expiresAt: string;
}

export interface DIDVerifyResponse {
  success: boolean;
  token: string;
  user: { id: string; email: string; did: string };
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export function getFreighter(
  win: unknown = typeof window !== 'undefined' ? window : null
): FreighterApi | undefined {
  const candidate = (win as { freighterApi?: FreighterApi } | null)?.freighterApi;
  return candidate && typeof candidate.getPublicKey === 'function' ? candidate : undefined;
}

/** Builds the W3C `did:pkh:stellar:<publicKey>` identity string. */
export function didForPublicKey(publicKey: string): string {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new DIDAuthError('NO_ACCOUNT', 'No public key was returned by the wallet.');
  }
  return `did:pkh:stellar:${publicKey}`;
}

/** Extracts the Stellar public key back out of a `did:pkh:stellar:` identity. */
export function publicKeyFromDid(did: string): string | null {
  const prefix = 'did:pkh:stellar:';
  return did.startsWith(prefix) ? did.slice(prefix.length) : null;
}

/**
 * Connects Freighter and resolves the account the user wants to sign in with.
 * Throws typed errors so the UI can surface setup / rejection / cancellation
 * states without swallowing the reason.
 */
export async function connectWallet(
  expectedPublicKey?: string
): Promise<{ publicKey: string; did: string }> {
  const freighter = getFreighter();
  if (!freighter) {
    throw new DIDAuthError(
      'WALLET_NOT_FOUND',
      'Freighter is required for Stellar wallet sign-in. Install the extension and reload.'
    );
  }

  let connected: boolean;
  try {
    connected = await freighter.isConnected();
  } catch {
    connected = false;
  }

  if (!connected) {
    try {
      connected = await freighter.setAllowed();
    } catch {
      throw new DIDAuthError('WALLET_REJECTED', 'The wallet login request was rejected.');
    }
  }

  let publicKey: string;
  try {
    publicKey = await freighter.getPublicKey();
  } catch {
    throw new DIDAuthError('WALLET_REJECTED', 'The wallet login request was rejected.');
  }

  if (!publicKey) {
    throw new DIDAuthError('NO_ACCOUNT', 'No account is connected in Freighter.');
  }

  if (expectedPublicKey && publicKey !== expectedPublicKey) {
    throw new DIDAuthError(
      'WRONG_WALLET',
      `Connected wallet ${publicKey.slice(0, 8)}… does not match the requested account ${expectedPublicKey.slice(0, 8)}….`
    );
  }

  return { publicKey, did: didForPublicKey(publicKey) };
}

/** POSTs to `/auth/did/challenge` and returns the challenge plus expiry. */
export async function requestChallenge(did: string): Promise<DIDChallengeResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/did/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did }),
    });
  } catch {
    throw new DIDAuthError('CHALLENGE_FAILED', 'Could not reach the auth service.');
  }

  const data = (await res.json().catch(() => ({}))) as Partial<DIDChallengeResponse> & {
    error?: string;
  };

  if (!res.ok || !data.challenge) {
    throw new DIDAuthError('CHALLENGE_FAILED', data.error || 'Failed to obtain a sign-in challenge.');
  }

  return { did, challenge: data.challenge, expiresAt: data.expiresAt ?? '' };
}

/** Asks the wallet to sign the challenge; returns the base64 Ed25519 signature. */
export async function signChallenge(challenge: string): Promise<string> {
  const freighter = getFreighter();
  if (!freighter) {
    throw new DIDAuthError('WALLET_NOT_FOUND', 'Freighter is not available to sign the challenge.');
  }

  let signature: string;
  try {
    signature = await freighter.signMessage(challenge);
  } catch {
    throw new DIDAuthError('SIGNATURE_REJECTED', 'The signature request was rejected or cancelled.');
  }

  if (!signature) {
    throw new DIDAuthError('SIGNATURE_REJECTED', 'The wallet returned an empty signature.');
  }
  return signature;
}

/**
 * Verifies the signed challenge against `/auth/did/verify`. On success the API
 * returns a session JWT which the caller hands to NextAuth credentials sign-in.
 */
export async function verifyDid(did: string, challenge: string, signature: string): Promise<DIDVerifyResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/did/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, challenge, signature }),
    });
  } catch {
    throw new DIDAuthError('VERIFY_FAILED', 'Could not reach the auth service.');
  }

  const data = (await res.json().catch(() => ({}))) as Partial<DIDVerifyResponse> & {
    error?: string;
    message?: string;
  };

  if (!res.ok || !data.success || !data.token) {
    const message = data.message || data.error || 'DID verification failed.';
    const expired = /expired|expir|stale|not requested/i.test(message);
    throw new DIDAuthError(expired ? 'CHALLENGE_EXPIRED' : 'VERIFY_FAILED', message);
  }

  return { success: true, token: data.token, user: data.user! };
}