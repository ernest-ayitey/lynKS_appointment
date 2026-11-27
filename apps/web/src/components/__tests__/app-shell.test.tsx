import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AppShell from '../app-shell';

const useAuth = vi.fn();
const logout = vi.fn();

vi.mock('../../lib/auth-context', () => ({
  useAuth: () => useAuth(),
}));

function renderShell(props: { activeNavKey?: Parameters<typeof AppShell>[0]['activeNavKey'] } = {}) {
  render(
    <MemoryRouter>
      <AppShell {...props}>
        <div>page content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders the Dashboard/My availability/Appointments/Profile nav for a doctor, with Dashboard and Profile inert', () => {
    useAuth.mockReturnValue({
      user: { role: 'doctor', first_name: 'Kwame', last_name: 'Asante' },
      logout,
    });

    renderShell();

    const availabilityLink = screen.getByRole('link', { name: /my availability/i });
    expect(availabilityLink).toHaveAttribute('href', '/doctor/availability');

    const appointmentsLink = screen.getByRole('link', { name: /appointments/i });
    expect(appointmentsLink).toHaveAttribute('href', '/doctor/appointments');

    expect(screen.queryByRole('link', { name: /^dashboard$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^dashboard$/i)).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: /^profile$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^profile$/i)).toBeInTheDocument();
  });

  it('renders the Dashboard/Book appointment/My appointments/Profile nav for a patient, with Dashboard and Profile inert', () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'Ama', last_name: 'Mensah' },
      logout,
    });

    renderShell();

    const bookLink = screen.getByRole('link', { name: /book appointment/i });
    expect(bookLink).toHaveAttribute('href', '/book');

    const myAppointmentsLink = screen.getByRole('link', { name: /my appointments/i });
    expect(myAppointmentsLink).toHaveAttribute('href', '/appointments');

    expect(screen.queryByRole('link', { name: /^dashboard$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^dashboard$/i)).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: /^profile$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^profile$/i)).toBeInTheDocument();
  });

  it("renders the Approval queue/All appointments/Doctors' calendars/Patients/Reports nav for records, with every item but Approval queue inert", () => {
    useAuth.mockReturnValue({
      user: { role: 'records', first_name: 'Efua', last_name: 'Boateng' },
      logout,
    });

    renderShell();

    const queueLink = screen.getByRole('link', { name: /approval queue/i });
    expect(queueLink).toHaveAttribute('href', '/records/queue');

    for (const label of ['All appointments', "Doctors' calendars", 'Patients', 'Reports']) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${label}$`, 'i') })).not.toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('an inert nav item has no href and aria-disabled="true", and is not in the accessible link list', () => {
    useAuth.mockReturnValue({
      user: { role: 'doctor', first_name: 'Kwame', last_name: 'Asante' },
      logout,
    });

    renderShell();

    const dashboardLabel = screen.getByText(/^dashboard$/i);
    const container = dashboardLabel.closest('[aria-disabled]');
    expect(container).not.toBeNull();
    expect(container).toHaveAttribute('aria-disabled', 'true');
    expect(container?.tagName).not.toBe('A');

    const linkNames = screen.getAllByRole('link').map((link) => link.textContent);
    expect(linkNames.join(' ')).not.toMatch(/dashboard/i);
  });

  it('renders an empty sidebar for a role with no NAV_ITEMS entry (e.g. admin), not a crash', () => {
    useAuth.mockReturnValue({
      user: { role: 'admin', first_name: 'Ad', last_name: 'Min' },
      logout,
    });

    renderShell();

    const nav = screen.getByRole('navigation');
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
    expect(within(nav).queryAllByText(/\S/)).toHaveLength(0);
  });

  it('highlights the nav item matching activeNavKey', () => {
    useAuth.mockReturnValue({
      user: { role: 'doctor', first_name: 'Kwame', last_name: 'Asante' },
      logout,
    });

    renderShell({ activeNavKey: 'doctor-appointments' });

    const appointmentsLink = screen.getByRole('link', { name: /appointments/i });
    expect(appointmentsLink).toHaveAttribute('aria-current', 'page');

    const availabilityLink = screen.getByRole('link', { name: /my availability/i });
    expect(availabilityLink).not.toHaveAttribute('aria-current');
  });

  it('highlights nothing when activeNavKey is omitted', () => {
    useAuth.mockReturnValue({
      user: { role: 'doctor', first_name: 'Kwame', last_name: 'Asante' },
      logout,
    });

    renderShell();

    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it("renders the signed-in user's name and role, and a working Log out button", async () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'Ama', last_name: 'Mensah' },
      logout,
    });

    const user = userEvent.setup();
    renderShell();

    expect(screen.getByText('Ama Mensah')).toBeInTheDocument();
    expect(screen.getByText('patient')).toBeInTheDocument();

    const logoutButton = screen.getByRole('button', { name: /log out/i });
    await user.click(logoutButton);
    expect(logout).toHaveBeenCalled();
  });
});
