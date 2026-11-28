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

  // Reviewer finding: a doctor landing on `/` used to see the generic
  // `RoleLandingPage` stub ("Signed in as doctor: ...") instead of their
  // real dashboard, which otherwise is reachable only via the sidebar's
  // "Dashboard" link -- leaving two different things both called
  // "Dashboard". `/` must redirect a doctor straight to
  // `/doctor/dashboard`; patient/records roles are unaffected (their own
  // dashboards don't exist yet).
  it('redirects an authenticated doctor at / to /doctor/dashboard instead of RoleLandingPage', async () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { role: 'doctor', first_name: 'Dana', last_name: 'Who', must_change_password: false },
      logout,
      // Rejects deliberately -- this test only cares about which page
      // renders at `/`, not about DoctorDashboardPage's own data-fetching
      // behavior (covered by doctor-dashboard.page.test.tsx).
      authedFetch: vi.fn().mockRejectedValue(new Error('not relevant to this test')),
    });

    render(<App />);

    expect(await screen.findByText("Today's schedule")).toBeInTheDocument();
    expect(window.location.pathname).toBe('/doctor/dashboard');
    expect(screen.queryByText(/signed in as doctor/i)).not.toBeInTheDocument();
  });

  it.each(['patient', 'records'])('still renders RoleLandingPage at / for a %s user', async (role) => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      user: { role, first_name: 'Jane', last_name: 'Roe', must_change_password: false },
      logout,
    });

    render(<App />);

    expect(await screen.findByText(`Signed in as ${role}: Jane Roe`)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
