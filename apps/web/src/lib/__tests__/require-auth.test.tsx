import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { authStorage } from '../auth-storage';
import { RequireAuth } from '../require-auth';

function SignInStub() {
  return <div>Sign-in screen</div>;
}

function StaffSignInStub() {
  return <div>Staff sign-in screen</div>;
}

function ProtectedStub() {
  return <div>Protected content</div>;
}

function renderWithGuard(signInPath?: string) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={
            <RequireAuth signInPath={signInPath}>
              <ProtectedStub />
            </RequireAuth>
          }
        />
        <Route path="/sign-in" element={<SignInStub />} />
        <Route path="/staff/sign-in" element={<StaffSignInStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAuth', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('redirects to the default sign-in page when there is no access token', () => {
    renderWithGuard();

    expect(screen.getByText('Sign-in screen')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects to the given sign-in path when there is no access token', () => {
    renderWithGuard('/staff/sign-in');

    expect(screen.getByText('Staff sign-in screen')).toBeInTheDocument();
  });

  it('renders children when an access token is stored', () => {
    authStorage.setTokens({ accessToken: 'token', refreshToken: 'refresh' });

    renderWithGuard();

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});
