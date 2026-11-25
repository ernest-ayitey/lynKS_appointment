import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-context';
import { checkUsernameAvailability } from './auth.api';

interface RegisterFormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  email: string;
  phone: string;
  username: string;
  password: string;
  passwordConfirmation: string;
  acceptTerms: boolean;
}

// Maps the backend's snake_case error keys (apps/api/app/routes/auth.rb) to
// this form's field names, so a 422 error attaches to the right input even
// where the names diverge (e.g. password_confirmation -> passwordConfirmation).
const BACKEND_FIELD_TO_FORM_FIELD: Record<string, keyof RegisterFormValues> = {
  first_name: 'firstName',
  last_name: 'lastName',
  date_of_birth: 'dateOfBirth',
  gender: 'gender',
  email: 'email',
  phone: 'phone',
  username: 'username',
  password: 'password',
  password_confirmation: 'passwordConfirmation',
  accept_terms: 'acceptTerms',
};

// Mirrors the backend's password_policy_valid? in apps/api/app/routes/auth.rb:
// at least 8 characters, with at least one digit and one symbol.
function passwordStrength(password: string) {
  return {
    length: password.length >= 8,
    digit: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    defaultValues: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      gender: '',
      email: '',
      phone: '',
      username: '',
      password: '',
      passwordConfirmation: '',
      acceptTerms: false,
    },
  });

  const username = watch('username');
  const password = watch('password');
  const strength = passwordStrength(password);

  // Debounce the availability check so it fires once typing settles,
  // rather than on every keystroke.
  const [debouncedUsername, setDebouncedUsername] = useState('');
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedUsername(username), 400);
    return () => clearTimeout(timeout);
  }, [username]);

  const {
    data: usernameAvailable,
    isFetching: checkingUsername,
    isError: usernameCheckErrored,
  } = useQuery({
    queryKey: ['username-availability', debouncedUsername],
    queryFn: () => checkUsernameAvailability(debouncedUsername),
    enabled: debouncedUsername.length >= 4,
    retry: false,
  });

  async function onSubmit(data: RegisterFormValues) {
    setFormError(null);
    try {
      await registerUser({
        first_name: data.firstName,
        last_name: data.lastName,
        date_of_birth: data.dateOfBirth,
        gender: data.gender,
        email: data.email,
        phone: data.phone,
        username: data.username,
        password: data.password,
        password_confirmation: data.passwordConfirmation,
        accept_terms: data.acceptTerms,
      });
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">Create an account</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {formError && (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-slate-700">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register('firstName', { required: true })}
              />
            </div>

            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-slate-700">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register('lastName', { required: true })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="dateOfBirth" className="block text-sm font-medium text-slate-700">
              Date of birth
            </label>
            {/* A native date input's value is already YYYY-MM-DD, exactly the
                ISO-8601 string apps/api/app/routes/auth.rb's parse_date requires —
                it is passed straight through in the payload with no conversion. */}
            <input
              id="dateOfBirth"
              type="date"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('dateOfBirth', { required: true })}
            />
            {errors.dateOfBirth && (
              <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="gender" className="block text-sm font-medium text-slate-700">
              Gender
            </label>
            <select
              id="gender"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('gender')}
            >
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('email', { required: true })}
            />
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('phone')}
            />
            {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
          </div>

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
            {errors.username ? (
              <p className="mt-1 text-sm text-red-600">{errors.username.message}</p>
            ) : (
              debouncedUsername.length >= 4 &&
              debouncedUsername === username && (
                <p className="mt-1 text-sm text-slate-500">
                  {checkingUsername
                    ? 'Checking availability…'
                    : usernameCheckErrored
                      ? "Can't check availability right now"
                      : usernameAvailable
                        ? 'Username is available'
                        : 'Username is taken'}
                </p>
              )
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('password', { required: true })}
            />
            <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
              <li className={strength.length ? 'text-green-600' : undefined}>At least 8 characters</li>
              <li className={strength.digit ? 'text-green-600' : undefined}>Contains a digit</li>
              <li className={strength.symbol ? 'text-green-600' : undefined}>Contains a symbol</li>
            </ul>
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

          <label htmlFor="acceptTerms" className="flex items-start gap-2 text-sm text-slate-700">
            <input
              id="acceptTerms"
              type="checkbox"
              className="mt-0.5"
              {...register('acceptTerms', { required: true })}
            />
            I accept the terms and conditions
          </label>
          {errors.acceptTerms && (
            <p className="mt-1 text-sm text-red-600">{errors.acceptTerms.message}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Create account
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
