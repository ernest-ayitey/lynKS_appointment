import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { authStorage } from '../auth-storage';
import { usePermission } from '../use-permission';

function toBase64Url(obj: unknown): string {
  const json = JSON.stringify(obj);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeAccessToken(permissions: string[]): string {
  const header = toBase64Url({ alg: 'HS256', typ: 'JWT' });
  const payload = toBase64Url({ sub: 'staff-1', subjectType: 'STAFF', permissions });
  return `${header}.${payload}.fake-signature`;
}

describe('usePermission', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false for a key not present in the decoded token claims', () => {
    authStorage.setTokens({
      accessToken: makeAccessToken(['appointments:read']),
      refreshToken: 'refresh-token',
    });

    const { result } = renderHook(() => usePermission('appointments:write'));

    expect(result.current).toBe(false);
  });

  it('returns true for a key present in the decoded token claims', () => {
    authStorage.setTokens({
      accessToken: makeAccessToken(['appointments:read', 'appointments:write']),
      refreshToken: 'refresh-token',
    });

    const { result } = renderHook(() => usePermission('appointments:write'));

    expect(result.current).toBe(true);
  });

  it('returns false when there is no stored access token', () => {
    const { result } = renderHook(() => usePermission('appointments:read'));

    expect(result.current).toBe(false);
  });

  it('returns false for a malformed token instead of throwing', () => {
    authStorage.setTokens({ accessToken: 'not-a-jwt', refreshToken: 'refresh-token' });

    const { result } = renderHook(() => usePermission('appointments:read'));

    expect(result.current).toBe(false);
  });
});
