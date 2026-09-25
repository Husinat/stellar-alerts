'use client';

import React, { useEffect, useState } from 'react';
import { isValidStellarPublicKey } from '@stellar-alerts/shared';

export type OnboardingStepId = 'wallet' | 'telegram' | 'preferences';

export interface OnboardingPreferences {
  emailEnabled: boolean;
  telegramEnabled: boolean;
}

export interface TestPingOutcome {
  success: boolean;
  message: string;
}

export interface OnboardingWizardProps {
  isOpen: boolean;
  onClose?: () => void;
  /** Registers the Stellar public key as a watched wallet. */
  onConnectWallet: (publicKey: string) => Promise<void>;
  /** Links the given Telegram chat ID to the user's account. */
  onLinkTelegram: (chatId: string) => Promise<void>;
  /** Sends a test message on the already-linked Telegram chat. */
  onSendTestPing: () => Promise<TestPingOutcome>;
  /** Persists the final channel preferences. */
  onSavePreferences: (preferences: OnboardingPreferences) => Promise<void>;
  /** Called once the wizard is fully complete and the user activates alerts. */
  onActivate: () => Promise<void> | void;
  /** localStorage key used to persist/resume wizard progress. */
  storageKey?: string;
}

interface PersistedWizardState {
  stepIndex: number;
  walletPublicKey: string;
  telegramChatId: string;
  emailEnabled: boolean;
  telegramEnabled: boolean;
  completedSteps: OnboardingStepId[];
}

const STEPS: { id: OnboardingStepId; title: string }[] = [
  { id: 'wallet', title: 'Connect Wallet' },
  { id: 'telegram', title: 'Link Telegram' },
  { id: 'preferences', title: 'Notification Preferences' },
];

const DEFAULT_STORAGE_KEY = 'stellar-alerts-onboarding-wizard';

function defaultState(): PersistedWizardState {
  return {
    stepIndex: 0,
    walletPublicKey: '',
    telegramChatId: '',
    emailEnabled: true,
    telegramEnabled: true,
    completedSteps: [],
  };
}

function loadPersisted(storageKey: string): PersistedWizardState {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function savePersisted(storageKey: string, state: PersistedWizardState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Best-effort only (e.g. private browsing storage quota); losing resume
    // state is not fatal, the wizard still works for the current session.
  }
}

function clearPersisted(storageKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  isOpen,
  onClose,
  onConnectWallet,
  onLinkTelegram,
  onSendTestPing,
  onSavePreferences,
  onActivate,
  storageKey = DEFAULT_STORAGE_KEY,
}) => {
  const [state, setState] = useState<PersistedWizardState>(() => loadPersisted(storageKey));
  const [errors, setErrors] = useState<Partial<Record<OnboardingStepId, string>>>({});
  const [submittingStep, setSubmittingStep] = useState<OnboardingStepId | null>(null);
  const [testPing, setTestPing] = useState<TestPingOutcome | null>(null);
  const [testPingLoading, setTestPingLoading] = useState(false);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    savePersisted(storageKey, state);
  }, [storageKey, state]);

  if (!isOpen) return null;

  const currentStep = STEPS[state.stepIndex];
  const isStepComplete = (id: OnboardingStepId) => state.completedSteps.includes(id);

  const markComplete = (id: OnboardingStepId) => {
    setState((prev) => ({
      ...prev,
      completedSteps: prev.completedSteps.includes(id) ? prev.completedSteps : [...prev.completedSteps, id],
    }));
  };

  const goToStep = (index: number) => {
    setErrors({});
    setState((prev) => ({ ...prev, stepIndex: index }));
  };

  const goBack = () => {
    if (state.stepIndex > 0) goToStep(state.stepIndex - 1);
  };

  const handleWalletSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const publicKey = state.walletPublicKey.trim();

    if (!isValidStellarPublicKey(publicKey)) {
      setErrors((prev) => ({ ...prev, wallet: 'Enter a valid Stellar public key (starts with "G", 56 characters).' }));
      return;
    }

    setErrors((prev) => ({ ...prev, wallet: undefined }));
    setSubmittingStep('wallet');
    try {
      await onConnectWallet(publicKey);
      markComplete('wallet');
      goToStep(1);
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, wallet: err?.message || 'Failed to connect wallet. Please try again.' }));
    } finally {
      setSubmittingStep(null);
    }
  };

  const handleTelegramSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const chatId = state.telegramChatId.trim();

    if (!chatId) {
      setErrors((prev) => ({ ...prev, telegram: 'Enter your Telegram chat ID.' }));
      return;
    }

    setErrors((prev) => ({ ...prev, telegram: undefined }));
    setSubmittingStep('telegram');
    try {
      await onLinkTelegram(chatId);
      markComplete('telegram');
      setTestPing(null);
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, telegram: err?.message || 'Failed to link Telegram. Please try again.' }));
    } finally {
      setSubmittingStep(null);
    }
  };

  const handleSendTestPing = async () => {
    setTestPingLoading(true);
    setTestPing(null);
    try {
      const result = await onSendTestPing();
      setTestPing(result);
    } catch (err: any) {
      setTestPing({ success: false, message: err?.message || 'Failed to send test ping.' });
    } finally {
      setTestPingLoading(false);
    }
  };

  const handleActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors((prev) => ({ ...prev, preferences: undefined }));
    setSubmittingStep('preferences');
    try {
      await onSavePreferences({ emailEnabled: state.emailEnabled, telegramEnabled: state.telegramEnabled });
      markComplete('preferences');
      await onActivate();
      setActivated(true);
      clearPersisted(storageKey);
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, preferences: err?.message || 'Failed to save preferences. Please try again.' }));
    } finally {
      setSubmittingStep(null);
    }
  };

  if (activated) {
    return (
      <div role="status" aria-live="polite" className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200">
        <h2 className="text-lg font-bold text-white mb-1">🎉 Alerts activated</h2>
        <p className="text-sm">Your wallet and notification channels are set up. You&apos;re all done.</p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl">
      <nav aria-label="Onboarding steps">
        <ol className="flex items-center gap-2 mb-6">
          {STEPS.map((step, index) => {
            const complete = isStepComplete(step.id);
            const current = index === state.stepIndex;
            return (
              <li key={step.id} className="flex-1">
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  aria-label={`Step ${index + 1}: ${step.title}${complete ? ' (complete)' : ''}`}
                  disabled={!complete && !current}
                  onClick={() => (complete || current) && goToStep(index)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    current
                      ? 'bg-purple-600 text-white'
                      : complete
                        ? 'bg-emerald-600/30 text-emerald-200'
                        : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {complete ? '✓ ' : `${index + 1}. `}
                  {step.title}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {currentStep.id === 'wallet' && (
        <form onSubmit={handleWalletSubmit} className="space-y-4" aria-labelledby="onboarding-step-title">
          <h2 id="onboarding-step-title" className="text-lg font-bold text-white">
            Connect your Stellar wallet
          </h2>
          <div>
            <label htmlFor="onboarding-wallet-address" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Stellar Public Key
            </label>
            <input
              id="onboarding-wallet-address"
              type="text"
              value={state.walletPublicKey}
              onChange={(e) => setState((prev) => ({ ...prev, walletPublicKey: e.target.value }))}
              placeholder="G..."
              aria-invalid={Boolean(errors.wallet)}
              aria-describedby={errors.wallet ? 'onboarding-wallet-error' : undefined}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm font-mono"
            />
          </div>
          {errors.wallet && (
            <p id="onboarding-wallet-error" role="alert" className="text-sm text-red-300">
              {errors.wallet}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submittingStep === 'wallet'}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-sm"
            >
              {submittingStep === 'wallet' ? 'Connecting…' : 'Continue'}
            </button>
          </div>
        </form>
      )}

      {currentStep.id === 'telegram' && (
        <form onSubmit={handleTelegramSubmit} className="space-y-4" aria-labelledby="onboarding-step-title">
          <h2 id="onboarding-step-title" className="text-lg font-bold text-white">
            Link your Telegram chat
          </h2>
          <div>
            <label htmlFor="onboarding-telegram-chat-id" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Telegram Chat ID
            </label>
            <input
              id="onboarding-telegram-chat-id"
              type="text"
              value={state.telegramChatId}
              onChange={(e) => {
                const value = e.target.value;
                setState((prev) => ({
                  ...prev,
                  telegramChatId: value,
                  completedSteps: prev.completedSteps.filter((id) => id !== 'telegram'),
                }));
                setTestPing(null);
              }}
              placeholder="e.g. 123456789"
              aria-invalid={Boolean(errors.telegram)}
              aria-describedby={errors.telegram ? 'onboarding-telegram-error' : undefined}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm font-mono"
            />
          </div>
          {errors.telegram && (
            <p id="onboarding-telegram-error" role="alert" className="text-sm text-red-300">
              {errors.telegram}
            </p>
          )}

          {isStepComplete('telegram') && (
            <div className="space-y-2 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <p className="text-sm text-emerald-200">✓ Telegram chat linked.</p>
              <button
                type="button"
                onClick={handleSendTestPing}
                disabled={testPingLoading}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-medium"
              >
                {testPingLoading ? 'Sending test ping…' : 'Send Test Ping'}
              </button>
              {testPing && (
                <p role="status" aria-live="polite" className={`text-sm ${testPing.success ? 'text-emerald-300' : 'text-red-300'}`}>
                  {testPing.message}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
            >
              Back
            </button>
            {isStepComplete('telegram') ? (
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm"
              >
                Continue
              </button>
            ) : (
              <button
                type="submit"
                disabled={submittingStep === 'telegram'}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium text-sm"
              >
                {submittingStep === 'telegram' ? 'Linking…' : 'Link Telegram'}
              </button>
            )}
          </div>
        </form>
      )}

      {currentStep.id === 'preferences' && (
        <form onSubmit={handleActivate} className="space-y-4" aria-labelledby="onboarding-step-title">
          <h2 id="onboarding-step-title" className="text-lg font-bold text-white">
            Choose your notification channels
          </h2>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <label htmlFor="onboarding-email-enabled" className="text-sm font-medium text-white">
              Email Receipts
            </label>
            <input
              id="onboarding-email-enabled"
              type="checkbox"
              checked={state.emailEnabled}
              onChange={(e) => setState((prev) => ({ ...prev, emailEnabled: e.target.checked }))}
              className="w-4 h-4 rounded accent-purple-600"
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <label htmlFor="onboarding-telegram-enabled" className="text-sm font-medium text-white">
              Telegram Alerts
            </label>
            <input
              id="onboarding-telegram-enabled"
              type="checkbox"
              checked={state.telegramEnabled}
              onChange={(e) => setState((prev) => ({ ...prev, telegramEnabled: e.target.checked }))}
              className="w-4 h-4 rounded accent-purple-600"
            />
          </div>

          {errors.preferences && (
            <p role="alert" className="text-sm text-red-300">
              {errors.preferences}
            </p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={goBack}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submittingStep === 'preferences'}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm"
            >
              {submittingStep === 'preferences' ? 'Activating…' : 'Activate Alerts'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
