import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import AuthSplitLayout from '../../components/auth-split-layout';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';

interface LoginFormValues {
  username: string;
  password: string;
  rememberMe: boolean;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginFormValues>({
    defaultValues: { username: '', password: '', rememberMe: false },
  });

  async function onSubmit(data: LoginFormValues) {
    setFormError(null);
    try {
      await login(data.username, data.password, data.rememberMe);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        return;
      }
      // Not an ApiError: the request never got a response (backend
      // unreachable, offline, fetch rejected). Surface it rather than
      // failing silently.
      setFormError(GENERIC_ERROR_MESSAGE);
    }
  }

  return (
    <AuthSplitLayout>
      <div className="flex w-full max-w-[400px] flex-col gap-5 rounded-xl border border-slate-300 bg-white p-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl text-slate-900">Sign in</h1>
          <p className="text-sm text-slate-500">
            Patients, doctors, records and admin staff all sign in here.
          </p>
        </div>

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

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('password', { required: true })}
            />
          </div>

          <label htmlFor="rememberMe" className="flex items-center gap-2 text-sm text-slate-700">
            <input id="rememberMe" type="checkbox" {...register('rememberMe')} />
            Keep me signed in
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Sign in
          </button>
        </form>

        <p className="text-center text-sm text-slate-600">
          New patient?{' '}
          <Link to="/register" className="text-blue-600 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
