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

/**
 * Sends a WhatsApp payment-receipt alert via the Twilio WhatsApp API, with
 * exponential-backoff retries on rate limits (429) and server errors (5xx).
 */
export async function dispatchWhatsAppAlert(
  phoneNumber: string,
  data: WhatsAppAlertData,
  config: WhatsAppDispatchConfig,
): Promise<WhatsAppDispatchResult> {
  const normalized = normalizeWhatsAppNumber(phoneNumber);
  if (!isValidE164Number(normalized)) {
    throw new WhatsAppInvalidNumberError(phoneNumber);
  }

  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 500;
  const sleep = config.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const body = new URLSearchParams({
    From: `whatsapp:${config.fromNumber}`,
    To: `whatsapp:${normalized}`,
    Body: buildWhatsAppMessage(data),
  });
  const authHeader = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`;

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${TWILIO_API_BASE}/Accounts/${config.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const json: any = await response.json();

      if (response.ok) {
        return { success: true, messageSid: json.sid, status: json.status, attempts: attempt };
      }

      lastError = json.message || `Twilio responded with status ${response.status}`;

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
