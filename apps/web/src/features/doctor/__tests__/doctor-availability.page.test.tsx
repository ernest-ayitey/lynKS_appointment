import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import DoctorAvailabilityPage from '../doctor-availability.page';

const authedFetch = vi.fn();
const getSessionSettings = vi.fn();
const updateSessionSettings = vi.fn();
const getAvailability = vi.fn();
const updateAvailability = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch }),
}));

vi.mock('../doctor.api', () => ({
  getSessionSettings: (...args: unknown[]) => getSessionSettings(...args),
  updateSessionSettings: (...args: unknown[]) => updateSessionSettings(...args),
  getAvailability: (...args: unknown[]) => getAvailability(...args),
  updateAvailability: (...args: unknown[]) => updateAvailability(...args),
}));

const DEFAULT_SETTINGS = {
  start_time: '09:00',
  end_time: '17:00',
  slot_length_minutes: 20,
  max_patients_per_day: null,
  break_start: null,
  break_end: null,
};

// These intentionally recompute calendar facts (current month, which days
// fall on a Monday) via Date math independent of the component's own
// implementation, so the assertions below are a real check and not a
// tautology against the same code under test.
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const now = new Date();
const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const expectedMonthKey = `${currentMonth.getFullYear()}-${pad(currentMonth.getMonth() + 1)}`;
const daysInCurrentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();

// Every month has at least 28 days, so days 20/21 always exist.
const dayToToggleOn = isoDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 20));
const dayToToggleOff = isoDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 21));

const mondaysInCurrentMonth: string[] = [];
for (let day = 1; day <= daysInCurrentMonth; day++) {
  const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
  if (date.getDay() === 1) mondaysInCurrentMonth.push(isoDate(date));
}

function renderPage() {
  return render(<DoctorAvailabilityPage />);
}

async function waitForInitialLoad() {
  await waitFor(() => {
    expect(getAvailability).toHaveBeenCalledTimes(1);
    expect(getSessionSettings).toHaveBeenCalledTimes(1);
  });
}

describe('DoctorAvailabilityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionSettings.mockResolvedValue(DEFAULT_SETTINGS);
    getAvailability.mockResolvedValue({ days: [] });
  });

  it('calls getAvailability for the current month and getSessionSettings on mount', async () => {
    renderPage();

    await waitForInitialLoad();

    expect(getAvailability).toHaveBeenCalledWith(authedFetch, expectedMonthKey);
    expect(getSessionSettings).toHaveBeenCalledWith(authedFetch);
  });

  it('toggles a day into availability and saves it in `set`', async () => {
    updateAvailability.mockResolvedValueOnce({ days: [dayToToggleOn] });
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.click(screen.getByRole('button', { name: dayToToggleOn }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    await waitFor(() => expect(updateAvailability).toHaveBeenCalledTimes(1));
    expect(updateAvailability).toHaveBeenCalledWith(authedFetch, { set: [dayToToggleOn], unset: [] });
  });

  it('shows a day as available again after a successful save re-fetches the month', async () => {
    updateAvailability.mockResolvedValueOnce({ days: [dayToToggleOn] });
    getAvailability.mockResolvedValueOnce({ days: [] }); // initial load
    getAvailability.mockResolvedValueOnce({ days: [dayToToggleOn] }); // re-fetch after save
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.click(screen.getByRole('button', { name: dayToToggleOn }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: dayToToggleOn })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('toggles a previously-available day off and saves it in `unset`', async () => {
    getAvailability.mockResolvedValueOnce({ days: [dayToToggleOff] });
    updateAvailability.mockResolvedValueOnce({ days: [] });
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: dayToToggleOff })).toHaveAttribute('aria-pressed', 'true'),
    );

    await user.click(screen.getByRole('button', { name: dayToToggleOff }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    await waitFor(() => expect(updateAvailability).toHaveBeenCalledTimes(1));
    expect(updateAvailability).toHaveBeenCalledWith(authedFetch, { set: [], unset: [dayToToggleOff] });
  });

  it('clicking a weekday chip adds every matching date in the displayed month to the pending `set`', async () => {
    updateAvailability.mockResolvedValueOnce({ days: [] });
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.click(screen.getByRole('button', { name: 'Mon' }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    await waitFor(() => expect(updateAvailability).toHaveBeenCalledTimes(1));
    expect(updateAvailability).toHaveBeenCalledWith(authedFetch, {
      set: mondaysInCurrentMonth,
      unset: [],
    });
  });

  // The real PUT /doctor/availability 422 always carries the generic
  // 'Please correct the highlighted fields' as `message` and the actionable
  // detail under `errors.dates` — see apps/api/app/routes/doctors.rb and
  // spec/requests/doctor_availability_spec.rb. The earlier version of this
  // test put the actionable text in `message` too, a shape the backend never
  // sends, which is how the "banner shows only the generic message" bug got
  // through.
  it('shows the actionable field detail, not the generic message, on a real 422', async () => {
    updateAvailability.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        dates: 'Dates must not be in the past',
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.click(screen.getByRole('button', { name: dayToToggleOn }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    expect(await screen.findByText('Dates must not be in the past')).toBeInTheDocument();
    expect(screen.queryByText('Please correct the highlighted fields')).not.toBeInTheDocument();
  });

  it('falls back to the message when a failure carries no field errors', async () => {
    updateAvailability.mockRejectedValueOnce(new ApiError('Session expired', 401));
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.click(screen.getByRole('button', { name: dayToToggleOn }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    expect(await screen.findByText('Session expired')).toBeInTheDocument();
  });

  it('shows the generic message when the save fails with something other than an ApiError', async () => {
    updateAvailability.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();

    await user.click(screen.getByRole('button', { name: dayToToggleOn }));
    await user.click(screen.getByRole('button', { name: /save availability/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('loads existing session settings into the form', async () => {
    getSessionSettings.mockResolvedValue({
      start_time: '08:00',
      end_time: '16:00',
      slot_length_minutes: 30,
      max_patients_per_day: 10,
      break_start: '12:00',
      break_end: '12:30',
    });
    renderPage();
    await waitForInitialLoad();

    await waitFor(() => expect(screen.getByLabelText(/start time/i)).toHaveValue('08:00'));
    expect(screen.getByLabelText(/end time/i)).toHaveValue('16:00');
    expect(screen.getByLabelText(/slot length/i)).toHaveValue(30);
    expect(screen.getByLabelText(/max patients per day/i)).toHaveValue(10);
    expect(screen.getByLabelText(/break start/i)).toHaveValue('12:00');
    expect(screen.getByLabelText(/break end/i)).toHaveValue('12:30');
  });

  it('saves all session-settings fields, sending null for empty optional fields', async () => {
    updateSessionSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await waitFor(() => expect(screen.getByLabelText(/start time/i)).toHaveValue('09:00'));

    await user.click(screen.getByRole('button', { name: /save session settings/i }));

    await waitFor(() => expect(updateSessionSettings).toHaveBeenCalledTimes(1));
    expect(updateSessionSettings).toHaveBeenCalledWith(authedFetch, {
      start_time: '09:00',
      end_time: '17:00',
      slot_length_minutes: 20,
      max_patients_per_day: null,
      break_start: null,
      break_end: null,
    });
  });

  it('saves session settings with break and max-patients fields filled in', async () => {
    updateSessionSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await waitFor(() => expect(screen.getByLabelText(/start time/i)).toHaveValue('09:00'));

    await user.type(screen.getByLabelText(/max patients per day/i), '15');
    await user.type(screen.getByLabelText(/break start/i), '12:00');
    await user.type(screen.getByLabelText(/break end/i), '12:20');
    await user.click(screen.getByRole('button', { name: /save session settings/i }));

    await waitFor(() => expect(updateSessionSettings).toHaveBeenCalledTimes(1));
    expect(updateSessionSettings).toHaveBeenCalledWith(authedFetch, {
      start_time: '09:00',
      end_time: '17:00',
      slot_length_minutes: 20,
      max_patients_per_day: 15,
      break_start: '12:00',
      break_end: '12:20',
    });
  });

  it('renders a 422 field error next to the slot length input and a banner', async () => {
    updateSessionSettings.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        slot_length_minutes: 'Slot length must evenly divide the session window',
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await waitForInitialLoad();
    await waitFor(() => expect(screen.getByLabelText(/start time/i)).toHaveValue('09:00'));

    await user.click(screen.getByRole('button', { name: /save session settings/i }));

    expect(await screen.findByText('Slot length must evenly divide the session window')).toBeInTheDocument();
    expect(screen.getByText('Please correct the highlighted fields')).toBeInTheDocument();
  });
});
