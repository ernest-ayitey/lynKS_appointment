import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RoleLandingPage from '../role-landing.page';

const useAuth = vi.fn();
const logout = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => useAuth(),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <RoleLandingPage />
    </MemoryRouter>,
  );
}

describe('RoleLandingPage', () => {
  it('renders a link to the doctor availability page when the user is a doctor', () => {
    useAuth.mockReturnValue({
      user: { role: 'doctor', first_name: 'Jane', last_name: 'Smith' },
      logout,
    });

    renderPage();

    const link = screen.getByRole('link', { name: /availability/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/doctor/availability');
  });

  it('does not render a link to the doctor availability page when the user is not a doctor', () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'John', last_name: 'Doe' },
      logout,
    });

    renderPage();

    expect(screen.queryByRole('link', { name: /availability/i })).not.toBeInTheDocument();
  });

  it('renders links to book an appointment and my appointments pages when the user is a patient', () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'John', last_name: 'Doe' },
      logout,
    });

    renderPage();

    const bookLink = screen.getByRole('link', { name: /book an appointment/i });
    expect(bookLink).toBeInTheDocument();
    expect(bookLink).toHaveAttribute('href', '/book');

    const appointmentsLink = screen.getByRole('link', { name: /my appointments/i });
    expect(appointmentsLink).toBeInTheDocument();
    expect(appointmentsLink).toHaveAttribute('href', '/appointments');
  });

  it('does not render patient links when the user is not a patient', () => {
    useAuth.mockReturnValue({
      user: { role: 'doctor', first_name: 'Jane', last_name: 'Smith' },
      logout,
    });

    renderPage();

    expect(screen.queryByRole('link', { name: /book an appointment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /my appointments/i })).not.toBeInTheDocument();
  });

  it('renders a link to the records queue page when the user is a records role', () => {
    useAuth.mockReturnValue({
      user: { role: 'records', first_name: 'Alice', last_name: 'Johnson' },
      logout,
    });

    renderPage();

    const link = screen.getByRole('link', { name: /review requests/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/records/queue');
  });

  it('does not render a link to the records queue page when the user is not a records role', () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'John', last_name: 'Doe' },
      logout,
    });

    renderPage();

    expect(screen.queryByRole('link', { name: /review requests/i })).not.toBeInTheDocument();
  });

  it('renders the sign in information and logout button for all roles', async () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'John', last_name: 'Doe' },
      logout,
    });

    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText(/signed in as patient: John Doe/i)).toBeInTheDocument();
    const logoutButton = screen.getByRole('button', { name: /log out/i });
    expect(logoutButton).toBeInTheDocument();

    await user.click(logoutButton);
    expect(logout).toHaveBeenCalled();
  });
});
