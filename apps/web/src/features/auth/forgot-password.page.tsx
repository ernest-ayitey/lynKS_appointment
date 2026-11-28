import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import AuthCard from '../../components/auth-card';
import { GENERIC_ERROR_MESSAGE } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';

interface ForgotPasswordFormValues {
  username: string;
}

export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ForgotPasswordFormValues>({ defaultValues: { username: '' } });

  async function onSubmit(data: ForgotPasswordFormValues) {
    setFormError(null);
    try {
      // The backend always responds with the same generic message regardless
      // of whether the username matches an account — there is no "found" vs
      // "not found" branch to render, by design (it must not leak which
      // usernames exist).
      const response = await forgotPassword(data.username);
      setMessage(response.message);
    } catch {
      // The request itself can fail: Mailer.deliver runs inline in that
      // backend request, and the API can be unreachable. There is no
      // field-level case to distinguish (the only input is the username, and
      // the backend deliberately never reports anything about it), so every
      // failure gets the same generic banner. The error is deliberately not
      // surfaced verbatim — a backend message here could leak whether the
      // username exists.
      setFormError(GENERIC_ERROR_MESSAGE);
    }
  }

  return (
    <AuthCard
      stepLabel="STEP 1 OF 2"
      title="Reset your password"
      subtitle="Enter your username. We'll email a reset link to the address on your account."
    >
      {message ? (
        <p role="status" className="text-center text-sm text-slate-700">
          {message}
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          {formError && (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('username', { required: true })}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Send reset link
          </button>
        </form>
      )}

      <p className="text-center text-sm text-slate-600">
        <Link to="/login" className="text-blue-600 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
