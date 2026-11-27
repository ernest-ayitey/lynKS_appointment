import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const useAuth = vi.fn();
const logout = vi.fn();

vi.mock('./lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => useAuth(),
}));

describe('App', () => {
  beforeEach(() => {
    // BrowserRouter reads the real jsdom location, which otherwise carries
    // over between tests (e.g. a prior test's redirect to /login).
    window.history.pushState({}, '', '/');
  });

  it('renders the login page at the default route when unauthenticated', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', user: null });

    render(<App />);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('lets an authenticated user log out from the landing page via AppShell', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { role: 'patient', first_name: 'John', last_name: 'Doe', must_change_password: false },
      logout,
    });

    const user = userEvent.setup();
    render(<App />);

    const logoutButton = screen.getByRole('button', { name: /log out/i });
    await user.click(logoutButton);

    expect(logout).toHaveBeenCalled();
  });
});
