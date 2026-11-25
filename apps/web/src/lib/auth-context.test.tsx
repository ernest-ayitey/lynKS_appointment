import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-context';

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  const fetchMock = vi.fn().mockImplementation(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('AuthProvider', () => {
  it('starts loading, then becomes unauthenticated if refresh fails on boot', async () => {
    mockFetchSequence([{ status: 401, body: { error: 'Session expired, please sign in again' } }]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
  });

  it('fails closed to unauthenticated when refresh succeeds but no user is cached (cross-tab/cold-restart case)', async () => {
    // sessionStorage is empty (no prior login in this tab), yet the
    // refresh cookie is still valid server-side.
    mockFetchSequence([{ status: 200, body: { access_token: 'tok' } }]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
    expect(result.current.user).toBeNull();
  });

  it('login stores the user and marks authenticated', async () => {
    mockFetchSequence([
      { status: 401, body: { error: 'x' } }, // boot refresh fails
      { status: 200, body: { access_token: 'tok', must_change_password: false, user: { id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B' } } },
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
    await act(async () => { await result.current.login('a', 'pw'); });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user?.username).toBe('a');
  });

  it('logout clears state even if the server call fails', async () => {
    // Realistic same-tab case: a prior login already cached the user;
    // /auth/refresh on boot only ever returns {access_token}, never user.
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh succeeds
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).not.toBe('loading'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
    await act(async () => { await result.current.logout(); });
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
  });

  it('authedFetch retries once on 401 via refresh, then succeeds', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh
      { status: 401, body: { error: 'expired' } }, // the authedFetch call, first attempt
      { status: 200, body: { access_token: 'new-tok' } }, // the refresh it triggers
      { status: 200, body: { ok: true } }, // the retried call
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    const data = await act(async () => result.current.authedFetch<{ ok: boolean }>('/some/protected/path'));
    expect(data.ok).toBe(true);
  });

  it('authedFetch does not loop forever when refresh itself 401s', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } },
      { status: 401, body: { error: 'expired' } },
      { status: 401, body: { error: 'refresh also expired' } },
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    await expect(act(async () => result.current.authedFetch('/some/path'))).rejects.toThrow();
  });
});
