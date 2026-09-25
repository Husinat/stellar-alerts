import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingWizard, OnboardingWizardProps } from './OnboardingWizard';

const VALID_KEY = 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSFMG4BVI';

function makeProps(overrides: Partial<OnboardingWizardProps> = {}): OnboardingWizardProps {
  return {
    isOpen: true,
    onConnectWallet: vi.fn().mockResolvedValue(undefined),
    onLinkTelegram: vi.fn().mockResolvedValue(undefined),
    onSendTestPing: vi.fn().mockResolvedValue({ success: true, message: 'Test ping delivered.' }),
    onSavePreferences: vi.fn().mockResolvedValue(undefined),
    onActivate: vi.fn().mockResolvedValue(undefined),
    storageKey: `onboarding-test-${Math.random()}`,
    ...overrides,
  };
}

async function completeWalletStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Stellar Public Key'), VALID_KEY);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

async function completeTelegramStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Telegram Chat ID'), '123456789');
  await user.click(screen.getByRole('button', { name: 'Link Telegram' }));
  await user.click(await screen.findByRole('button', { name: 'Continue' }));
}

describe('OnboardingWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<OnboardingWizard {...makeProps({ isOpen: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('validates the wallet public key before continuing', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<OnboardingWizard {...props} />);

    await user.type(screen.getByLabelText('Stellar Public Key'), 'not-a-valid-key');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid stellar public key/i);
    expect(props.onConnectWallet).not.toHaveBeenCalled();
  });

  it('advances wallet → telegram → preferences on valid input and successful calls', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<OnboardingWizard {...props} />);

    await completeWalletStep(user);
    expect(props.onConnectWallet).toHaveBeenCalledWith(VALID_KEY);
    expect(await screen.findByLabelText('Telegram Chat ID')).toBeInTheDocument();

    await completeTelegramStep(user);
    expect(props.onLinkTelegram).toHaveBeenCalledWith('123456789');
    expect(await screen.findByText(/notification channels/i)).toBeInTheDocument();
  });

  it('sends a test ping after linking Telegram and shows the result', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<OnboardingWizard {...props} />);

    await completeWalletStep(user);
    await user.type(screen.getByLabelText('Telegram Chat ID'), '123456789');
    await user.click(screen.getByRole('button', { name: 'Link Telegram' }));

    await user.click(await screen.findByRole('button', { name: 'Send Test Ping' }));

    expect(props.onSendTestPing).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Test ping delivered.');
  });

  it('activates alerts from the final step and calls onSavePreferences then onActivate', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<OnboardingWizard {...props} />);

    await completeWalletStep(user);
    await completeTelegramStep(user);

    await user.click(screen.getByRole('button', { name: 'Activate Alerts' }));

    expect(props.onSavePreferences).toHaveBeenCalledWith({ emailEnabled: true, telegramEnabled: true });
    expect(props.onActivate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/alerts activated/i)).toBeInTheDocument();
  });

  describe('back navigation', () => {
    it('returns to a previous completed step without losing entered data', async () => {
      const user = userEvent.setup();
      const props = makeProps();
      render(<OnboardingWizard {...props} />);

      await completeWalletStep(user);
      await completeTelegramStep(user);

      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(await screen.findByLabelText('Telegram Chat ID')).toHaveValue('123456789');

      await user.click(screen.getByRole('button', { name: /step 1/i }));
      expect(await screen.findByLabelText('Stellar Public Key')).toHaveValue(VALID_KEY);
    });
  });

  describe('refresh / resume', () => {
    it('restores progress after the component remounts (simulating a page refresh)', async () => {
      const user = userEvent.setup();
      const storageKey = `onboarding-resume-${Math.random()}`;
      const props = makeProps({ storageKey });

      const { unmount } = render(<OnboardingWizard {...props} />);
      await completeWalletStep(user);
      await user.type(screen.getByLabelText('Telegram Chat ID'), '987654321');
      unmount();

      render(<OnboardingWizard {...props} />);

      // Resumes on the Telegram step with the previously entered (unsaved) chat ID retained.
      expect(await screen.findByLabelText('Telegram Chat ID')).toHaveValue('987654321');
      // Step 1 remains marked complete in the step indicator.
      expect(screen.getByRole('button', { name: /step 1.*complete/i })).toBeInTheDocument();
    });
  });

  describe('partial failure recovery', () => {
    it('keeps the entered wallet value and lets the user retry after a failed connect', async () => {
      const user = userEvent.setup();
      const onConnectWallet = vi.fn().mockRejectedValueOnce(new Error('Wallet service unavailable'));
      const props = makeProps({ onConnectWallet });
      render(<OnboardingWizard {...props} />);

      await user.type(screen.getByLabelText('Stellar Public Key'), VALID_KEY);
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Wallet service unavailable');
      expect(screen.getByLabelText('Stellar Public Key')).toHaveValue(VALID_KEY);

      onConnectWallet.mockResolvedValueOnce(undefined);
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByLabelText('Telegram Chat ID')).toBeInTheDocument();
      expect(onConnectWallet).toHaveBeenCalledTimes(2);
    });

    it('preserves a completed wallet step when the telegram step fails', async () => {
      const user = userEvent.setup();
      const onLinkTelegram = vi.fn().mockRejectedValueOnce(new Error('Bot could not reach that chat'));
      const props = makeProps({ onLinkTelegram });
      render(<OnboardingWizard {...props} />);

      await completeWalletStep(user);
      await user.type(screen.getByLabelText('Telegram Chat ID'), '123456789');
      await user.click(screen.getByRole('button', { name: 'Link Telegram' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Bot could not reach that chat');
      // Wallet step is still marked complete; failure on step 2 didn't roll it back.
      expect(screen.getByRole('button', { name: /step 1.*complete/i })).toBeInTheDocument();
    });
  });

  describe('accessible form controls', () => {
    it('associates every input with a label and exposes step position via aria-current', async () => {
      render(<OnboardingWizard {...makeProps()} />);

      expect(screen.getByLabelText('Stellar Public Key')).toBeInTheDocument();
      const currentStepButton = screen.getByRole('button', { name: /step 1/i });
      expect(currentStepButton).toHaveAttribute('aria-current', 'step');
    });

    it('surfaces validation errors as an accessible alert tied to the invalid field', async () => {
      const user = userEvent.setup();
      render(<OnboardingWizard {...makeProps()} />);

      await user.click(screen.getByRole('button', { name: 'Continue' }));

      const input = screen.getByLabelText('Stellar Public Key');
      const alert = await screen.findByRole('alert');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', alert.id);
    });
  });
});
