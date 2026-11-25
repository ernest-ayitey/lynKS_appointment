import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { GENERIC_ERROR_MESSAGE, applyApiError } from './api-error-handling';

interface Form {
  password: string;
  passwordConfirmation: string;
}

const FIELD_MAP: Record<string, keyof Form> = {
  password: 'password',
  password_confirmation: 'passwordConfirmation',
};

describe('applyApiError', () => {
  it('attaches each mapped field error under this form\'s field name', () => {
    const setError = vi.fn();
    const setBanner = vi.fn();

    const attached = applyApiError(
      new ApiError('Please correct the highlighted fields', 422, {
        password: 'Too short',
        password_confirmation: "Passwords don't match",
      }),
      FIELD_MAP,
      setError,
      setBanner,
    );

    expect(attached).toBe(true);
    expect(setError).toHaveBeenCalledWith('password', { message: 'Too short' });
    expect(setError).toHaveBeenCalledWith('passwordConfirmation', {
      message: "Passwords don't match",
    });
  });

  it('always sets the banner, including for an error with no field errors at all', () => {
    const setBanner = vi.fn();

    const attached = applyApiError(
      new ApiError('Session expired, please sign in again', 401),
      FIELD_MAP,
      vi.fn(),
      setBanner,
    );

    // This is the whole point of the helper: a 401/403/500 can no longer be
    // swallowed just because it carries no `errors` map.
    expect(attached).toBe(false);
    expect(setBanner).toHaveBeenCalledWith('Session expired, please sign in again');
  });

  it('sets the banner alongside the field errors, not instead of them', () => {
    const setError = vi.fn();
    const setBanner = vi.fn();

    applyApiError(
      new ApiError('Please correct the highlighted fields', 422, { password: 'Too short' }),
      FIELD_MAP,
      setError,
      setBanner,
    );

    expect(setError).toHaveBeenCalledTimes(1);
    expect(setBanner).toHaveBeenCalledWith('Please correct the highlighted fields');
  });

  it('ignores a backend key the form has no input for, but still surfaces the message via the banner', () => {
    const setError = vi.fn();
    const setBanner = vi.fn();

    const attached = applyApiError(
      new ApiError('Please correct the highlighted fields', 422, {
        some_field_this_form_does_not_have: 'Nope',
      }),
      FIELD_MAP,
      setError,
      setBanner,
    );

    // No input to attach it to, so setError is a no-op...
    expect(attached).toBe(false);
    expect(setError).not.toHaveBeenCalled();
    // ...but the user is never left with a silently failed submit.
    expect(setBanner).toHaveBeenCalledWith('Please correct the highlighted fields');
  });

  it('exports one generic message for non-ApiError failures', () => {
    expect(GENERIC_ERROR_MESSAGE).toMatch(/something went wrong/i);
  });
});
