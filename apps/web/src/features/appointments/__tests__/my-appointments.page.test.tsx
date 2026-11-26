import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import MyAppointmentsPage from '../my-appointments.page';

const authedFetch = vi.fn();
const listAppointments = vi.fn();
const cancelAppointment = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch }),
}));

vi.mock('../appointments.api', () => ({
  listAppointments: (...args: unknown[]) => listAppointments(...args),
  cancelAppointment: (...args: unknown[]) => cancelAppointment(...args),
}));

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    doctor: { id: 10, first_name: 'Ama', last_name: 'Boateng' },
    department: { id: 1, name: 'Cardiology' },
    date: '2026-12-01',
    time: '09:00',
    duration_minutes: 20,
    visit_type: 'follow_up',
    reason: 'Follow-up checkup',
    status: 'pending',
    submitted_at: '2026-11-26T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <MyAppointmentsPage />
    </MemoryRouter>,
  );
}

describe('MyAppointmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAppointments.mockResolvedValue({ appointments: [], total: 0 });
  });

  it('loads the All tab with no params on mount and renders the returned rows with status tags', async () => {
    const rows = [
      appointment({ id: 1, status: 'pending' }),
      appointment({ id: 2, status: 'approved', doctor: { id: 11, first_name: 'Kofi', last_name: 'Mensah' } }),
    ];
    listAppointments.mockResolvedValueOnce({ appointments: rows, total: 2 });

    renderPage();

    await screen.findByText(/ama boateng/i);
    expect(listAppointments).toHaveBeenCalledWith(authedFetch, {});
    expect(screen.getByText(/kofi mensah/i)).toBeInTheDocument();
    // Status tags for the two rows, via a test id so this doesn't collide
    // with the "Pending" tab button's own label text.
    const rowStatusTags = screen.getAllByTestId('appointment-status');
    expect(rowStatusTags.map((tag) => tag.textContent)).toEqual(['Pending', 'Approved']);
  });

  it('switching to the Upcoming tab re-calls listAppointments with status=approved', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Upcoming' }));

    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    expect(listAppointments).toHaveBeenLastCalledWith(authedFetch, { status: 'approved' });
  });

  it('switching to the Pending tab re-calls listAppointments with status=pending', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Pending' }));

    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    expect(listAppointments).toHaveBeenLastCalledWith(authedFetch, { status: 'pending' });
  });

  it('switching to the Past tab re-calls listAppointments with a to=yesterday param and no status', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Past' }));

    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    const lastCallFilters = listAppointments.mock.calls[1][1];
    expect(lastCallFilters).toEqual({ to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expectedYesterday = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(
      yesterday.getDate(),
    ).padStart(2, '0')}`;
    expect(lastCallFilters.to).toBe(expectedYesterday);
  });

  it('switching to the Declined/cancelled tab re-calls listAppointments with a single comma-separated status value', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Declined/cancelled' }));

    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
    expect(listAppointments).toHaveBeenLastCalledWith(authedFetch, { status: 'declined,cancelled' });
  });

  it('shows a Cancel action only for pending/approved rows, never for terminal statuses', async () => {
    const rows = [
      appointment({ id: 1, status: 'pending' }),
      appointment({ id: 2, status: 'approved' }),
      appointment({ id: 3, status: 'declined' }),
      appointment({ id: 4, status: 'cancelled' }),
      appointment({ id: 5, status: 'completed' }),
    ];
    listAppointments.mockResolvedValueOnce({ appointments: rows, total: rows.length });

    renderPage();

    await screen.findAllByText(/ama boateng/i);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
  });

  it('cancelling an appointment calls cancelAppointment and refetches the list', async () => {
    const rows = [appointment({ id: 1, status: 'pending' })];
    listAppointments.mockResolvedValueOnce({ appointments: rows, total: 1 });
    listAppointments.mockResolvedValueOnce({ appointments: [], total: 0 });
    cancelAppointment.mockResolvedValueOnce(appointment({ id: 1, status: 'cancelled' }));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/ama boateng/i);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledWith(authedFetch, 1));
    await waitFor(() => expect(listAppointments).toHaveBeenCalledTimes(2));
  });

  it('renders a banner via applyApiError-style fallback when cancelAppointment fails', async () => {
    const rows = [appointment({ id: 1, status: 'pending' })];
    listAppointments.mockResolvedValueOnce({ appointments: rows, total: 1 });
    cancelAppointment.mockRejectedValueOnce(new ApiError('This appointment can no longer be cancelled', 422));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/ama boateng/i);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This appointment can no longer be cancelled');
  });

  it('shows a generic error banner when the initial load fails with a non-ApiError rejection', async () => {
    listAppointments.mockReset();
    listAppointments.mockRejectedValueOnce(new Error('network down'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});
