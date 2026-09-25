import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EmailService,
  RetriableEmailError,
  PermanentEmailError,
  sanitizeEmailErrorMessage,
} from '../email.service';
import {
  renderPaymentReceiptTemplate,
  renderPaymentFailureTemplate,
  escapeHtml,
} from '../templates/email.templates';

vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: vi.fn(),
      },
    })),
  };
});

describe('Issue #263: Resend Email Delivery & Templates', () => {
  describe('HTML Escaping & Security', () => {
    it('escapes special characters to prevent HTML injection / XSS', () => {
      const malicious = '<script>alert("XSS")</script>&foo="bar"\'baz\'';
      const escaped = escapeHtml(malicious);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&amp;foo=');
      expect(escaped).toContain('&quot;bar&quot;');
      expect(escaped).toContain('&#39;baz&#39;');
    });
  });

  describe('Template Rendering & Snapshot Testing', () => {
    it('renders payment receipt template v1 with version headers and escaped fields', () => {
      const result = renderPaymentReceiptTemplate({
        paymentId: 'pay_999_<script>',
        txHash: '0x1234567890abcdef',
        amount: '250.00',
        asset: 'USDC',
        assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335WFOPVQOI3M7G73X2D4J80000',
        fromAddress: 'GUSER1234567890',
        receivedAt: '2026-09-23T12:00:00Z',
        recipientEmail: 'user@example.com',
      });

      expect(result.version).toBe('v1');
      expect(result.subject).toBe('[Stellar Alerts] Payment Received: 250.00 USDC');
      expect(result.html).toContain('content="v1"');
      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('pay_999_&lt;script&gt;');
      expect(result.html).toContain('USDC');
      expect(result.text).toContain('Stellar Payment Received: 250.00 USDC');

      // Snapshot test
      expect(result.html).toMatchSnapshot();
    });

    it('renders failure notification template v1 with error details and version headers', () => {
      const result = renderPaymentFailureTemplate({
        alertId: 'job_dlq_001',
        txHash: '0xDEADBEEF',
        errorReason: 'HTTP 500 Server Error on webhook target endpoint',
        timestamp: '2026-09-23T12:05:00Z',
        recipientEmail: 'user@example.com',
      });

      expect(result.version).toBe('v1');
      expect(result.subject).toBe('[Stellar Alerts] Alert Delivery Failure Notice');
      expect(result.html).toContain('job_dlq_001');
      expect(result.html).toContain('HTTP 500 Server Error');
      expect(result.text).toContain('Alert Delivery Failure Notice');

      // Snapshot test
      expect(result.html).toMatchSnapshot();
    });
  });

  describe('Secret Sanitization', () => {
    it('masks Resend API keys in error messages', () => {
      const rawError = 'Failed to connect using key re_1234567890abcdef_secret_key_value';
      const sanitized = sanitizeEmailErrorMessage(rawError);
      expect(sanitized).not.toContain('re_1234567890abcdef_secret_key_value');
      expect(sanitized).toContain('re_****************');
    });

    it('masks Bearer tokens in error messages', () => {
      const rawError = 'Unauthorized Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid';
      const sanitized = sanitizeEmailErrorMessage(rawError);
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(sanitized).toContain('Bearer ****************');
    });
  });

  describe('User Notification Preferences Enforcement', () => {
    it('skips email dispatch when emailEnabled is false', async () => {
      const service = new EmailService('re_test_key_123');
      const result = await service.sendPaymentReceipt(
        { recipientEmail: 'test@example.com', emailEnabled: false },
        {
          paymentId: 'pay_1',
          txHash: 'tx_1',
          amount: '10',
          asset: 'XLM',
          fromAddress: 'G123',
          receivedAt: '2026-09-23T10:00:00Z',
        }
      );

      expect(result.skipped).toBe(true);
    });

    it('throws PermanentEmailError when recipient email is missing or malformed', async () => {
      const service = new EmailService('re_test_key_123');
      await expect(
        service.sendPaymentReceipt(
          { recipientEmail: 'invalid-email-address', emailEnabled: true },
          {
            paymentId: 'pay_1',
            txHash: 'tx_1',
            amount: '10',
            asset: 'XLM',
            fromAddress: 'G123',
            receivedAt: '2026-09-23T10:00:00Z',
          }
        )
      ).rejects.toThrow(PermanentEmailError);
    });
  });

  describe('Retry Error Classification', () => {
    let service: EmailService;

    beforeEach(() => {
      service = new EmailService('re_test_key_123');
    });

    it('classifies HTTP 429 / rate limit error as RetriableEmailError', () => {
      expect(() => {
        service.classifyAndThrowError({ statusCode: 429, message: 'Too many requests' });
      }).toThrow(RetriableEmailError);
    });

    it('classifies HTTP 500 / server error as RetriableEmailError', () => {
      expect(() => {
        service.classifyAndThrowError({ statusCode: 503, message: 'Service unavailable' });
      }).toThrow(RetriableEmailError);
    });

    it('classifies HTTP 400 / invalid input as PermanentEmailError', () => {
      expect(() => {
        service.classifyAndThrowError({ statusCode: 400, message: 'Invalid recipient domain' });
      }).toThrow(PermanentEmailError);
    });
  });
});
