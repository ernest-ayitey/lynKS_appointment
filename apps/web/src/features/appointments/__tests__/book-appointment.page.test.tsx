import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import BookAppointmentPage from '../book-appointment.page';

const authedFetch = vi.fn();
const getDepartments = vi.fn();
const getDoctors = vi.fn();
const getPublicAvailability = vi.fn();
const getSlots = vi.fn();
const bookAppointment = vi.fn();
const navigate = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch }),
}));

vi.mock('../../doctor/doctor.api', () => ({
  getDepartments: (...args: unknown[]) => getDepartments(...args),
  getDoctors: (...args: unknown[]) => getDoctors(...args),
  getPublicAvailability: (...args: unknown[]) => getPublicAvailability(...args),
  getSlots: (...args: unknown[]) => getSlots(...args),
}));

vi.mock('../appointments.api', () => ({
  bookAppointment: (...args: unknown[]) => bookAppointment(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const DEPARTMENTS = [
  { id: 1, name: 'Cardiology', doctor_count: 2 },
  { id: 2, name: 'Dermatology', doctor_count: 1 },
];

const ALL_DOCTORS = [
  {
    id: 10,
    first_name: 'Ama',
    last_name: 'Boateng',
    department: { id: 1, name: 'Cardiology' },
    specialty_title: 'Cardiologist',
  },
  {
    id: 11,
    first_name: 'Kofi',
    last_name: 'Mensah',
    department: { id: 2, name: 'Dermatology' },
    specialty_title: 'Dermatologist',
  },
];

const CARDIOLOGY_DOCTORS = [ALL_DOCTORS[0]];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Pinned to a fixed, safely mid-month date (the 15th of a 31-day month)
// rather than the real `new Date()`. `dayAtOffset`'s clamp-to-end-of-month
// below used to silently collapse `unavailableDay` and `availableDay` into
// the *same* date whenever the suite happened to run on the last day or
// two of any real-world month (today + 1 and today + 3 both clamp to the
// same last day there), breaking the two assertions further down that
// need those two days to stay distinct. Pinning the clock removes the
// edge case entirely instead of just moving it.
//
// Fake timers stay active for the whole file (restored in `afterAll`
// below), not just this module-load-time computation, because
// BookAppointmentPage itself calls `new Date()` at render time to work
// out "today" — it needs to see the same fixed date these fixtures were
// built from.
const FIXED_NOW = new Date(2026, 0, 15); // January 15, 2026 (31-day month)
// `toFake: ['Date']` only, so `setTimeout`/microtasks stay real — faking
// those too would stall `userEvent` and `waitFor`, which depend on real
// timers to resolve their internal waits.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(FIXED_NOW);

const now = new Date();
const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

// Offsets from "today", clamped to stay within the currently-rendered month
// (the page shows only the current month, with no forward/back navigation)
// — mirrors apps/api/spec/requests/appointments_spec.rb's own
// `Date.today + N` convention for picking "clearly future" dates in tests,
// instead of a hardcoded day-of-month that silently turns into a past date
// as the real-world month goes on. That silent drift is exactly the bug
// this suite now guards against: a hardcoded "day 10" test would eventually
// start asserting a *past* day is enabled and bookable without anyone
// noticing, since BookAppointmentPage used to gate a day's "available"
// state on `availableDays.has(dateIso)` alone, with no `dateIso >= today`
// check at all.
//
// (On the 1st of the month specifically, `dayAtOffset(-1)` clamps to day 1
// itself rather than a true past day — an accepted, documented edge case,
// same tolerance doctor-availability.page.test.tsx already takes for its
// own hardcoded "day 20/21 always exist" comment above.)
function dayAtOffset(offset: number): string {
  const day = Math.min(Math.max(now.getDate() + offset, 1), totalDaysInMonth);
  return isoDate(new Date(now.getFullYear(), now.getMonth(), day));
}

const pastStaleDay = dayAtOffset(-1); // in the past, but present in a mocked `days` response — the stale-availability-row scenario doctors.rb never filters out server-side either
const unavailableDay = dayAtOffset(1); // in the future, but simply absent from the mocked `days` response
const availableDay = dayAtOffset(3); // in the future and present in the mocked `days` response

function renderPage() {
  render(
    <MemoryRouter>
      <BookAppointmentPage />
    </MemoryRouter>,
  );
}

async function waitForInitialLoad() {
  await screen.findByRole('option', { name: 'Cardiology' });
  await screen.findByRole('option', { name: /ama boateng/i });
}

async function selectDoctor(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/doctor/i), '10');
  await screen.findByRole('button', { name: availableDay });
}

async function selectDoctorDayAndTime(user: ReturnType<typeof userEvent.setup>) {
  await selectDoctor(user);
  await user.click(screen.getByRole('button', { name: availableDay }));
  await screen.findByRole('button', { name: '09:00' });
  await user.click(screen.getByRole('button', { name: '09:00' }));
}

describe('BookAppointmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDepartments.mockResolvedValue(DEPARTMENTS);
    getDoctors.mockResolvedValue(ALL_DOCTORS);
    getPublicAvailability.mockResolvedValue({ days: [availableDay] });
    getSlots.mockResolvedValue({ slots: ['09:00', '09:20'] });
  });

  // Restores the real clock once this file's examples are all done, rather
  // than per-example: the fixed system time set at module load above has
  // to stay in effect for every example in this file (BookAppointmentPage
  // computes "today" via `new Date()` on every render), so resetting it
  // between examples would make the component and the fixtures disagree
  // about "today" from the second example onward.
  afterAll(() => {
    vi.useRealTimers();
  });

  it('loads all doctors unfiltered on mount, then narrows the list by the selected department', async () => {
    getDoctors.mockResolvedValueOnce(ALL_DOCTORS);
    getDoctors.mockResolvedValueOnce(CARDIOLOGY_DOCTORS);
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    expect(getDoctors).toHaveBeenCalledWith(authedFetch, undefined);

    await user.selectOptions(screen.getByLabelText(/department/i), '1');

    await waitFor(() => expect(getDoctors).toHaveBeenCalledTimes(2));
    expect(getDoctors).toHaveBeenLastCalledWith(authedFetch, '1');
  });

  it("loads the doctor's availability for the current month once a doctor is picked, disabling days not in `days`", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.selectOptions(screen.getByLabelText(/doctor/i), '10');

    await waitFor(() => expect(getPublicAvailability).toHaveBeenCalledTimes(1));
    expect(getPublicAvailability).toHaveBeenCalledWith(authedFetch, 10, expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(await screen.findByRole('button', { name: availableDay })).toBeEnabled();
    expect(screen.getByRole('button', { name: unavailableDay })).toBeDisabled();
  });

  // Regression test: doctors.rb's `available_dates_in_month` applies no
  // past-date filter (a doctor's stale, never-unset availability rows for a
  // date that has since passed legitimately stay in `days`), and
  // POST /appointments unconditionally 422s on a past date regardless. A day
  // in `days` that's already in the past must therefore still render
  // disabled and must never be selectable, even though it's "available" by
  // the backend's own lax definition.
  it('treats a day already in the past as not bookable, even when the backend still reports it as available', async () => {
    getPublicAvailability.mockResolvedValue({ days: [pastStaleDay, availableDay] });
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await selectDoctor(user);

    expect(screen.getByRole('button', { name: pastStaleDay })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: pastStaleDay }));
    expect(getSlots).not.toHaveBeenCalled();
  });

  it("loads that day's slots once an available day is picked, rendering each as an option", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await selectDoctor(user);

    await user.click(screen.getByRole('button', { name: availableDay }));

    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, availableDay));
    expect(await screen.findByRole('button', { name: '09:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '09:20' })).toBeInTheDocument();
  });

  it('does not let an unavailable day be picked (slots never load for it)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await selectDoctor(user);

    await user.click(screen.getByRole('button', { name: unavailableDay }));

    expect(getSlots).not.toHaveBeenCalled();
  });

  it('submits the exact backend payload shape and navigates to /appointments on success', async () => {
    bookAppointment.mockResolvedValueOnce({ id: 1 });
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await selectDoctorDayAndTime(user);
    await user.selectOptions(screen.getByLabelText(/visit type/i), 'follow_up');
    await user.type(screen.getByLabelText(/reason/i), 'Follow-up checkup');
    await user.click(screen.getByLabelText(/sms reminder/i));

    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    await waitFor(() => expect(bookAppointment).toHaveBeenCalledTimes(1));
    expect(bookAppointment).toHaveBeenCalledWith(authedFetch, {
      doctor_id: 10,
      date: availableDay,
      time: '09:00',
      visit_type: 'follow_up',
      reason: 'Follow-up checkup',
      sms_reminder_opt_in: true,
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/appointments'));
  });

  it('defaults sms_reminder_opt_in to false when the checkbox is left unchecked', async () => {
    bookAppointment.mockResolvedValueOnce({ id: 1 });
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await selectDoctorDayAndTime(user);
    await user.selectOptions(screen.getByLabelText(/visit type/i), 'follow_up');
    await user.type(screen.getByLabelText(/reason/i), 'Follow-up checkup');

    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    await waitFor(() => expect(bookAppointment).toHaveBeenCalledTimes(1));
    expect(bookAppointment).toHaveBeenCalledWith(
      authedFetch,
      expect.objectContaining({ sms_reminder_opt_in: false }),
    );
  });

  it('renders field errors from a 422 via applyApiError and does not navigate', async () => {
    bookAppointment.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        date: 'Doctor is not available on this date',
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await selectDoctorDayAndTime(user);
    await user.selectOptions(screen.getByLabelText(/visit type/i), 'follow_up');
    await user.type(screen.getByLabelText(/reason/i), 'Follow-up checkup');

    await user.click(screen.getByRole('button', { name: /book appointment/i }));

    expect(await screen.findByText('Doctor is not available on this date')).toBeInTheDocument();
    expect(screen.getByText('Please correct the highlighted fields')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
