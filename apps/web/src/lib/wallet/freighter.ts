/**
 * Thin wrapper around @stellar/freighter-api that normalizes the
 * extension's ad-hoc `{ ...data, error? }` responses into typed
 * results/errors we can branch on safely from UI code, and that never
 * throws for expected conditions (extension missing, user rejected).
 */
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getNetworkDetails as freighterGetNetworkDetails,
} from '@stellar/freighter-api';
import { looksLikeStellarPublicKey } from './strkey';

export type FreighterConnectErrorCode =
  | 'NOT_INSTALLED'
  | 'REJECTED'
  | 'MALFORMED_ADDRESS'
  | 'UNKNOWN';

export class FreighterConnectError extends Error {
  code: FreighterConnectErrorCode;

  constructor(code: FreighterConnectErrorCode, message: string) {
    super(message);
    this.name = 'FreighterConnectError';
    this.code = code;
  }
}

export interface FreighterConnectResult {
  publicKey: string;
  network?: string;
  networkPassphrase?: string;
}

function isRejectionMessage(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const normalized = message.toLowerCase();
  return normalized.includes('declin') || normalized.includes('reject') || normalized.includes('denied');
}

/**
 * Detects extension presence without prompting the user. Freighter injects
 * a global on `window`, but the safest check is calling isConnected(),
 * which resolves false (never throws) when the extension isn't installed.
 */
export async function isFreighterAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const result = await freighterIsConnected();
    return Boolean(result?.isConnected) && !result?.error;
  } catch {
    return false;
  }
}

/**
 * Triggers the Freighter connect/authorize prompt and returns the selected
 * public key. Safe to call even if the extension isn't installed or the
 * user rejects the request — both surface as a FreighterConnectError
 * instead of throwing an unhandled/native error.
 */
export async function connectFreighter(): Promise<FreighterConnectResult> {
  let accessResult;
  try {
    accessResult = await freighterRequestAccess();
  } catch (err: any) {
    if (isRejectionMessage(err?.message)) {
      throw new FreighterConnectError('REJECTED', 'Connection request was declined in Freighter.');
    }
    throw new FreighterConnectError('NOT_INSTALLED', 'Freighter wallet extension was not detected.');
  }

  if (accessResult?.error) {
    const message = typeof accessResult.error === 'string' ? accessResult.error : String(accessResult.error);
    if (isRejectionMessage(message)) {
      throw new FreighterConnectError('REJECTED', 'Connection request was declined in Freighter.');
    }
    throw new FreighterConnectError('NOT_INSTALLED', message || 'Freighter wallet extension was not detected.');
  }

  const publicKey = accessResult?.address;
  if (!publicKey || !looksLikeStellarPublicKey(publicKey)) {
    throw new FreighterConnectError(
      'MALFORMED_ADDRESS',
      'Freighter returned an address that is not a valid Stellar public key.'
    );
  }

  let network: string | undefined;
  let networkPassphrase: string | undefined;
  try {
    const details = await freighterGetNetworkDetails();
    if (details && !details.error) {
      network = details.network;
      networkPassphrase = details.networkPassphrase;
    }
  } catch {
    // Network details are informational only; connection already succeeded.
  }

  return { publicKey, network, networkPassphrase };
}
