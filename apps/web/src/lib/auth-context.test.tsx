import { StrictMode } from 'react';
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

  it('never persists the access token to sessionStorage', async () => {
    mockFetchSequence([
      { status: 401, body: { error: 'x' } }, // boot refresh fails
      { status: 200, body: { access_token: 'super-secret-access-token', must_change_password: false, user: { id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B' } } },
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
    await act(async () => { await result.current.login('a', 'pw'); });

    expect(result.current.status).toBe('authenticated');
    // The single most security-critical property of this provider: the access
    // token lives only in an in-memory ref, so an XSS payload reading web
    // storage finds nothing to replay. The cached profile is there; the token
    // must not be, under any key.
    expect(JSON.stringify(sessionStorage)).not.toContain('super-secret-access-token');
    expect(JSON.stringify(localStorage)).not.toContain('super-secret-access-token');
    // ...and it is not exposed on the context value either.
    expect(JSON.stringify(Object.keys(result.current))).not.toContain('access');
  });

  it('logout retries through refresh when the access token has already expired, so the revoke lands', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    const fetchMock = mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh
      { status: 401, body: { error: 'expired' } }, // logout, first attempt
      { status: 200, body: { access_token: 'new-tok' } }, // the refresh it triggers
      { status: 204, body: undefined }, // logout, retried — the revoke
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => { await result.current.logout(); });

    const logoutCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/logout'));
    expect(logoutCalls).toHaveLength(2);
    // The retry carried the freshly refreshed token, so the backend actually
    // reached the revoke step instead of 401ing in authenticate!.
    expect(logoutCalls[1][1].headers.Authorization).toBe('Bearer new-tok');
    expect(result.current.status).toBe('unauthenticated');
  });

  it('changePassword retries through refresh when the access token expired while the form was open', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: true }));
    const session = { access_token: 'post-change-tok', must_change_password: false, user: { id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B' } };
    const fetchMock = mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh
      { status: 401, body: { error: 'expired' } }, // change, first attempt
      { status: 200, body: { access_token: 'new-tok' } }, // the refresh it triggers
      { status: 200, body: session }, // change, retried
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await result.current.changePassword({ current_password: 'old', password: 'new', password_confirmation: 'new' });
    });

    const changeCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/password/change'));
    expect(changeCalls).toHaveLength(2);
    expect(changeCalls[1][1].headers.Authorization).toBe('Bearer new-tok');
    // The retry's session response was applied, clearing the forced-change flag.
    expect(result.current.user?.must_change_password).toBe(false);
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

  it('de-duplicates concurrent refreshes into a single /auth/refresh call', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    const fetchMock = mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh
      { status: 401, body: { error: 'expired' } }, // call A, first attempt
      { status: 401, body: { error: 'expired' } }, // call B, first attempt
      { status: 200, body: { access_token: 'new-tok' } }, // the one shared refresh
      { status: 200, body: { ok: true, who: 'a' } }, // call A, retried
      { status: 200, body: { ok: true, who: 'b' } }, // call B, retried
    ]);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    const [a, b] = await act(async () => Promise.all([
      result.current.authedFetch<{ ok: boolean; who: string }>('/a'),
      result.current.authedFetch<{ ok: boolean; who: string }>('/b'),
    ]));

    expect(a.who).toBe('a');
    expect(b.who).toBe('b');
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    // One for boot, one for the shared retry-triggered refresh — never two
    // for the two concurrent 401s.
    expect(refreshCalls).toHaveLength(2);
  });

  it('does not spuriously lose a cached session when StrictMode double-invokes the boot effect', async () => {
    sessionStorage.setItem('auth:user', JSON.stringify({ id: 1, username: 'a', role: 'patient', first_name: 'A', last_name: 'B', must_change_password: false }));
    const fetchMock = mockFetchSequence([
      { status: 200, body: { access_token: 'tok' } }, // boot refresh — must only be issued once
    ]);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <StrictMode>
          <AuthProvider>{children}</AuthProvider>
        </StrictMode>
      ),
    });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.user?.username).toBe('a');
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
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
