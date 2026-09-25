import { describe, it, expect, vi } from 'vitest';
import {
  isPrivateIp,
  isPrivateIpv4,
  isPrivateIpv6,
  validateUrlForSsrf,
  ssrfSafeFetch,
  SsrfValidationError,
} from '../ssrf';

describe('SSRF-Safe Webhook Destination Validation & Egress Policy (#312)', () => {
  describe('Private IP Range Detection', () => {
    it('detects standard RFC 1918 private IPv4 addresses', () => {
      expect(isPrivateIpv4('10.0.0.1')).toBe(true);
      expect(isPrivateIpv4('10.255.255.255')).toBe(true);
      expect(isPrivateIpv4('172.16.0.1')).toBe(true);
      expect(isPrivateIpv4('172.31.255.255')).toBe(true);
      expect(isPrivateIpv4('192.168.1.1')).toBe(true);
      expect(isPrivateIpv4('192.168.0.254')).toBe(true);
    });

    it('detects loopback and local IPv4 addresses', () => {
      expect(isPrivateIpv4('127.0.0.1')).toBe(true);
      expect(isPrivateIpv4('127.0.1.1')).toBe(true);
      expect(isPrivateIpv4('0.0.0.0')).toBe(true);
    });

    it('detects cloud provider metadata and link-local IPv4 addresses (169.254.169.254)', () => {
      expect(isPrivateIpv4('169.254.169.254')).toBe(true);
      expect(isPrivateIpv4('169.254.1.1')).toBe(true);
    });

    it('identifies public IPv4 addresses as safe', () => {
      expect(isPrivateIpv4('8.8.8.8')).toBe(false);
      expect(isPrivateIpv4('1.1.1.1')).toBe(false);
      expect(isPrivateIpv4('93.184.216.34')).toBe(false);
      expect(isPrivateIpv4('142.250.190.46')).toBe(false);
    });

    it('detects private and loopback IPv6 addresses', () => {
      expect(isPrivateIpv6('::1')).toBe(true);
      expect(isPrivateIpv6('::')).toBe(true);
      expect(isPrivateIpv6('fc00::1')).toBe(true);
      expect(isPrivateIpv6('fd12:3456:789a:1::1')).toBe(true);
      expect(isPrivateIpv6('fe80::1')).toBe(true);
    });

    it('detects IPv4-mapped IPv6 representations of private addresses', () => {
      expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIpv6('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateIpv6('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false);
    });
  });

  describe('validateUrlForSsrf', () => {
    it('allows valid public HTTPS webhook destination', async () => {
      const mockLookup = vi.fn().mockResolvedValue(['93.184.216.34']);
      const result = await validateUrlForSsrf('https://api.example.com/webhook', {
        dnsLookupFn: mockLookup,
      });

      expect(result.url.hostname).toBe('api.example.com');
      expect(result.resolvedIps).toEqual(['93.184.216.34']);
    });

    it('rejects forbidden protocols (file:, ftp:, gopher:, ssh:)', async () => {
      await expect(validateUrlForSsrf('file:///etc/passwd')).rejects.toThrow(
        /Forbidden protocol "file:"/,
      );
      await expect(validateUrlForSsrf('ftp://ftp.example.com/payload')).rejects.toThrow(
        /Forbidden protocol "ftp:"/,
      );
      await expect(validateUrlForSsrf('gopher://127.0.0.1:70/')).rejects.toThrow(
        /Forbidden protocol "gopher:"/,
      );
    });

    it('rejects URLs containing embedded user credentials', async () => {
      await expect(
        validateUrlForSsrf('https://admin:password123@api.example.com/webhook'),
      ).rejects.toThrow(/embedded credentials are not allowed/);
    });

    it('rejects direct private IP addresses and loopback URLs', async () => {
      await expect(validateUrlForSsrf('http://127.0.0.1:8080/callback')).rejects.toThrow(
        /Destination resolves to restricted or private IP address/,
      );
      await expect(validateUrlForSsrf('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        /Destination resolves to restricted or private IP address/,
      );
      await expect(validateUrlForSsrf('http://[::1]:8080/callback')).rejects.toThrow(
        /Destination resolves to restricted or private IP address/,
      );
    });

    it('rejects domains resolving to private IP ranges (DNS rebinding defense)', async () => {
      const mockRebindingDns = vi.fn().mockResolvedValue(['10.0.1.50']);
      await expect(
        validateUrlForSsrf('https://attacker-rebinding.com/webhook', {
          dnsLookupFn: mockRebindingDns,
        }),
      ).rejects.toThrow(/Destination resolves to restricted or private IP address/);
    });

    it('rejects disallowed ports', async () => {
      const mockLookup = vi.fn().mockResolvedValue(['93.184.216.34']);
      await expect(
        validateUrlForSsrf('https://api.example.com:22/webhook', {
          dnsLookupFn: mockLookup,
        }),
      ).rejects.toThrow(/Port 22 is not in the allowed ports list/);
    });

    it('rejects localhost domain names', async () => {
      await expect(validateUrlForSsrf('http://localhost:3000/webhook')).rejects.toThrow(
        /is a private or local domain/,
      );
      await expect(validateUrlForSsrf('http://service.local/webhook')).rejects.toThrow(
        /is a private or local domain/,
      );
      await expect(validateUrlForSsrf('http://backend.internal/webhook')).rejects.toThrow(
        /is a private or local domain/,
      );
    });
  });

  describe('ssrfSafeFetch & Redirect Abuse Prevention', () => {
    it('blocks redirects to internal networks', async () => {
      const globalFetchMock = vi.spyOn(globalThis, 'fetch');

      // First request responds with a 302 redirect pointing to internal metadata
      globalFetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      );

      const mockLookup = vi.fn().mockResolvedValue(['93.184.216.34']);

      await expect(
        ssrfSafeFetch('https://public-service.com/redirect', {
          ssrfOptions: { dnsLookupFn: mockLookup },
        }),
      ).rejects.toThrow(/Destination resolves to restricted or private IP address/);

      globalFetchMock.mockRestore();
    });

    it('blocks excessive redirect chains exceeding maxRedirects', async () => {
      const globalFetchMock = vi.spyOn(globalThis, 'fetch');

      globalFetchMock.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://public-service.com/loop' },
        }),
      );

      const mockLookup = vi.fn().mockResolvedValue(['93.184.216.34']);

      await expect(
        ssrfSafeFetch('https://public-service.com/loop', {
          maxRedirects: 2,
          ssrfOptions: { dnsLookupFn: mockLookup },
        }),
      ).rejects.toThrow(/Too many redirects/);

      globalFetchMock.mockRestore();
    });
  });
});
