import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import DoctorAppointmentsPage from '../doctor-appointments.page';

const authedFetch = vi.fn();
const listDoctorAppointments = vi.fn();
const markAppointmentOutcome = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch }),
}));

vi.mock('../doctor-appointments.api', () => ({
  listDoctorAppointments: (...args: unknown[]) => listDoctorAppointments(...args),
  markAppointmentOutcome: (...args: unknown[]) => markAppointmentOutcome(...args),
}));

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
}

function endOfWeek(date: Date): Date {
  const monday = startOfWeek(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

function doctorAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ref: 'REQ-00001',
    patient: { id: 1, first_name: 'Ama', last_name: 'Boateng', phone: '0551234567', sex: 'female', age: 34 },
    date: '2026-12-01',
    time: '09:00',
    duration_minutes: 20,
    visit_type: 'follow_up',
    reason: 'Follow-up checkup',
    status: 'approved',
    approved_by: { id: 10, first_name: 'Kofi', last_name: 'Mensah' },
    visit_notes: null,
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <DoctorAppointmentsPage />
    </MemoryRouter>,
  );
}

describe('DoctorAppointmentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDoctorAppointments.mockResolvedValue({ appointments: [], total: 0 });
  });

  // The backend's `GET /doctor/appointments` sorts ascending by (date, time)
  // with no implicit date filter, so an all-dates default would bury today's
  // work under months of completed history. The page defaults its date-range
  // filter to "This week" rather than "All dates" to compensate — this is the
  // same `dateRangeForPreset('this_week')` computation the date-range
  // `<select>` itself uses for the explicit preset.
  it('loads the list on mount defaulted to the This week date range, not all dates', async () => {
    const rows = [doctorAppointment({ id: 1 }), doctorAppointment({ id: 2, patient: { id: 2, first_name: 'Kofi', last_name: 'Mensah', phone: null, sex: null, age: null } })];
    listDoctorAppointments.mockResolvedValueOnce({ appointments: rows, total: 2 });

    renderPage();

    const today = new Date();
    const expectedFrom = isoDate(startOfWeek(today));
    const expectedTo = isoDate(endOfWeek(today));
    await waitFor(() =>
      expect(listDoctorAppointments).toHaveBeenCalledWith(authedFetch, { from: expectedFrom, to: expectedTo }),
    );
    expect(await screen.findByText('Ama Boateng')).toBeInTheDocument();
    expect(screen.getByText('Kofi Mensah')).toBeInTheDocument();
    expect(screen.getByLabelText('Date range')).toHaveValue('this_week');
  });

  // Day and Export are out of scope per this plan's Global Constraints (no
  // Day layout or Export format was ever specified) -- rendered as disabled
  // placeholders rather than omitted entirely, so the screen communicates
  // they're coming rather than looking unfinished. "List" is the only
  // working view and is shown as the current selection.
  it('renders Day/List/Export view-toggle controls, with Day and Export disabled', async () => {
    renderPage();
    await screen.findByText('No appointments to show.');

    expect(screen.getByRole('button', { name: 'Day' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    const listButton = screen.getByRole('button', { name: 'List' });
    expect(listButton).toBeDisabled();
    expect(listButton).toHaveAttribute('aria-current', 'true');
  });

  it('renders the empty-state message, not an error or a crash, when the doctor has zero appointments', async () => {
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [], total: 0 });

    renderPage();

    expect(await screen.findByText('No appointments to show.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the same empty-state message when a date-range filter matches nothing', async () => {
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [], total: 0 }); // initial mount
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [], total: 0 }); // after preset re-fetch
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Date range'), 'today');

    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(2));
    expect(screen.getByText('No appointments to show.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('typing in the search box re-fetches with the search term, keeping the default This week range', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(1));

    await user.type(screen.getByRole('searchbox'), 'Ama');

    const today = new Date();
    const expectedFrom = isoDate(startOfWeek(today));
    const expectedTo = isoDate(endOfWeek(today));
    await waitFor(() =>
      expect(listDoctorAppointments).toHaveBeenLastCalledWith(authedFetch, {
        search: 'Ama',
        from: expectedFrom,
        to: expectedTo,
      }),
    );
  });

  it('selecting the Today date-range preset re-fetches with from=to=today', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Date range'), 'today');

    const today = isoDate(new Date());
    await waitFor(() =>
      expect(listDoctorAppointments).toHaveBeenLastCalledWith(authedFetch, { from: today, to: today }),
    );
  });

  it('re-selecting the This week date-range preset (after switching away) re-fetches with the Monday-Sunday range', async () => {
    // "This week" is already the default on mount (see the mount test
    // above), so this exercises the explicit `<select>` path instead:
    // switch away to "Today" first, then back to "This week", and confirm
    // it recomputes the same Monday-Sunday range rather than this only ever
    // working as an initial-state fluke.
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Date range'), 'today');
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(2));

    await user.selectOptions(screen.getByLabelText('Date range'), 'this_week');

    const today = new Date();
    const expectedFrom = isoDate(startOfWeek(today));
    const expectedTo = isoDate(endOfWeek(today));
    await waitFor(() =>
      expect(listDoctorAppointments).toHaveBeenLastCalledWith(authedFetch, { from: expectedFrom, to: expectedTo }),
    );
  });

  it('selecting the Next 30 days date-range preset re-fetches with today and today+30', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Date range'), 'next_30_days');

    const today = new Date();
    const expectedFrom = isoDate(today);
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    const expectedTo = isoDate(end);
    await waitFor(() =>
      expect(listDoctorAppointments).toHaveBeenLastCalledWith(authedFetch, { from: expectedFrom, to: expectedTo }),
    );
  });

  it('clicking a row opens the detail panel with patient info, When/Type/Reason/Approved-by, and a visit notes textarea', async () => {
    const row = doctorAppointment({ id: 42, visit_notes: 'Prior note text' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });

    renderPage();
    await screen.findByText('Ama Boateng');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Review' }));

    const panel = screen.getByRole('complementary');
    expect(within(panel).getByText(/REQ-00001/)).toBeInTheDocument();
    expect(within(panel).getByText(/female/i)).toBeInTheDocument();
    expect(within(panel).getByText('34')).toBeInTheDocument();
    expect(within(panel).getByText('0551234567')).toBeInTheDocument();
    expect(within(panel).getByText('2026-12-01 at 09:00')).toBeInTheDocument();
    expect(within(panel).getByText('Follow Up')).toBeInTheDocument();
    expect(within(panel).getByText('Follow-up checkup')).toBeInTheDocument();
    // Not "Dr. Kofi Mensah" -- whoever approves an appointment is a Records
    // user per the Records Approval plan, never a doctor, so a hardcoded
    // "Dr." prefix here would misrepresent who actually approved it.
    expect(within(panel).getByText('Kofi Mensah')).toBeInTheDocument();
    expect(screen.getByLabelText('Visit notes')).toHaveValue('Prior note text');
  });

  it('shows dashes (not "null") for nil age/approved_by, and an empty textarea for nil visit_notes', async () => {
    const row = doctorAppointment({
      id: 42,
      patient: { id: 1, first_name: 'Ama', last_name: 'Boateng', phone: null, sex: null, age: null },
      approved_by: null,
      visit_notes: null,
    });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });

    renderPage();
    await screen.findByText('Ama Boateng');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByLabelText('Visit notes')).toHaveValue('');
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2); // approved_by + at least one of sex/age/phone
  });

  it('clicking "Mark completed" calls markAppointmentOutcome with status completed and then refetches', async () => {
    const row = doctorAppointment({ id: 42, status: 'approved' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [doctorAppointment({ id: 42, status: 'completed' })], total: 1 });
    markAppointmentOutcome.mockResolvedValueOnce(doctorAppointment({ id: 42, status: 'completed' }));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ama Boateng');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    await user.click(screen.getByRole('button', { name: 'Mark completed' }));

    await waitFor(() =>
      expect(markAppointmentOutcome).toHaveBeenCalledWith(authedFetch, 42, { status: 'completed', visit_notes: '' }),
    );
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(2));
  });

  it('clicking "No-show" calls markAppointmentOutcome with status no_show and then refetches', async () => {
    const row = doctorAppointment({ id: 42, status: 'approved' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [doctorAppointment({ id: 42, status: 'no_show' })], total: 1 });
    markAppointmentOutcome.mockResolvedValueOnce(doctorAppointment({ id: 42, status: 'no_show' }));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ama Boateng');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    await user.click(screen.getByRole('button', { name: 'No-show' }));

    await waitFor(() =>
      expect(markAppointmentOutcome).toHaveBeenCalledWith(authedFetch, 42, { status: 'no_show', visit_notes: '' }),
    );
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(2));
  });

  it('does not show Mark completed/No-show actions for an already-completed appointment', async () => {
    const row = doctorAppointment({ id: 42, status: 'completed' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });

    renderPage();
    await screen.findByText('Ama Boateng');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No-show' })).not.toBeInTheDocument();
  });

  // The real PATCH /appointments/:id 422 always carries the generic
  // 'Please correct the highlighted fields' as the top-level `error` and the
  // actionable detail under `errors.status` — `status` isn't a form field on
  // this screen, so the banner must show the field detail, not the generic
  // message. An earlier version of this test constructed the ApiError with
  // the actionable text as the top-level `message`, a shape the backend
  // never actually sends, which is how the "banner shows only the generic
  // message" bug got through. Mirrors
  // doctor-availability.page.test.tsx's equivalent fixture.
  it('renders the field-level error banner when markAppointmentOutcome fails with a 422, not the generic message', async () => {
    const row = doctorAppointment({ id: 42, status: 'approved' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    markAppointmentOutcome.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        status: 'Only an approved appointment can be marked completed or no-show',
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ama Boateng');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    await user.click(screen.getByRole('button', { name: 'Mark completed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an approved appointment can be marked completed or no-show',
    );
    expect(screen.queryByText('Please correct the highlighted fields')).not.toBeInTheDocument();
  });

  it('falls back to the generic message when markAppointmentOutcome fails with no field errors', async () => {
    const row = doctorAppointment({ id: 42, status: 'approved' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    markAppointmentOutcome.mockRejectedValueOnce(new ApiError('Session expired', 401));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ama Boateng');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    await user.click(screen.getByRole('button', { name: 'Mark completed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  });

  it('shows a generic error banner when the initial load fails with a non-ApiError rejection', async () => {
    listDoctorAppointments.mockReset();
    listDoctorAppointments.mockRejectedValueOnce(new Error('network down'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});
