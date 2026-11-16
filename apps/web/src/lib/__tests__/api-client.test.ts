import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient, ApiError } from '../api-client';
import { authStorage } from '../auth-storage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiClient.post', () => {
  beforeEach(() => {
    localStorage.clear();
    authStorage.setTokens({ accessToken: 'old-access', refreshToken: 'old-refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the stored access token as a Bearer Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.post<{ ok: boolean }>('/appointments', { foo: 'bar' });

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer old-access');
  });

  it('retries once via /auth/refresh after a 401 and succeeds with the new access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401)) // original request
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      ) // /auth/refresh call
      .mockResolvedValueOnce(jsonResponse({ ok: true })); // retried original request
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.post<{ ok: boolean }>('/appointments', { foo: 'bar' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshUrl).toContain('/auth/refresh');
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refreshToken: 'old-refresh' });

    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer new-access');

    expect(authStorage.getAccessToken()).toBe('new-access');
    expect(authStorage.getRefreshToken()).toBe('new-refresh');
  });

  it('clears stored tokens and surfaces the 401 if /auth/refresh also fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401)) // original request
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid refresh token' }, 401)); // /auth/refresh fails
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.post('/appointments', { foo: 'bar' })).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authStorage.getRefreshToken()).toBeNull();
  });

  it('does not retry a second time when the retried request itself fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401)) // original request
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      ) // /auth/refresh succeeds
      .mockResolvedValueOnce(jsonResponse({ message: 'Still unauthorized' }, 401)); // retry fails again
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.post('/appointments', { foo: 'bar' })).rejects.toBeInstanceOf(
      ApiError,
    );

    // original + refresh + one retry only — never a second refresh/retry cycle
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('propagates non-401 errors without attempting a refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'Server error' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.post('/appointments', {})).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
