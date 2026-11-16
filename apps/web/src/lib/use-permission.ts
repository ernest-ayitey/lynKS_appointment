import { authStorage } from './auth-storage';

interface AccessTokenClaims {
  permissions?: unknown;
}

/**
 * Decodes the middle (payload) segment of a JWT without any extra
 * dependency — a few lines of base64url decoding is all this needs.
 * Returns null for anything that isn't a well-formed, 3-part JWT with a
 * JSON payload (malformed token, truncated, etc.) rather than throwing.
 */
function decodeJwtPayload(token: string): AccessTokenClaims | null {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((char) => '%' + char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as AccessTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Reads the `permissions` claim out of the currently stored access token
 * and checks whether `key` is in it.
 *
 * This is a UI-convenience check ONLY — it hides/disables actions the
 * backend would reject anyway. It is NEVER the security boundary: the
 * JWT payload is attacker-readable and -editable client-side, so a
 * `true` here grants nothing by itself. The real enforcement is the
 * backend's `PermissionsGuard` (Task 5), which re-checks on every
 * request regardless of what this hook reports.
 */
export function usePermission(key: string): boolean {
  const token = authStorage.getAccessToken();
  if (!token) {
    return false;
  }

  const claims = decodeJwtPayload(token);
  const permissions = claims?.permissions;
  return Array.isArray(permissions) && permissions.includes(key);
}
