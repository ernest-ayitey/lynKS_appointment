import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api-client';

afterEach(() => { vi.unstubAllGlobals(); });

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiRequest', () => {
  it('sends credentials: include and parses a 2xx JSON body', async () => {
    const fetchMock = mockFetch(200, { access_token: 'abc' });
    const result = await apiRequest<{ access_token: string }>('/auth/login', { method: 'POST', body: { username: 'a' } });
    expect(result.access_token).toBe('abc');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('attaches a Bearer header when accessToken is given', async () => {
    const fetchMock = mockFetch(200, {});
    await apiRequest('/auth/logout', { method: 'POST', accessToken: 'tok123' });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('throws ApiError with status, message, and field errors on 422', async () => {
    mockFetch(422, { error: 'Please correct the highlighted fields', errors: { username: 'Invalid username format' } });
    await expect(apiRequest('/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      message: 'Please correct the highlighted fields',
      errors: { username: 'Invalid username format' },
    });
  });

  it('is an instance of ApiError', async () => {
    mockFetch(401, { error: 'Incorrect username or password' });
    await expect(apiRequest('/auth/login', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
  });
});
