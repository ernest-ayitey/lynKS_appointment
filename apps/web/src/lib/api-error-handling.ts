import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { ApiError } from './api-client';

// Shown whenever a submit fails with something that is not an ApiError —
// a rejected fetch (backend unreachable, DNS failure, offline), an aborted
// request, or any unexpected throw. Without this, those failures are
// invisible to the user.
export const GENERIC_ERROR_MESSAGE = 'Something went wrong — please try again.';

/**
 * Applies a backend ApiError to a react-hook-form form.
 *
 * Every page that submits a form to the API needs the same two things from a
 * failed response: field-level messages attached to the inputs they belong to,
 * and a banner for the overall message. This was copy-pasted (and had already
 * diverged) across register/reset-password/change-password; it lives here now.
 *
 * - Each key in `err.errors` is mapped through `fieldMap` (backend snake_case
 *   key -> this form's field name) and attached with `setError`.
 * - A key that is not in `fieldMap` is a no-op: there is no input to attach it
 *   to. It is not silently lost, because...
 * - ...the banner is *always* set to `err.message`, whether or not any field
 *   error was attached. A 401/403/500 (no `errors` map at all) therefore still
 *   surfaces, which is the bug this helper exists to make impossible to repeat.
 *
 * Returns whether at least one field-level error was attached, for the rare
 * caller that renders differently in the "whole request was rejected" case
 * (reset-password's expired-link hint).
 */
export function applyApiError<TFieldValues extends FieldValues>(
  err: ApiError,
  fieldMap: Record<string, Path<TFieldValues>>,
  setError: UseFormSetError<TFieldValues>,
  setBanner: (message: string) => void,
): boolean {
  let attachedAnyFieldError = false;

  for (const [backendField, message] of Object.entries(err.errors ?? {})) {
    const formField = fieldMap[backendField];
    if (formField) {
      setError(formField, { message });
      attachedAnyFieldError = true;
    }
  }

  setBanner(err.message);
  return attachedAnyFieldError;
}
