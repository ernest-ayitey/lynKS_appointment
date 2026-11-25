import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
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
      throw err;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">Sign in</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('password', { required: true })}
            />
          </div>

          <div className="flex items-center justify-between">
            <label htmlFor="rememberMe" className="flex items-center gap-2 text-sm text-slate-700">
              <input id="rememberMe" type="checkbox" {...register('rememberMe')} />
              Keep me signed in
            </label>
            <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-blue-600 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
