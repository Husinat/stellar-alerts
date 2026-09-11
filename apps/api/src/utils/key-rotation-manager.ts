import crypto from 'crypto';

export interface WebhookSignature {
  headerValue: string;
  nonce: string;
}

export interface DualWebhookSignature {
  primary: WebhookSignature;
  secondary?: WebhookSignature;
}

export interface WebhookKeyState {
  activeSecret: string;
  previousSecret?: string | null;
  previousActivatedAt?: Date | null;
}

export class KeyRotationManager {
  static readonly GRACE_PERIOD_MS = 48 * 60 * 60 * 1000;

  private keyStates = new Map<string, WebhookKeyState>();

  public setKeyState(webhookId: string, state: WebhookKeyState): void {
    this.keyStates.set(webhookId, state);
  }

  public getKeyState(webhookId: string): WebhookKeyState | undefined {
    return this.keyStates.get(webhookId);
  }

  public rotateKey(webhookId: string, newSecret: string): WebhookKeyState {
    const current = this.keyStates.get(webhookId);
    const previousSecret = current?.activeSecret ?? null;
    const previousActivatedAt = previousSecret ? new Date() : null;
    const state: WebhookKeyState = {
      activeSecret: newSecret,
      previousSecret,
      previousActivatedAt,
    };
    this.keyStates.set(webhookId, state);
    return state;
  }

  public sign(payload: string, webhookId: string): DualWebhookSignature {
    const state = this.keyStates.get(webhookId);
    if (!state) {
      throw new Error(`No key state registered for webhook "${webhookId}"`);
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();

    const primary = this.signWithNonce(payload, state.activeSecret, nonce, timestamp);
    let secondary: WebhookSignature | undefined;

    if (state.previousSecret && state.previousActivatedAt) {
      const age = Date.now() - state.previousActivatedAt.getTime();
      if (age < KeyRotationManager.GRACE_PERIOD_MS) {
        secondary = this.signWithNonce(payload, state.previousSecret, nonce, timestamp);
      } else {
        // Auto-retire the old key after the grace period has elapsed.
        state.previousSecret = null;
        state.previousActivatedAt = null;
      }
    }

    return { primary, secondary };
  }

  private signWithNonce(payload: string, secret: string, nonce: string, timestamp: number): WebhookSignature {
    const signingPayload = `${timestamp}.${nonce}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(signingPayload).digest('hex');
    return {
      headerValue: `t=${timestamp},v1=${signature}`,
      nonce,
    };
  }
}
