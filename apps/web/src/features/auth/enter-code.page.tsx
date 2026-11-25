import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../../lib/api-client';
import { authStorage } from '../../lib/auth-storage';
import { verifyOtp } from './auth.api';

interface EnterCodeLocationState {
  requestId?: string;
  phone?: string;
}

export function EnterCodePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId, phone } = (location.state as EnterCodeLocationState | null) ?? {};

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!requestId) {
      setError('Your sign-in session expired. Please request a new code.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await verifyOtp(requestId, code);
      authStorage.setTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      navigate('/', { replace: true });
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
      <h1>Enter your code</h1>
      <p>{phone ? `Sent to ${phone}.` : 'Enter the code we sent you.'}</p>
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
        <button type="submit" disabled={submitting}>
          Continue
        </button>
      </form>
    </main>
  );
}
