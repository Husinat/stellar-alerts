import { cryptoVault } from './crypto-vault';

/**
 * Masks an email address showing only the first 2 characters of localpart and domain.
 * Example: 'alice@example.com' -> 'al***@example.com'
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return '***@***';
  }
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local[0] || '*'}***@${domain}`;
  }
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Masks a telephone / whatsapp number preserving country code prefix and last 4 digits.
 * Example: '+14155551234' -> '+1***1234'
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) {
    return '***';
  }
  const prefix = phone.startsWith('+') ? phone.slice(0, 2) : '';
  const suffix = phone.slice(-4);
  return `${prefix}***${suffix}`;
}

/**
 * Masks a Telegram chat ID or username.
 * Example: '123456789' -> 'tg:***6789'
 */
export function maskTelegramChatId(chatId: string): string {
  if (!chatId || chatId.length <= 4) {
    return 'tg:***';
  }
  return `tg:***${chatId.slice(-4)}`;
}

/**
 * Anonymizes an IP address to preserve privacy according to GDPR/data protection standards.
 * - IPv4: zero-masks the last octet (e.g., '192.168.1.123' -> '192.168.1.xxx')
 * - IPv6: zero-masks the interface identifier / host half
 */
export function maskIpAddress(ip: string): string {
  if (!ip) return 'xxx';

  // IPv4
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }
  }

  // IPv6
  if (ip.includes(':')) {
    const groups = ip.split(':');
    if (groups.length >= 3) {
      return `${groups.slice(0, 3).join(':')}:xxxx:xxxx:xxxx:xxxx:xxxx`;
    }
  }

  return 'xxx';
}

/**
 * Automatically masks any recipient destination depending on the notification channel or format.
 */
export function maskDestination(destination: string | null | undefined, channel?: string): string {
  if (!destination) return '';

  const ch = (channel || '').toLowerCase();
  if (ch === 'password' || ch === 'token' || ch === 'secret' || ch === 'authorization') {
    return '***';
  }
  if (ch === 'email' || destination.includes('@')) {
    return maskEmail(destination);
  }
  if (ch === 'telegram' || ch.includes('telegram')) {
    return maskTelegramChatId(destination);
  }
  if (ch === 'whatsapp' || ch.includes('phone') || destination.startsWith('+')) {
    return maskPhone(destination);
  }

  // Fallback generic mask
  if (destination.length <= 6) return '***';
  return `${destination.slice(0, 3)}***${destination.slice(-3)}`;
}

/**
 * Keys in JSON payloads that are considered personal identifiable information (PII).
 */
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'email',
  'phone',
  'phonenumber',
  'whatsappnumber',
  'telegramchatid',
  'chatid',
  'recipient',
  'ipaddress',
  'ip',
  'token',
  'secret',
  'authorization',
  'password',
]);

/**
 * Deeply sanitizes a notification or dead-letter payload by redacting or masking PII.
 */
export function sanitizePayload<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }
  if (typeof payload !== 'object') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item)) as unknown as T;
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload as Record<string, any>)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else if (lowerKey === 'ipaddress' || lowerKey === 'ip') {
      sanitized[key] = maskIpAddress(String(value));
    } else if (SENSITIVE_PAYLOAD_KEYS.has(lowerKey)) {
      if (typeof value === 'string') {
        sanitized[key] = maskDestination(value, lowerKey);
      } else {
        sanitized[key] = '[REDACTED]';
      }
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

/**
 * Encrypts a personal notification field (e.g. phone, Telegram ID) for storage at rest.
 */
export function encryptPersonalField(value: string | null | undefined): string | null {
  if (!value) return null;
  // If already encrypted (format: version:iv:authTag:ciphertext)
  if (value.split(':').length === 4) {
    return value;
  }
  return cryptoVault.encrypt(value);
}

/**
 * Decrypts a personal notification field stored at rest.
 * Gracefully handles legacy plaintext or missing values.
 */
export function decryptPersonalField(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(':');
  // Check if it's in encrypted format (version:iv:authTag:ciphertext)
  if (parts.length === 4) {
    try {
      return cryptoVault.decrypt(value);
    } catch {
      // If decryption fails, return as-is
      return value;
    }
  }
  return value;
}
