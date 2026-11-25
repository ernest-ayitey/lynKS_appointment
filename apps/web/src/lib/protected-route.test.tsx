import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './protected-route';

const useAuth = vi.fn();

vi.mock('./auth-context', () => ({
  useAuth: () => useAuth(),
}));

function renderAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/change-password" element={<ProtectedRoute>Change password page</ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute>Protected content</ProtectedRoute>} />
        <Route
          path="/doctor-only"
          element={
            <ProtectedRoute allowedRoles={['doctor']}>Doctor-only content</ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when unauthenticated', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', user: null });

    renderAt('/');

    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redirects to /change-password when the user must change their password', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { must_change_password: true },
    });

    renderAt('/');

    expect(screen.getByText('Change password page')).toBeInTheDocument();
  });

  it('renders nothing at all while the session is still loading', () => {
    useAuth.mockReturnValue({ status: 'loading', user: null });

    const { container } = renderAt('/');

    // Neither the children nor a redirect: the boot refresh has not settled,
    // so there is nothing to decide yet.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('fails closed to /login when authenticated with a null user', () => {
    // Unreachable by construction today, but this is the gate every protected
    // page wraps in: an ambiguous state must never render the app.
    useAuth.mockReturnValue({ status: 'authenticated', user: null });

    renderAt('/');

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders children for an authenticated user who does not need a password change', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { must_change_password: false },
    });

    renderAt('/');

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('renders children at /change-password without looping when a password change is required', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { must_change_password: true },
    });

    renderAt('/change-password');

    expect(screen.getByText('Change password page')).toBeInTheDocument();
  });

  it('redirects to / when allowedRoles is set and the user role is not in it', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { role: 'patient', must_change_password: false },
    });

    renderAt('/doctor-only');

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.queryByText('Doctor-only content')).not.toBeInTheDocument();
  });

  it('renders children when allowedRoles is set and the user role is in it', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { role: 'doctor', must_change_password: false },
    });

    renderAt('/doctor-only');

    expect(screen.getByText('Doctor-only content')).toBeInTheDocument();
  });
});
