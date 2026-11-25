import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';

interface ChangePasswordFormValues {
  currentPassword: string;
  password: string;
  passwordConfirmation: string;
}

const BACKEND_FIELD_TO_FORM_FIELD: Record<string, keyof ChangePasswordFormValues> = {
  current_password: 'currentPassword',
  password: 'password',
  password_confirmation: 'passwordConfirmation',
};

export default function ChangePasswordPage() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    defaultValues: { currentPassword: '', password: '', passwordConfirmation: '' },
  });

  async function onSubmit(data: ChangePasswordFormValues) {
    try {
      await changePassword({
        current_password: data.currentPassword,
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
        }
        return;
      }
      throw err;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">Change password</h1>

        {user?.must_change_password && (
          <div role="alert" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            You must change your password before continuing.
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-700">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('currentPassword', { required: true })}
            />
            {errors.currentPassword && (
              <p className="mt-1 text-sm text-red-600">{errors.currentPassword.message}</p>
            )}
          </div>

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
            Change password
          </button>
        </form>
      </div>
    </div>
  );
}
