export interface WhatsAppAlertData {
  paymentId: string;
  txHash: string;
  amount: string;
  asset: string;
  assetIssuer?: string | null;
  fromAddress: string;
  receivedAt: string;
}

export interface WhatsAppDispatchConfig {
  accountSid: string;
  authToken: string;
  /** Twilio WhatsApp-enabled sender number, e.g. "+14155238886" (no "whatsapp:" prefix). */
  fromNumber: string;
  /** Max delivery attempts, including the first one. Defaults to 3. */
  maxAttempts?: number;
  /** Base delay (ms) for exponential backoff between retries. Defaults to 500ms. */
  baseDelayMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface WhatsAppDispatchResult {
  success: boolean;
  messageSid?: string;
  status?: string;
  error?: string;
  attempts: number;
}

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/** Validates a phone number as E.164 (required format for Twilio WhatsApp numbers). */
export function isValidE164Number(value: string): boolean {
  return typeof value === 'string' && E164_PATTERN.test(value.trim());
}

/** Strips a leading "whatsapp:" prefix, if present, and trims whitespace. */
export function normalizeWhatsAppNumber(value: string): string {
  return value.trim().replace(/^whatsapp:/i, '');
}

function escapeForWhatsApp(value: string): string {
  // WhatsApp uses a lightweight markdown dialect where *, _, ~ and ``` are
  // formatting tokens; escape them so untrusted fields can't break layout.
  return value.replace(/([*_~`])/g, '\\$1');
}

/** Builds the plain-text, WhatsApp-markdown-formatted payment receipt message. */
export function buildWhatsAppMessage(data: WhatsAppAlertData): string {
  const assetLabel =
    data.asset === 'XLM' || data.asset === 'native'
      ? 'XLM'
      : data.assetIssuer
        ? `${data.asset} (${data.assetIssuer.slice(0, 4)}...${data.assetIssuer.slice(-4)})`
        : data.asset;

  return [
    '*Stellar Payment Received*',
    `Amount: ${escapeForWhatsApp(data.amount)} ${escapeForWhatsApp(assetLabel)}`,
    `From: ${escapeForWhatsApp(data.fromAddress)}`,
    `Tx: ${escapeForWhatsApp(data.txHash)}`,
    `Received: ${escapeForWhatsApp(data.receivedAt)}`,
  ].join('\n');
}

export class WhatsAppInvalidNumberError extends Error {
  constructor(number: string) {
    super(`"${number}" is not a valid E.164 WhatsApp number`);
    this.name = 'WhatsAppInvalidNumberError';
  }
}

function parseRetryAfterMs(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

import { env } from '../config/env';
import { fetchWithTimeout } from '../lib/external-request';

export async function dispatchWhatsAppAlert(
  phoneNumber: string,
  data: AlertJobData,
  language: string = 'EN',
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const whatsappApiUrl =
    process.env.WHATSAPP_API_URL ||
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID || '100000000000000'}/messages`;
  const whatsappToken = process.env.WHATSAPP_API_TOKEN || 'mock_whatsapp_token';

  const payload = buildWhatsAppCloudPayload(phoneNumber, data, language);
  const timeoutMs = options.timeoutMs ?? env.NOTIFICATION_PROVIDER_TIMEOUT_MS;

  try {
    const res = await fetchWithTimeout(
      whatsappApiUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      options.signal,
      'WhatsApp',
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[WhatsAppWorker] Cloud API returned error ${res.status}: ${errorText}`);
      return false;
    }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        return { success: false, error: lastError, attempts: attempt };
      }

      const retryAfterMs = parseRetryAfterMs(response.headers);
      await sleep(retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1));
    } catch (error: any) {
      lastError = error.message || 'Unknown network error';
      if (attempt === maxAttempts) {
        return { success: false, error: lastError, attempts: attempt };
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  return { success: false, error: lastError, attempts: maxAttempts };
}
