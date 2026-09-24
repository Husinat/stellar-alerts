import { describe, it, expect } from 'vitest';
import {
  maskEmail,
  maskPhone,
  maskTelegramChatId,
  maskIpAddress,
  maskDestination,
  sanitizePayload,
  encryptPersonalField,
  decryptPersonalField,
} from '../privacy';

describe('Personal Notification Data Privacy & Minimization (#314)', () => {
  describe('PII Masking & Anonymization', () => {
    it('masks email addresses preserving only first 2 characters and domain', () => {
      expect(maskEmail('alice@example.com')).toBe('al***@example.com');
      expect(maskEmail('bob@gmail.com')).toBe('bo***@gmail.com');
      expect(maskEmail('a@b.com')).toBe('a***@b.com');
      expect(maskEmail('invalid-email')).toBe('***@***');
    });

    it('masks phone numbers preserving country code and last 4 digits', () => {
      expect(maskPhone('+14155551234')).toBe('+1***1234');
      expect(maskPhone('+447911123456')).toBe('+4***3456');
      expect(maskPhone('123')).toBe('***');
    });

    it('masks Telegram chat IDs', () => {
      expect(maskTelegramChatId('123456789')).toBe('tg:***6789');
      expect(maskTelegramChatId('987654321')).toBe('tg:***4321');
    });

    it('anonymizes IPv4 and IPv6 addresses', () => {
      expect(maskIpAddress('192.168.1.123')).toBe('192.168.1.xxx');
      expect(maskIpAddress('10.0.5.99')).toBe('10.0.5.xxx');
      expect(maskIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
        '2001:0db8:85a3:xxxx:xxxx:xxxx:xxxx:xxxx',
      );
    });

    it('automatically masks destinations based on channel or shape', () => {
      expect(maskDestination('user@stellar.org', 'email')).toBe('us***@stellar.org');
      expect(maskDestination('123456789', 'telegram')).toBe('tg:***6789');
      expect(maskDestination('+12025550199', 'whatsapp')).toBe('+1***0199');
    });
  });

  describe('sanitizePayload', () => {
    it('deeply redacts or masks sensitive PII fields in payloads', () => {
      const sensitivePayload = {
        paymentId: 'pay_123',
        amount: '100.50',
        asset: 'USDC',
        recipient: {
          email: 'recipient@domain.com',
          phone: '+14155552671',
          telegramChatId: '987654321',
          nestedSecret: {
            token: 'secret-auth-token-12345',
            password: 'super-secret-password',
          },
        },
        meta: {
          ipAddress: '203.0.113.195',
          txHash: 'a1b2c3d4e5f6',
        },
      };

      const sanitized = sanitizePayload(sensitivePayload);

      expect(sanitized.paymentId).toBe('pay_123');
      expect(sanitized.amount).toBe('100.50');
      expect(sanitized.asset).toBe('USDC');
      expect(sanitized.meta.txHash).toBe('a1b2c3d4e5f6');

      // PII fields are sanitized
      expect(sanitized.recipient.email).toBe('re***@domain.com');
      expect(sanitized.recipient.phone).toBe('+1***2671');
      expect(sanitized.recipient.telegramChatId).toBe('tg:***4321');
      expect(sanitized.recipient.nestedSecret.token).toBe('***');
      expect(sanitized.recipient.nestedSecret.password).toBe('***');
      expect(sanitized.meta.ipAddress).toBe('203.0.113.xxx');
    });
  });

  describe('Field-Level Encryption at Rest', () => {
    it('encrypts sensitive fields and successfully decrypts them back', () => {
      const plaintext = '1234567890';
      const encrypted = encryptPersonalField(plaintext);

      expect(encrypted).not.toBeNull();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted?.split(':')).toHaveLength(4); // version:iv:authTag:ciphertext

      const decrypted = decryptPersonalField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('gracefully handles legacy plaintext or null inputs', () => {
      expect(encryptPersonalField(null)).toBeNull();
      expect(decryptPersonalField(null)).toBeNull();
      expect(decryptPersonalField('legacy-unencrypted-string')).toBe('legacy-unencrypted-string');
    });
  });
});
