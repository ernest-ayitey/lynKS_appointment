import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';

interface ResetPasswordFormValues {
  password: string;
  passwordConfirmation: string;
}

const BACKEND_FIELD_TO_FORM_FIELD: Record<string, keyof ResetPasswordFormValues> = {
  password: 'password',
  password_confirmation: 'passwordConfirmation',
};

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  // Set only for a 422 with no field errors (an invalid/expired link) — the
  // one case with no input to attach the message to, so it renders as a
  // standalone banner with a way back to request a fresh link.
  const [linkError, setLinkError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    defaultValues: { password: '', passwordConfirmation: '' },
  });

  async function onSubmit(data: ResetPasswordFormValues) {
    setLinkError(null);
    try {
      await resetPassword(token ?? '', {
        password: data.password,
        password_confirmation: data.passwordConfirmation,
      });
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) {
          for (const [field, message] of Object.entries(err.errors)) {
            const formField = BACKEND_FIELD_TO_FORM_FIELD[field];
            if (formField) {
              setError(formField, { message });
            }
          }
          return;
        }
        setLinkError(err.message);
        return;
      }
      throw err;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">Reset password</h1>

        {linkError ? (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {linkError}{' '}
            <Link to="/forgot-password" className="font-medium underline">
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register('password', { required: true })}
              />
              {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>}
            </div>

            <div>
              <label htmlFor="passwordConfirmation" className="block text-sm font-medium text-slate-700">
                Confirm password
              </label>
              <input
                id="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register('passwordConfirmation', { required: true })}
              />
              {errors.passwordConfirmation && (
                <p className="mt-1 text-sm text-red-600">{errors.passwordConfirmation.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Reset password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
