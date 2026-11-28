import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import DoctorDashboardPage from '../doctor-dashboard.page';

const authedFetch = vi.fn();
const getDashboardStats = vi.fn();
const getRecentEmails = vi.fn();
const listDoctorAppointments = vi.fn();
const markAppointmentOutcome = vi.fn();
const getAvailability = vi.fn();
const getSlots = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch, user: { id: 7, first_name: 'Kwame', last_name: 'Asante', role: 'doctor' } }),
}));

vi.mock('../doctor-dashboard.api', () => ({
  getDashboardStats: (...args: unknown[]) => getDashboardStats(...args),
  getRecentEmails: (...args: unknown[]) => getRecentEmails(...args),
}));

vi.mock('../doctor-appointments.api', () => ({
  listDoctorAppointments: (...args: unknown[]) => listDoctorAppointments(...args),
  markAppointmentOutcome: (...args: unknown[]) => markAppointmentOutcome(...args),
}));

vi.mock('../doctor.api', () => ({
  getAvailability: (...args: unknown[]) => getAvailability(...args),
  getSlots: (...args: unknown[]) => getSlots(...args),
}));

function doctorAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ref: 'REQ-00001',
    patient: { id: 1, first_name: 'Ama', last_name: 'Boateng', phone: '0551234567', sex: 'female', age: 34 },
    date: '2026-01-15',
    time: '09:00',
    duration_minutes: 20,
    visit_type: 'follow_up',
    reason: 'Follow-up checkup',
    status: 'approved',
    approved_by: null,
    visit_notes: null,
    ...overrides,
  };
}

const DEFAULT_STATS = { patients_today: 0, this_week: 0, pending: 0, available_days_this_month: 0 };

// Pinned to a fixed date/time rather than the real `new Date()`, mirroring
// book-appointment.page.test.tsx's own precedent for the same reason: the
// page calls `new Date()` at render time (for "today", for the "Next"
// computation relative to the current wall clock, and for "today-or-later"
// filtering of upcoming available days), so the fixtures below and the
// component need to agree on what "now" is. January 15, 2026 is a Thursday,
// 10:00am local time.
const FIXED_NOW = new Date(2026, 0, 15, 10, 0);
// `toFake: ['Date']` only -- faking setTimeout/microtasks too would stall
// `userEvent` and `waitFor`, which depend on real timers to resolve.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(FIXED_NOW);

function renderPage() {
  render(
    <MemoryRouter>
      <DoctorDashboardPage />
    </MemoryRouter>,
  );
}

describe('DoctorDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDashboardStats.mockResolvedValue(DEFAULT_STATS);
    getRecentEmails.mockResolvedValue({ emails: [] });
    listDoctorAppointments.mockResolvedValue({ appointments: [], total: 0 });
    getAvailability.mockResolvedValue({ days: [] });
    // Empty by default -- a non-empty default would otherwise sneak a
    // spurious "Open slot" row into the empty-schedule test below, since
    // getSlots is now the real source of those rows for today. Tests that
    // need free slots (today's-schedule gap tests, the full-day-tagging
    // test) set their own getSlots return value explicitly.
    getSlots.mockResolvedValue({ slots: [] });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('renders the four stat cards from getDashboardStats', async () => {
    getDashboardStats.mockResolvedValueOnce({
      patients_today: 8,
      this_week: 23,
      pending: 5,
      available_days_this_month: 9,
    });

    renderPage();

    expect(await screen.findByTestId('stat-patients-today')).toHaveTextContent('8');
    expect(screen.getByTestId('stat-this-week')).toHaveTextContent('23');
    expect(screen.getByTestId('stat-pending')).toHaveTextContent('5');
    expect(screen.getByTestId('stat-available-days')).toHaveTextContent('9');
    expect(screen.getByText('Patients today')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Pending (with Records)')).toBeInTheDocument();
    expect(screen.getByText('Available days this month')).toBeInTheDocument();
  });

  it("renders today's schedule in time order with Completed/Next/Approved/Arrived tags and an Open-slot row for a gap", async () => {
    const rows = [
      doctorAppointment({
        id: 1,
        time: '09:00',
        duration_minutes: 20,
        status: 'completed',
        patient: { id: 1, first_name: 'Yaw', last_name: 'Boakye', phone: null, sex: null, age: null },
      }),
      doctorAppointment({
        id: 2,
        time: '09:20',
        duration_minutes: 20,
        status: 'arrived',
        patient: { id: 2, first_name: 'Esi', last_name: 'Quaye', phone: null, sex: null, age: null },
      }),
      // Gap: appointment 2 ends at 09:40, appointment 3 doesn't start until
      // 10:30 -- a 50-minute open slot.
      doctorAppointment({
        id: 3,
        time: '10:30',
        duration_minutes: 20,
        status: 'approved',
        patient: { id: 3, first_name: 'Ama', last_name: 'Mensah', phone: null, sex: null, age: null },
      }),
      doctorAppointment({
        id: 4,
        time: '10:50',
        duration_minutes: 40,
        status: 'approved',
        patient: { id: 4, first_name: 'Kojo', last_name: 'Antwi', phone: null, sex: null, age: null },
      }),
    ];
    listDoctorAppointments.mockResolvedValueOnce({ appointments: rows, total: 4 });
    // getSlots is the real source of "Open slot" rows (not duration_minutes
    // gap math) -- '09:00' is already occupied by appointment #1 so it's
    // filtered out as a free slot; '09:40' (appointment #2's end time, free
    // until #3 starts at 10:30) is the one genuine open slot in this
    // fixture.
    getSlots.mockResolvedValueOnce({ slots: ['09:00', '09:40'] });

    renderPage();

    const section = (await screen.findByText("Today's schedule")).closest('section') as HTMLElement;
    await within(section).findByText('Ama Mensah', { exact: false });

    const text = section.textContent ?? '';
    // Time order, plus the inserted open-slot row for the 09:40-10:30 gap.
    expect(text.indexOf('09:00')).toBeLessThan(text.indexOf('09:20'));
    expect(text.indexOf('09:20')).toBeLessThan(text.indexOf('Open slot'));
    expect(text.indexOf('Open slot')).toBeLessThan(text.indexOf('10:30'));
    expect(text.indexOf('10:30')).toBeLessThan(text.indexOf('10:50'));

    expect(within(section).getByText('Completed')).toBeInTheDocument();
    expect(within(section).getByText('Arrived')).toBeInTheDocument();
    expect(within(section).getByText('Approved')).toBeInTheDocument();
    // Fixed "now" is 10:00am: appointment #2 (arrived, 09:20) has already
    // passed, so the chronologically-next approved/arrived appointment is
    // #3 at 10:30, not simply "the first approved one in the list" (#4).
    expect(within(section).getByText('Next')).toBeInTheDocument();
    expect(within(section).queryAllByText('Approved')).toHaveLength(1);
  });

  // Reviewer finding: pure duration_minutes gap-math between appointments
  // can never produce a *trailing* gap after the last appointment -- but
  // the wireframe (DoctorDashboard.dc.html:61) explicitly shows exactly
  // that ("14:00 · Open slot" after the 11:30 appointment, nothing
  // following it). getSlots-diffing fixes this for free: any free slot at
  // or after the last appointment's end time still shows up.
  it("renders a trailing Open-slot row after the day's last appointment, matching the wireframe's own example", async () => {
    const row = doctorAppointment({
      id: 1,
      time: '09:00',
      duration_minutes: 20,
      status: 'completed',
      patient: { id: 1, first_name: 'Yaw', last_name: 'Boakye', phone: null, sex: null, age: null },
    });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    // '09:00' is occupied by the appointment above; '14:00' is free and
    // comes well after the appointment ends -- a trailing gap, not a gap
    // between two appointments.
    getSlots.mockResolvedValueOnce({ slots: ['09:00', '14:00'] });

    renderPage();

    const section = (await screen.findByText("Today's schedule")).closest('section') as HTMLElement;
    await within(section).findByText('Yaw Boakye', { exact: false });

    expect(within(section).getByText('14:00')).toBeInTheDocument();
    expect(within(section).getByText('Open slot')).toBeInTheDocument();
    expect(within(section).queryAllByText('Open slot')).toHaveLength(1);
    const text = section.textContent ?? '';
    expect(text.indexOf('09:00')).toBeLessThan(text.indexOf('14:00'));
  });

  // Reviewer finding: getSlots already excludes the doctor's break window,
  // so a lunch break between two appointments must never be mislabeled as
  // bookable "Open slot" time, even though there's a real time gap there.
  it('does not render an Open-slot row for a lunch-break gap between two appointments', async () => {
    const morning = doctorAppointment({
      id: 1,
      time: '09:00',
      duration_minutes: 180, // ends at 12:00
      status: 'completed',
      patient: { id: 1, first_name: 'Yaw', last_name: 'Boakye', phone: null, sex: null, age: null },
    });
    const afternoon = doctorAppointment({
      id: 2,
      time: '13:00', // the 12:00-13:00 break sits entirely between these two
      duration_minutes: 20,
      status: 'approved',
      patient: { id: 2, first_name: 'Esi', last_name: 'Quaye', phone: null, sex: null, age: null },
    });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [morning, afternoon], total: 2 });
    // getSlots never offers a break-time slot -- the only slot it returns
    // is '09:00', which is already occupied by the morning appointment.
    getSlots.mockResolvedValueOnce({ slots: ['09:00'] });

    renderPage();

    const section = (await screen.findByText("Today's schedule")).closest('section') as HTMLElement;
    await within(section).findByText('Esi Quaye', { exact: false });

    expect(within(section).queryByText('Open slot')).not.toBeInTheDocument();
  });

  it('clicking Mark arrived on the next appointment calls markAppointmentOutcome and refetches', async () => {
    const row = doctorAppointment({ id: 42, time: '10:30', status: 'approved' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    listDoctorAppointments.mockResolvedValueOnce({
      appointments: [doctorAppointment({ id: 42, time: '10:30', status: 'arrived' })],
      total: 1,
    });
    markAppointmentOutcome.mockResolvedValueOnce(doctorAppointment({ id: 42, status: 'arrived' }));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ama Boateng');

    await user.click(screen.getByRole('button', { name: 'Mark arrived' }));

    await waitFor(() =>
      expect(markAppointmentOutcome).toHaveBeenCalledWith(authedFetch, 42, { status: 'arrived' }),
    );
    await waitFor(() => expect(listDoctorAppointments).toHaveBeenCalledTimes(2));
  });

  it('renders the field-level error banner when Mark arrived fails with a 422', async () => {
    const row = doctorAppointment({ id: 42, time: '10:30', status: 'approved' });
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [row], total: 1 });
    markAppointmentOutcome.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        status: 'Only an approved appointment can be marked arrived',
      }),
    );

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ama Boateng');

    await user.click(screen.getByRole('button', { name: 'Mark arrived' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an approved appointment can be marked arrived',
    );
  });

  it('tags a next-available-day as full when getSlots returns an empty array for it', async () => {
    getAvailability.mockImplementation((_fetch: unknown, month: string) => {
      if (month === '2026-01') {
        return Promise.resolve({ days: ['2026-01-10', '2026-01-16', '2026-01-20', '2026-01-25', '2026-01-30'] });
      }
      return Promise.resolve({ days: [] });
    });
    getSlots.mockImplementation((_fetch: unknown, _doctorId: number, date: string) => {
      if (date === '2026-01-16') return Promise.resolve({ slots: [] });
      return Promise.resolve({ slots: ['09:00'] });
    });

    renderPage();

    const fullTag = await screen.findByText(/Fri 16 Jan/);
    expect(fullTag).toHaveTextContent('full');
    const notFullTag = screen.getByText(/Tue 20 Jan/);
    expect(notFullTag).not.toHaveTextContent('full');
    expect(getSlots).toHaveBeenCalledWith(authedFetch, 7, '2026-01-16');
    expect(getSlots).toHaveBeenCalledWith(authedFetch, 7, '2026-01-20');
    expect(getSlots).toHaveBeenCalledWith(authedFetch, 7, '2026-01-25');
    expect(getSlots).toHaveBeenCalledWith(authedFetch, 7, '2026-01-30');
  });

  it('renders the recent-emails list from getRecentEmails', async () => {
    getRecentEmails.mockResolvedValueOnce({
      emails: [
        { recipient_email: 'doctor@example.com', subject: 'New approved appointment: Ama Mensah, 15 Jan 10:30', sent_at: '2026-01-15T09:00:00Z', ref: 'REQ-00003' },
        { recipient_email: 'doctor@example.com', subject: 'New approved appointment: Kojo Antwi, 15 Jan 10:50', sent_at: '2026-01-15T09:05:00Z', ref: 'REQ-00004' },
      ],
    });

    renderPage();

    expect(await screen.findByText('New approved appointment: Ama Mensah, 15 Jan 10:30')).toBeInTheDocument();
    expect(screen.getByText('New approved appointment: Kojo Antwi, 15 Jan 10:50')).toBeInTheDocument();
  });

  it('renders an empty state for recent emails when there are none', async () => {
    getRecentEmails.mockResolvedValueOnce({ emails: [] });

    renderPage();

    expect(await screen.findByText(/no recent emails/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders empty states for a doctor with no appointments today / no available days this month, without crashing', async () => {
    listDoctorAppointments.mockResolvedValueOnce({ appointments: [], total: 0 });
    getAvailability.mockResolvedValue({ days: [] });

    renderPage();

    expect(await screen.findByText(/no appointments scheduled today/i)).toBeInTheDocument();
    expect(await screen.findByText(/no upcoming available days/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a generic error banner when the initial load fails with a non-ApiError rejection', async () => {
    getDashboardStats.mockRejectedValueOnce(new Error('network down'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });

  // Reviewer finding: when the combined fetch fails, every piece of state
  // it would have populated stays empty -- so without a `!listBanner`
  // guard, the three empty-state messages below would render alongside
  // the error banner and assert "No appointments scheduled today." /
  // "No upcoming available days set." / "No recent emails." even though
  // the real cause is an unknown fetch failure, not an actually-empty
  // schedule/availability/inbox. This is clinically misleading, not just
  // cosmetic, so all three must be suppressed whenever the banner is up.
  it('suppresses all three empty-state messages when the fetch fails, showing only the error banner', async () => {
    getDashboardStats.mockRejectedValueOnce(new ApiError('Something went wrong. Please try again.', 500, {}));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.queryByText(/no appointments scheduled today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no upcoming available days/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no recent emails/i)).not.toBeInTheDocument();
  });
});
