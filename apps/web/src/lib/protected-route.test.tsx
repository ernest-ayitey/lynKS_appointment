import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './protected-route';

const useAuth = vi.fn();

vi.mock('./auth-context', () => ({
  useAuth: () => useAuth(),
}));

function renderAt(initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/change-password" element={<ProtectedRoute>Change password page</ProtectedRoute>} />
        <Route path="/" element={<ProtectedRoute>Protected content</ProtectedRoute>} />
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

  it('renders children at /change-password without looping when a password change is required', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { must_change_password: true },
    });

    renderAt('/change-password');

    expect(screen.getByText('Change password page')).toBeInTheDocument();
  });
});
