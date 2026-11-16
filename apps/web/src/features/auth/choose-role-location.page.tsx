import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../../lib/api-client';
import { authStorage } from '../../lib/auth-storage';
import { resolveRoleLocation, type RoleLocationOption } from './auth.api';

interface ChooseRoleLocationLocationState {
  sessionToken?: string;
  options?: RoleLocationOption[];
}

export function ChooseRoleLocationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionToken, options = [] } =
    (location.state as ChooseRoleLocationLocationState | null) ?? {};

  const [selectedId, setSelectedId] = useState<string>(options[0]?.staffUserLocationId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!sessionToken || !selectedId) {
      setError('Your sign-in session expired. Please sign in again.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await resolveRoleLocation(sessionToken, selectedId);
      authStorage.setTokens(result as { accessToken: string; refreshToken: string });
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
      <h1>How are you working today?</h1>
      <p>You have {options.length} roles. Switch any time from the menu under your name.</p>
      <form onSubmit={handleSubmit}>
        <fieldset>
          <legend>Continue as</legend>
          {options.map((option) => (
            <label key={option.staffUserLocationId}>
              <input
                type="radio"
                name="staffUserLocationId"
                value={option.staffUserLocationId}
                checked={selectedId === option.staffUserLocationId}
                onChange={() => setSelectedId(option.staffUserLocationId)}
              />
              <strong>{option.roleName}</strong>
              <span>{option.locationName}</span>
            </label>
          ))}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting || !selectedId}>
          Continue
        </button>
      </form>
    </main>
  );
}
