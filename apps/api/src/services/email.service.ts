import { Resend } from 'resend';
import {
  renderPaymentReceiptTemplate,
  renderPaymentFailureTemplate,
  PaymentReceiptTemplateData,
  PaymentFailureTemplateData,
} from './templates/email.templates';

export class RetriableEmailError extends Error {
  public readonly isRetriable = true;
  constructor(message: string) {
    super(message);
    this.name = 'RetriableEmailError';
  }
}

export class PermanentEmailError extends Error {
  public readonly isRetriable = false;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentEmailError';
  }
}

/**
 * Sanitizes any error message or string payload by masking potential secret keys / credentials.
 */
export function sanitizeEmailErrorMessage(message: string): string {
  if (!message) return 'Unknown email provider error';
  // Mask Resend API keys e.g. re_123456789...
  let sanitized = message.replace(/re_[A-Za-z0-9_]{10,}/g, 're_****************');
  // Mask Bearer tokens or secret headers
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{10,}/gi, '$1****************');
  return sanitized;
}

export interface SendEmailOptions {
  recipientEmail: string;
  emailEnabled?: boolean;
}

export class EmailService {
  private resend: Resend;
  private fromAddress: string;

  constructor(apiKey?: string, fromAddress?: string) {
    const key = apiKey || process.env.RESEND_API_KEY || 're_mock_key_12345';
    this.resend = new Resend(key);
    this.fromAddress = fromAddress || process.env.EMAIL_FROM || 'Stellar Alerts <alerts@resend.dev>';
  }

  /**
   * Classify provider errors into retriable (transient, 429, 5xx) vs non-retriable (permanent, 400, invalid recipient).
   */
  public classifyAndThrowError(error: any): never {
    const rawMessage = error?.message || String(error);
    const sanitizedMsg = sanitizeEmailErrorMessage(rawMessage);
    const statusCode = error?.statusCode || error?.status;

    // Check for transient / retriable conditions (rate limit 429, 5xx server errors, network disconnects)
    if (
      statusCode === 429 ||
      (statusCode >= 500 && statusCode <= 599) ||
      /rate limit|timeout|network|econnreset|etimedout|500|502|503|504/i.test(rawMessage)
    ) {
      throw new RetriableEmailError(`Transient email delivery error: ${sanitizedMsg}`);
    }

    // Permanent errors (400 bad request, invalid email format, unsubscribed)
    throw new PermanentEmailError(`Permanent email delivery error: ${sanitizedMsg}`);
  }

  /**
   * Dispatch a Payment Receipt Email
   */
  async sendPaymentReceipt(
    options: SendEmailOptions,
    paymentData: Omit<PaymentReceiptTemplateData, 'recipientEmail'>
  ): Promise<{ id?: string; skipped?: boolean }> {
    if (options.emailEnabled === false) {
      console.log(`[EmailService] ⏭️ Skipping email dispatch for ${options.recipientEmail} (emailEnabled=false)`);
      return { skipped: true };
    }

    if (!options.recipientEmail || !options.recipientEmail.includes('@')) {
      console.warn(`[EmailService] ⚠️ Invalid recipient email address: ${options.recipientEmail}`);
      throw new PermanentEmailError(`Invalid recipient email address: ${options.recipientEmail}`);
    }

    const { subject, html, text, version } = renderPaymentReceiptTemplate({
      ...paymentData,
      recipientEmail: options.recipientEmail,
    });

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: [options.recipientEmail],
        subject,
        html,
        text,
        headers: {
          'X-Template-Version': version,
        },
      });

      if (error) {
        console.warn(`[EmailService] ❌ Resend provider returned error: ${sanitizeEmailErrorMessage(error.message)}`);
        this.classifyAndThrowError(error);
      }

      console.log(`[EmailService] ✉️ Sent payment receipt email to ${options.recipientEmail} (id: ${data?.id})`);
      return { id: data?.id };
    } catch (err: any) {
      if (err instanceof RetriableEmailError || err instanceof PermanentEmailError) {
        throw err;
      }
      this.classifyAndThrowError(err);
    }
  }

  /**
   * Dispatch a Payment / Alert Failure Email
   */
  async sendFailureNotification(
    options: SendEmailOptions,
    failureData: Omit<PaymentFailureTemplateData, 'recipientEmail'>
  ): Promise<{ id?: string; skipped?: boolean }> {
    if (options.emailEnabled === false) {
      return { skipped: true };
    }

    if (!options.recipientEmail || !options.recipientEmail.includes('@')) {
      throw new PermanentEmailError(`Invalid recipient email address: ${options.recipientEmail}`);
    }

    const { subject, html, text, version } = renderPaymentFailureTemplate({
      ...failureData,
      recipientEmail: options.recipientEmail,
    });

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: [options.recipientEmail],
        subject,
        html,
        text,
        headers: {
          'X-Template-Version': version,
        },
      });

      if (error) {
        this.classifyAndThrowError(error);
      }

      console.log(`[EmailService] ✉️ Sent failure notification email to ${options.recipientEmail}`);
      return { id: data?.id };
    } catch (err: any) {
      if (err instanceof RetriableEmailError || err instanceof PermanentEmailError) {
        throw err;
      }
      this.classifyAndThrowError(err);
    }
  }
}

export const emailService = new EmailService();
