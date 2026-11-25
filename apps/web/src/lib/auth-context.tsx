import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, apiRequest } from './api-client';

const CACHED_USER_KEY = 'auth:user';

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  first_name: string;
  last_name: string;
  must_change_password: boolean;
}

interface SessionResponse {
  access_token: string;
  must_change_password: boolean;
  user: Omit<AuthUser, 'must_change_password'>;
}

interface RefreshResponse {
  access_token: string;
}

export interface RegisterPayload {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  email: string;
  phone: string;
  username: string;
  password: string;
  password_confirmation: string;
  accept_terms: boolean;
}

export interface ResetPasswordPayload {
  password: string;
  password_confirmation: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  password: string;
  password_confirmation: string;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login(username: string, password: string, rememberMe?: boolean): Promise<void>;
  register(payload: RegisterPayload): Promise<void>;
  logout(): Promise<void>;
  forgotPassword(username: string): Promise<{ message: string }>;
  resetPassword(token: string, payload: ResetPasswordPayload): Promise<void>;
  changePassword(payload: ChangePasswordPayload): Promise<void>;
  authedFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCachedUser(): AuthUser | null {
  const raw = sessionStorage.getItem(CACHED_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function cacheUser(user: AuthUser) {
  sessionStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
}

function clearCachedUser() {
  sessionStorage.removeItem(CACHED_USER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readCachedUser());
  const [status, setStatus] = useState<AuthStatus>('loading');
  // The access token is never part of the exposed context value and is
  // never persisted — it lives only in this in-memory ref.
  const accessTokenRef = useRef<string | null>(null);

  function setAccessToken(token: string | null) {
    accessTokenRef.current = token;
  }

  function clearLocalSession() {
    setAccessToken(null);
    setUser(null);
    clearCachedUser();
    setStatus('unauthenticated');
  }

  function applySession(response: SessionResponse) {
    const mergedUser: AuthUser = { ...response.user, must_change_password: response.must_change_password };
    setAccessToken(response.access_token);
    setUser(mergedUser);
    cacheUser(mergedUser);
    setStatus('authenticated');
  }

  // Refresh tokens are single-use on the backend: two concurrent
  // /auth/refresh calls would race its rotation and the loser gets a
  // spurious 401. Every caller (boot effect, authedFetch's retry path)
  // shares one in-flight refresh promise instead of each starting its
  // own call; this also absorbs StrictMode's double-invoked boot effect,
  // since the second invocation finds the ref already set.
  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  function refreshAccessToken(): Promise<string> {
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = apiRequest<RefreshResponse>('/auth/refresh', { method: 'POST' })
        .then((response) => response.access_token)
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }
    return refreshPromiseRef.current;
  }

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        // /auth/refresh only ever returns {access_token} — never a user or
        // must_change_password, even if some future backend change starts
        // including them. The cached profile hydrated at mount (set only
        // by login/register/reset/change) is the sole source of truth for
        // who's authenticated on boot.
        const token = await refreshAccessToken();
        if (cancelled) return;
        const cachedUser = readCachedUser();
        if (!cachedUser) {
          // Fail closed: a successful refresh with no cached user profile
          // means we cannot verify must_change_password server-side (the
          // backend never checks it). Treat it as unauthenticated rather
          // than silently granting access.
          clearLocalSession();
          return;
        }
        setAccessToken(token);
        setUser(cachedUser);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        clearLocalSession();
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(username: string, password: string, rememberMe?: boolean) {
    const response = await apiRequest<SessionResponse>('/auth/login', {
      method: 'POST',
      body: { username, password, remember_me: rememberMe },
    });
    applySession(response);
  }

  async function register(payload: RegisterPayload) {
    const response = await apiRequest<SessionResponse>('/auth/register', {
      method: 'POST',
      body: payload,
    });
    applySession(response);
  }

  async function logout() {
    try {
      // Via authedFetch, not apiRequest: on an already-expired access token
      // the backend's authenticate! 401s before the route body runs, so the
      // revoke step never happens and the refresh token stays valid
      // server-side for up to 30 days. The one-shot refresh-and-retry gets a
      // live token so the revoke actually lands.
      await authedFetch('/auth/logout', { method: 'POST' });
    } catch {
      // The user's intent to log out is honored locally regardless of
      // what the network does.
    } finally {
      clearLocalSession();
    }
  }

  async function forgotPassword(username: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/auth/password/forgot', {
      method: 'POST',
      body: { username },
    });
  }

  async function resetPassword(token: string, payload: ResetPasswordPayload) {
    const response = await apiRequest<SessionResponse>('/auth/password/reset', {
      method: 'POST',
      body: { token, ...payload },
    });
    applySession(response);
  }

  async function changePassword(payload: ChangePasswordPayload) {
    // Via authedFetch, not apiRequest: a forced-change user can easily sit on
    // this screen long enough for the access token to expire, and without the
    // retry path that submit would 401 with no recovery available to them
    // (they cannot navigate anywhere else until the change succeeds).
    const response = await authedFetch<SessionResponse>('/auth/password/change', {
      method: 'POST',
      body: payload,
    });
    applySession(response);
  }

  async function authedFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    try {
      return await apiRequest<T>(path, { ...options, accessToken: accessTokenRef.current });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && path !== '/auth/refresh') {
        try {
          const newToken = await refreshAccessToken();
          setAccessToken(newToken);
          return await apiRequest<T>(path, { ...options, accessToken: newToken });
        } catch (retryErr) {
          clearLocalSession();
          throw retryErr;
        }
      }
      throw err;
    }
  }

  const value: AuthContextValue = {
    user,
    status,
    login,
    register,
    logout,
    forgotPassword,
    resetPassword,
    changePassword,
    authedFetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
