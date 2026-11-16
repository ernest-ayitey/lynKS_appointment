import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Shared secret-keyed hashing for values that must never be stored in
 * plaintext (OTP codes, refresh tokens) but are only ever looked up by
 * exact match (never by a human comparing hashes), so a simple HMAC is
 * sufficient — no per-value salt needed, and no native dependency
 * (bcrypt) required.
 *
 * HMAC-SHA256 is keyed with a server-side secret so that even a stolen
 * database dump cannot be brute-forced offline (e.g. the 1,000,000
 * possible 6-digit OTP codes) without also having the secret.
 */
export function hmacSha256Hex(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * Constant-time comparison of two hex-encoded hashes, to avoid leaking
 * timing information about how many leading bytes matched.
 */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
