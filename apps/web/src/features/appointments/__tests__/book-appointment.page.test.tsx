import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const now = new Date();
// Every month has at least 28 days, so days 10/11 always exist.
const availableDay = isoDate(new Date(now.getFullYear(), now.getMonth(), 10));
const unavailableDay = isoDate(new Date(now.getFullYear(), now.getMonth(), 11));

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
