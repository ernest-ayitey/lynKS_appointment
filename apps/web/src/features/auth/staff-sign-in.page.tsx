import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../../lib/api-client';
import { authStorage } from '../../lib/auth-storage';
import { resolveRoleLocation, staffLogin, type StaffRoleLocationOptions } from './auth.api';

export function StaffSignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { sessionToken, requiresTwoStep } = await staffLogin(email, password);

      if (requiresTwoStep) {
        navigate('/staff/two-step', { state: { sessionToken, email } });
        return;
      }

      const result = await resolveRoleLocation(sessionToken);

      if ('options' in result) {
        const { options } = result as StaffRoleLocationOptions;
        navigate('/staff/choose-role-location', {
          state: { sessionToken, options },
        });
        return;
      }

      authStorage.setTokens(result);
      navigate('/staff/dashboard', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Staff sign in</h1>
      <p>Use your clinic work account.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          Sign in
        </button>
      </form>
    </main>
  );
}
