import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../../lib/api-client';
import { requestOtp } from './auth.api';

export function PatientSignInPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { requestId } = await requestOtp(phone);
      navigate('/enter-code', { state: { requestId, phone } });
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
      <h1>Sign in to book and manage your visits</h1>
      <p>We&apos;ll text you a 6-digit code. No password to remember.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="phone">Mobile number</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          placeholder="Your number"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          Text me a code
        </button>
      </form>
    </main>
  );
}
