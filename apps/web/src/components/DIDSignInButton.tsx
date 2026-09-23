'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  connectWallet,
  requestChallenge,
  signChallenge,
  verifyDid,
  getFreighter,
  DIDAuthError,
} from '@/lib/did-auth';

type Phase =
  | 'idle'
  | 'connecting'
  | 'awaiting-signature'
  | 'signing'
  | 'verifying'
  | 'error';

export interface DIDSignInButtonProps {
  /** Optional label override for the trigger button. */
  label?: string;
  /** Pre-selected account to enforce against (wrong-wallet guard). */
  expectedPublicKey?: string;
  /** Called after a successful session hand-off. */
  onAuthenticated?: () => void;
}

/** Defends against wallet switching between connect and sign. */
export function DIDSignInButton({
  label = 'Continue with Freighter',
  expectedPublicKey,
  onAuthenticated,
}: DIDSignInButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [signedUp, setSignedUp] = useState(false);
  const mountedRef = useRef(true);

  // Allow switching account — clear challenge state when aborted/expired.
  const resetChallenge = useCallback(() => {
    setChallenge(null);
    setExpiresAt(null);
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Challenge expiry countdown + client-side expiry enforcement.
  useEffect(() => {
    if (expiresAt === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setPhase('error');
        setError({ code: 'CHALLENGE_EXPIRED', message: 'The sign-in challenge expired. Request a new one.' });
        resetChallenge();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, resetChallenge]);

  /** Defends against wallet switching between connect and sign. */
  const assertAccountUnchanged = useCallback(async () => {
    const freighter = getFreighter();
    if (!freighter) return;
    const current = await freighter.getPublicKey().catch(() => null);
    if (current && publicKey && current !== publicKey) {
      throw new DIDAuthError(
        'WRONG_WALLET',
        'The Freighter account changed mid-flow. Cancel and sign in with the original wallet.'
      );
    }
  }, [publicKey]);

  const runFlow = useCallback(async () => {
    setError(null);
    resetChallenge();

    try {
      setPhase('connecting');
      const { publicKey: pk, did: didValue } = await connectWallet(expectedPublicKey);
      setPublicKey(pk);
      setDid(didValue);

      setPhase('connecting');
      const challengeData = await requestChallenge(didValue);
      setChallenge(challengeData.challenge);
      setExpiresAt(new Date(challengeData.expiresAt).getTime());
      setPhase('awaiting-signature');
    } catch (err) {
      if (!mountedRef.current) return;
      const e = err as DIDAuthError;
      setError({ code: e.code, message: e.message });
      setPhase('error');
      setPublicKey(null);
      setDid(null);
      resetChallenge();
    }
  }, [expectedPublicKey, resetChallenge]);

  const signAndVerify = useCallback(async () => {
    if (!did || !challenge) return;
    setError(null);
    setPhase('signing');

    try {
      await assertAccountUnchanged();
      const signature = await signChallenge(challenge);
      setPhase('verifying');
      const result = await verifyDid(did, challenge, signature);
      setPhase('connecting');
      const res = await signIn('credentials', { token: result.token, mode: 'did', redirect: false });
      if (!res?.ok || res.error) {
        throw new DIDAuthError('VERIFY_FAILED', 'The session could not be established.');
      }
      setSignedUp(true);
      resetChallenge();
      setPublicKey(null);
      setDid(null);
      onAuthenticated?.();
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      const e = err as DIDAuthError;
      setError({ code: e.code, message: e.message });
      setPhase('error');
      resetChallenge();
    }
  }, [did, challenge, assertAccountUnchanged, onAuthenticated, resetChallenge, router]);

  const cancel = useCallback(() => {
    setPhase('idle');
    setError(null);
    setPublicKey(null);
    setDid(null);
    resetChallenge();
  }, [resetChallenge]);

  const awaitingSignature = phase === 'awaiting-signature';

  return (
    <div className="w-full space-y-3" data-testid="did-sign-in-button">
      {(phase === 'idle' || phase === 'error') && (
        <button
          type="button"
          onClick={runFlow}
          data-testid="did-sign-in-trigger"
          className="w-full py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white font-bold text-sm transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4 text-cyan-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
          {label}
        </button>
      )}

      {phase === 'connecting' && (
        <div className="py-3.5 rounded-xl bg-white/5 border border-white/15 text-sm text-gray-300 flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          Connecting to wallet…
        </div>
      )}

      {awaitingSignature && !signedUp && (
        <div className="space-y-3 animate-in fade-in">
          <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-gray-300">
            <p className="font-bold text-cyan-300 mb-1">Approve the signature in Freighter</p>
            <p className="break-all font-mono text-[11px]">{challenge}</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span
              data-testid="did-challenge-countdown"
              className={`text-xs font-semibold ${(secondsLeft ?? 0) <= 10 ? 'text-red-400' : 'text-gray-400'}`}
            >
              Challenge expires in {secondsLeft ?? '…'}s
            </span>
            <button
              type="button"
              onClick={cancel}
              className="text-xs text-gray-400 hover:text-white underline cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <button
            type="button"
            onClick={signAndVerify}
            disabled={challenge === null}
            data-testid="did-sign-challenge"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm transition-all cursor-pointer disabled:opacity-50"
          >
            I've signed it — continue
          </button>
        </div>
      )}

      {(phase === 'signing' || phase === 'verifying') && (
        <div className="py-3.5 rounded-xl bg-white/5 border border-white/15 text-sm text-gray-300 flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          {phase === 'signing' ? 'Waiting for wallet signature…' : 'Verifying signature…'}
        </div>
      )}

      {error && phase === 'error' && (
        <div className="space-y-2" role="alert">
          <p data-testid="did-sign-in-error" className="px-3 py-2.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-300">
            {error.message}
          </p>
          <button
            type="button"
            onClick={runFlow}
            className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-semibold text-gray-200 transition-all cursor-pointer"
          >
            Try again{error.code === 'CHALLENGE_EXPIRED' ? ' (get a fresh challenge)' : ''}
          </button>
        </div>
      )}
    </div>
  );
}