import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../../lib/api-client';
import { authStorage } from '../../lib/auth-storage';
import {
  requestStaffTwoStep,
  resolveRoleLocation,
  verifyStaffTwoStep,
  type StaffRoleLocationOptions,
} from './auth.api';

interface StaffTwoStepLocationState {
  sessionToken?: string;
  email?: string;
}

export function StaffTwoStepPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionToken, email } = (location.state as StaffTwoStepLocationState | null) ?? {};

  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sessionToken) {
      setError('Your sign-in session expired. Please sign in again.');
      return;
    }

    requestStaffTwoStep(sessionToken)
      .then((result) => setRequestId(result.requestId))
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!sessionToken || !requestId) {
      setError('Your sign-in session expired. Please sign in again.');
      return;
    }

    setSubmitting(true);

    try {
      const verifyResult = await verifyStaffTwoStep(sessionToken, requestId, code);
      const newSessionToken = verifyResult.sessionToken;
      const result = await resolveRoleLocation(newSessionToken);

      if ('options' in result) {
        const { options } = result as StaffRoleLocationOptions;
        navigate('/staff/choose-role-location', {
          state: { sessionToken: newSessionToken, options },
        });
        return;
      }

      authStorage.setTokens(result);
      navigate('/staff/dashboard', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That code is incorrect or has expired. Please try again.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Check it&apos;s really you</h1>
      <p>
        {email
          ? `Enter the 6-digit code for ${email}.`
          : 'Enter the 6-digit code for your account.'}
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="code">Code</label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting || !requestId}>
          Verify
        </button>
      </form>
    </main>
  );
}
