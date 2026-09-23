import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildWhatsAppMessage,
  dispatchWhatsAppAlert,
  isValidE164Number,
  normalizeWhatsAppNumber,
  WhatsAppInvalidNumberError,
} from '../whatsapp';

const baseData = {
  paymentId: 'pay_123',
  txHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  amount: '100.5000000',
  asset: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  fromAddress: 'GABC123456789',
  receivedAt: '2026-08-25T12:00:00.000Z',
};

const baseConfig = {
  accountSid: 'AC_test_sid',
  authToken: 'test_auth_token',
  fromNumber: '+14155238886',
  sleep: vi.fn().mockResolvedValue(undefined),
};

describe('isValidE164Number', () => {
  it('accepts valid E.164 numbers', () => {
    expect(isValidE164Number('+14155238886')).toBe(true);
    expect(isValidE164Number('+2348012345678')).toBe(true);
  });

  it('rejects numbers missing the leading +, containing letters, or too short', () => {
    expect(isValidE164Number('14155238886')).toBe(false);
    expect(isValidE164Number('+1abc5238886')).toBe(false);
    expect(isValidE164Number('+1')).toBe(false);
    expect(isValidE164Number('')).toBe(false);
  });
});

describe('normalizeWhatsAppNumber', () => {
  it('strips a leading whatsapp: prefix and trims whitespace', () => {
    expect(normalizeWhatsAppNumber('whatsapp:+14155238886')).toBe('+14155238886');
    expect(normalizeWhatsAppNumber('  +14155238886  ')).toBe('+14155238886');
  });
});

describe('buildWhatsAppMessage', () => {
  it('formats the payment receipt with amount, asset, sender, and tx hash', () => {
    const message = buildWhatsAppMessage(baseData);

    expect(message).toContain('*Stellar Payment Received*');
    expect(message).toContain('Amount: 100.5000000 USDC (GA5Z...KZVN)');
    expect(message).toContain('From: GABC123456789');
    expect(message).toContain(`Tx: ${baseData.txHash}`);
  });

  it('labels native XLM without an issuer badge', () => {
    const message = buildWhatsAppMessage({ ...baseData, asset: 'XLM', assetIssuer: null });
    expect(message).toContain('Amount: 100.5000000 XLM');
  });

  it('escapes WhatsApp markdown tokens in untrusted fields', () => {
    const message = buildWhatsAppMessage({ ...baseData, fromAddress: '*bold* text' });
    expect(message).toContain('From: \\*bold\\* text');
  });
});

describe('dispatchWhatsAppAlert', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    baseConfig.sleep.mockClear();
  });

  it('throws WhatsAppInvalidNumberError for a malformed destination number without calling Twilio', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(dispatchWhatsAppAlert('not-a-number', baseData, baseConfig)).rejects.toThrow(
      WhatsAppInvalidNumberError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the message and returns the Twilio message SID on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'SM123', status: 'queued' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchWhatsAppAlert('+14155551234', baseData, baseConfig);

    expect(result).toEqual({ success: true, messageSid: 'SM123', status: 'queued', attempts: 1 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json');
    expect(options.headers.Authorization).toMatch(/^Basic /);
    const sentBody = new URLSearchParams(options.body);
    expect(sentBody.get('From')).toBe('whatsapp:+14155238886');
    expect(sentBody.get('To')).toBe('whatsapp:+14155551234');
    expect(sentBody.get('Body')).toContain('Stellar Payment Received');
  });

  it('does not retry on a non-retryable 4xx error (e.g. opted-out recipient)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: async () => ({ message: 'The number is not opted in.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchWhatsAppAlert('+14155551234', baseData, baseConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBe('The number is not opted in.');
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff on a 429 rate limit and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '1' }),
        json: async () => ({ message: 'Too many requests' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ sid: 'SM456', status: 'queued' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchWhatsAppAlert('+14155551234', baseData, baseConfig);

    expect(result).toEqual({ success: true, messageSid: 'SM456', status: 'queued', attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(baseConfig.sleep).toHaveBeenCalledWith(1000);
  });

  it('retries transient network errors and gives up after maxAttempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unreachable'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchWhatsAppAlert('+14155551234', baseData, { ...baseConfig, maxAttempts: 3 });

    expect(result).toEqual({ success: false, error: 'network unreachable', attempts: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
