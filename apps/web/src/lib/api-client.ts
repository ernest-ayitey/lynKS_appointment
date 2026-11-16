import { authStorage } from './auth-storage';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const REFRESH_PATH = '/auth/refresh';
const AUTH_PATH_PREFIX = '/auth/';

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'message' in data) {
      const { message } = data as { message: unknown };
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }
  } catch {
    // Response body was not JSON (or was empty) — fall back below.
  }
  return response.statusText || 'Request failed';
}

function rawPost(path: string, body: unknown): Promise<Response> {
  const accessToken = authStorage.getAccessToken();
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * Calls POST /auth/refresh with the stored refresh token. On success,
 * stores the new tokens and returns true. On failure, leaves storage
 * untouched (the caller decides whether to clear it) and returns false.
 *
 * Deliberately uses `fetch` directly rather than `post()` — this must
 * never route back through `post`'s own 401-triggers-refresh handling,
 * or a failing refresh would recurse into itself indefinitely.
 */
async function refreshTokens(): Promise<boolean> {
  const response = await fetch(`${API_BASE_URL}${REFRESH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: authStorage.getRefreshToken() }),
  });

  if (!response.ok) {
    return false;
  }

  const tokens = (await response.json()) as RefreshResponse;
  authStorage.setTokens(tokens);
  return true;
}

/**
 * Whether a 401 from `path` means "the access token is stale, try
 * refreshing" rather than an ordinary domain error.
 *
 * The `/auth/` endpoints are how a session is *created* — a wrong
 * password on `/auth/staff/login`, or a wrong code on
 * `/auth/patient/verify-otp` or the staff 2-step verify, legitimately
 * answers 401 while carrying no session to refresh. Treating those as
 * stale-token 401s fires a pointless `POST /auth/refresh` on every
 * failed sign-in attempt, and would clear a *valid* session's tokens
 * (via the `clearTokens()` on refresh failure) for an already-signed-in
 * user who mistypes a code.
 */
function canRefreshOn(path: string): boolean {
  return !path.startsWith(AUTH_PATH_PREFIX);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await rawPost(path, body);

  if (response.status === 401 && canRefreshOn(path)) {
    const refreshed = await refreshTokens();
    if (!refreshed) {
      authStorage.clearTokens();
      throw new ApiError(response.status, await extractErrorMessage(response));
    }

    // Retry the original request exactly once, now with the refreshed
    // access token. Its outcome (success or failure) is returned/thrown
    // as-is — it is never itself retried, so a second failure here does
    // not trigger another refresh attempt.
    const retryResponse = await rawPost(path, body);
    if (!retryResponse.ok) {
      throw new ApiError(retryResponse.status, await extractErrorMessage(retryResponse));
    }
    return (await retryResponse.json()) as T;
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export const apiClient = { post };
