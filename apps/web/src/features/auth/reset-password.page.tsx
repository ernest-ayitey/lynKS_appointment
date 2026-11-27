import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AuthCard from '../../components/auth-card';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE, applyApiError } from '../../lib/api-error-handling';
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
  const [formError, setFormError] = useState<string | null>(null);
  // True when the failure attached to no input at all — a 422 for an
  // invalid/expired link, a 401, a network failure. Those are the cases where
  // retyping the same passwords cannot help, so the banner also offers a way
  // back to request a fresh link.
  const [offerNewLink, setOfferNewLink] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    defaultValues: { password: '', passwordConfirmation: '' },
  });

  async function onSubmit(data: ResetPasswordFormValues) {
    setFormError(null);
    setOfferNewLink(false);
    try {
      await resetPassword(token ?? '', {
        password: data.password,
        password_confirmation: data.passwordConfirmation,
      });
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        const attachedFieldError = applyApiError(
          err,
          BACKEND_FIELD_TO_FORM_FIELD,
          setError,
          setFormError,
        );
        setOfferNewLink(!attachedFieldError);
        return;
      }
      // Not an ApiError: the request never got a response (backend
      // unreachable, offline, fetch rejected). Surface it rather than
      // failing silently.
      setFormError(GENERIC_ERROR_MESSAGE);
    }
  }

  return (
    <AuthCard stepLabel="STEP 2 OF 2 · opened from email link" title="Choose a new password">
      {offerNewLink && formError ? (
        // Nothing the user can retype here will help (the link itself is
        // dead, or the request was rejected outright), so the form is
        // replaced by the banner and a way to start over.
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}{' '}
          <Link to="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          {formError && (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

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
              Confirm new password
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

          <p className="text-xs text-slate-500">Link expires after 30 minutes.</p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Save and sign in
          </button>
        </form>
      )}
    </AuthCard>
  );
}
