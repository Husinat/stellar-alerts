import dns from 'dns';
import net from 'net';

export class SsrfValidationError extends Error {
  public readonly code: string;
  public readonly targetUrl: string;

  constructor(message: string, targetUrl: string, code = 'SSRF_VALIDATION_FAILED') {
    super(`[SSRF Guard] ${message} (URL: ${targetUrl})`);
    this.name = 'SsrfValidationError';
    this.code = code;
    this.targetUrl = targetUrl;
  }
}

/**
 * IPv4 numeric representations and CIDR matching
 */
function ip4ToLong(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function inIpv4Cidr(ip: string, cidr: string): boolean {
  const [range, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipLong = ip4ToLong(ip);
  const rangeLong = ip4ToLong(range);
  return (ipLong & mask) === (rangeLong & mask);
}

/**
 * Reserved & private IPv4 ranges:
 * - 0.0.0.0/8 (Current network)
 * - 10.0.0.0/8 (RFC 1918 Private)
 * - 100.64.0.0/10 (Carrier grade NAT)
 * - 127.0.0.0/8 (Loopback)
 * - 169.254.0.0/16 (Link-local / Cloud metadata)
 * - 172.16.0.0/12 (RFC 1918 Private)
 * - 192.0.0.0/24 (IETF Protocol)
 * - 192.0.2.0/24 (TEST-NET-1)
 * - 192.168.0.0/16 (RFC 1918 Private)
 * - 198.18.0.0/15 (Benchmarking)
 * - 198.51.100.0/24 (TEST-NET-2)
 * - 203.0.113.0/24 (TEST-NET-3)
 * - 224.0.0.0/4 (Multicast)
 * - 240.0.0.0/4 (Reserved)
 * - 255.255.255.255/32 (Broadcast)
 */
const PRIVATE_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

/**
 * Checks if an IPv4 address is in a private, loopback, or cloud metadata range.
 */
export function isPrivateIpv4(ip: string): boolean {
  for (const cidr of PRIVATE_IPV4_CIDRS) {
    if (inIpv4Cidr(ip, cidr)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an IPv6 address is private, loopback, link-local, or mapped private IPv4.
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback / Unspecified
  if (normalized === '::1' || normalized === '::') {
    return true;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateIpv4(v4Part);
    }
  }

  // Unique local addresses (fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  // Link-local addresses (fe80::/10)
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) {
    return true;
  }

  return false;
}

/**
 * Checks if an IP (v4 or v6) is private or internal.
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPrivateIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isPrivateIpv6(ip);
  }
  return true; // Unknown IP formats are treated as unsafe
}

export interface SsrfValidationOptions {
  allowHttp?: boolean;
  allowedPorts?: number[];
  dnsLookupFn?: (hostname: string) => Promise<string[]>;
}

const DEFAULT_ALLOWED_PORTS = [80, 443, 8080, 8443];

/**
 * Default DNS resolver that resolves both IPv4 and IPv6 addresses.
 */
async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const addresses: string[] = [];
  try {
    const results = await dns.promises.lookup(hostname, { all: true });
    for (const res of results) {
      addresses.push(res.address);
    }
  } catch (err: any) {
    throw new SsrfValidationError(`DNS resolution failed for host "${hostname}": ${err.message}`, hostname, 'DNS_LOOKUP_FAILED');
  }
  return addresses;
}

/**
 * Validates a destination URL against SSRF rules:
 * 1. Checks scheme (HTTP/HTTPS only; HTTPS required in production unless allowHttp is set).
 * 2. Blocks embedded credentials (user:pass@host).
 * 3. Enforces allowed ports.
 * 4. Resolves DNS and blocks private, link-local, loopback, and cloud metadata IP ranges.
 */
export async function validateUrlForSsrf(
  targetUrl: string,
  options: SsrfValidationOptions = {},
): Promise<{ url: URL; resolvedIps: string[] }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    throw new SsrfValidationError('Invalid URL format', targetUrl, 'INVALID_URL');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowHttp = options.allowHttp ?? (!isProduction && process.env.NODE_ENV !== 'production');

  // 1. Protocol validation
  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new SsrfValidationError(`Forbidden protocol "${protocol}". Only HTTP/HTTPS is allowed`, targetUrl, 'INVALID_PROTOCOL');
  }

  if (protocol === 'http:' && !allowHttp && isProduction) {
    throw new SsrfValidationError('Plain HTTP is not allowed in production; destination must use HTTPS', targetUrl, 'HTTPS_REQUIRED');
  }

  // 2. Disallow credentials embedded in URL
  if (parsedUrl.username || parsedUrl.password) {
    throw new SsrfValidationError('URLs with embedded credentials are not allowed', targetUrl, 'CREDENTIALS_NOT_ALLOWED');
  }

  // 3. Hostname check and IP resolution
  const hostname = parsedUrl.hostname.toLowerCase();
  const rawHost = hostname.replace(/^\[|\]$/g, '');

  // Block localhost and internal domain names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new SsrfValidationError(`Destination host "${hostname}" is a private or local domain`, targetUrl, 'LOCAL_HOST_FORBIDDEN');
  }

  // 4. Port validation
  const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : protocol === 'https:' ? 443 : 80;
  const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  if (!allowedPorts.includes(port)) {
    throw new SsrfValidationError(`Port ${port} is not in the allowed ports list (${allowedPorts.join(', ')})`, targetUrl, 'PORT_NOT_ALLOWED');
  }

  let resolvedIps: string[] = [];

  if (net.isIP(rawHost)) {
    resolvedIps = [rawHost];
  } else {
    const lookupFn = options.dnsLookupFn ?? defaultDnsLookup;
    resolvedIps = await lookupFn(hostname);
  }

  if (resolvedIps.length === 0) {
    throw new SsrfValidationError(`No IP addresses found for hostname "${hostname}"`, targetUrl, 'NO_IP_RESOLVED');
  }

  for (const ip of resolvedIps) {
    if (isPrivateIp(ip)) {
      throw new SsrfValidationError(
        `Destination resolves to restricted or private IP address (${ip})`,
        targetUrl,
        'PRIVATE_IP_BLOCKED',
      );
    }
  }

  return { url: parsedUrl, resolvedIps };
}

/**
 * SSRF-Safe HTTP Fetch client that:
 * 1. Validates destination URL against SSRF policy before dispatch.
 * 2. Disallows automatic unvalidated redirects (prevents redirect abuse to internal networks).
 * 3. Supports controlled redirect following by re-validating each hop against the SSRF policy.
 */
export async function ssrfSafeFetch(
  inputUrl: string,
  init: RequestInit & { maxRedirects?: number; ssrfOptions?: SsrfValidationOptions } = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 3;
  let currentUrl = inputUrl;
  let redirectsCount = 0;

  while (true) {
    // Validate current hop
    await validateUrlForSsrf(currentUrl, init.ssrfOptions);

    // Fetch with redirect set to manual so we inspect and validate every redirect location
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);

    if (isRedirect) {
      if (redirectsCount >= maxRedirects) {
        throw new SsrfValidationError(`Too many redirects (exceeded limit of ${maxRedirects})`, currentUrl, 'MAX_REDIRECTS_EXCEEDED');
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new SsrfValidationError('Redirect response missing Location header', currentUrl, 'MISSING_REDIRECT_LOCATION');
      }

      // Resolve relative redirect against current URL
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = nextUrl;
      redirectsCount++;
      continue;
    }

    return response;
  }
}
