import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import RequestReviewPage from '../request-review.page';

const authedFetch = vi.fn();
const getRequest = vi.fn();
const approveRequest = vi.fn();
const approveAlternateRequest = vi.fn();
const declineRequest = vi.fn();
const getPublicAvailability = vi.fn();
const getSlots = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch }),
}));

vi.mock('../records.api', () => ({
  getRequest: (...args: unknown[]) => getRequest(...args),
  approveRequest: (...args: unknown[]) => approveRequest(...args),
  approveAlternateRequest: (...args: unknown[]) => approveAlternateRequest(...args),
  declineRequest: (...args: unknown[]) => declineRequest(...args),
}));

vi.mock('../../doctor/doctor.api', () => ({
  getPublicAvailability: (...args: unknown[]) => getPublicAvailability(...args),
  getSlots: (...args: unknown[]) => getSlots(...args),
}));

// A fixed "today" far from the fixture's requested date, so neither depends
// on when this test happens to run — a bare hardcoded day-of-month in a
// fixture is exactly the bug this plan's brief warns against repeating.
const REQUESTED_DATE = '2026-12-10';

function requestDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    ref: 'REQ-00042',
    patient: {
      id: 7,
      first_name: 'Ama',
      last_name: 'Boateng',
      email: 'ama@example.com',
      phone: '+233555000111',
    },
    doctor: { id: 10, first_name: 'Kofi', last_name: 'Mensah' },
    department: { id: 1, name: 'Cardiology' },
    date: REQUESTED_DATE,
    time: '09:00',
    duration_minutes: 20,
    visit_type: 'follow_up',
    reason: 'Follow-up checkup',
    status: 'pending',
    submitted_at: '2026-11-26T00:00:00Z',
    decided_at: null,
    decline_reason_code: null,
    decline_message: null,
    internal_note: null,
    ...overrides,
  };
}

function patientStatsFixture(overrides: Record<string, unknown> = {}) {
  return {
    previous_visits_count: 3,
    last_visit_date: '2026-09-01',
    no_show_count: 1,
    other_pending_count: 0,
    ...overrides,
  };
}

function renderPage(id = '42') {
  render(
    <MemoryRouter initialEntries={[`/records/requests/${id}`]}>
      <Routes>
        <Route path="/records/requests/:id" element={<RequestReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequestReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequest.mockResolvedValue({
      request: requestDetailFixture(),
      patient_stats: patientStatsFixture(),
    });
    getPublicAvailability.mockResolvedValue({ days: [REQUESTED_DATE] });
    // The backend's `GET /doctors/:id/slots` excludes every time held by an
    // *occupying* appointment — including this very (still-pending)
    // request's own slot (09:00). So a free-times fixture that included
    // 09:00 would be a state the real backend can never produce for a
    // pending request under review; 10:00/11:00 (two OTHER, genuinely free
    // times) is the realistic default.
    getSlots.mockResolvedValue({ slots: ['10:00', '11:00'] });
  });

  it('fetches the request detail on load and renders the header, requested-appointment dl, and patient stats', async () => {
    renderPage();

    await waitFor(() => expect(getRequest).toHaveBeenCalledWith(authedFetch, 42));

    expect(await screen.findByTestId('request-ref')).toHaveTextContent('REQ-00042');
    expect(screen.getByTestId('request-status')).toHaveTextContent('Pending');
    expect(screen.getByText(/Kofi Mensah/)).toBeInTheDocument();
    expect(screen.getByText(`${REQUESTED_DATE} at 09:00`)).toBeInTheDocument();
    expect(screen.getByText('Follow-up checkup')).toBeInTheDocument();

    expect(screen.getByText('Ama Boateng')).toBeInTheDocument();
    expect(screen.getByText('ama@example.com')).toBeInTheDocument();
    expect(screen.getByText(/3 \(last: 2026-09-01\)/)).toBeInTheDocument();
  });

  it('seeds the Internal note textarea from the fetched request detail', async () => {
    getRequest.mockResolvedValueOnce({
      request: requestDetailFixture({ internal_note: 'Called patient last week.' }),
      patient_stats: patientStatsFixture(),
    });
    renderPage();
    await screen.findByTestId('request-ref');

    expect(await screen.findByLabelText('Internal note')).toHaveValue('Called patient last week.');
  });

  it('selecting "Approve a different slot" reveals New date/New time, and hides them again when switching back to Approve', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    expect(screen.queryByLabelText('New date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New time')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));

    expect(screen.getByLabelText('New date')).toBeInTheDocument();
    expect(screen.getByLabelText('New time')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Approve' }));

    expect(screen.queryByLabelText('New date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New time')).not.toBeInTheDocument();
  });

  it('selecting "Decline" reveals the (required) reason select and message textarea', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Decline' }));

    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
    expect(screen.getByLabelText('Message to patient')).toBeInTheDocument();
  });

  it('the emails-preview shows the patient\'s real email always, and a generic (never fabricated) doctor line only for non-decline decisions', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    // Approve (default): patient's real email plus a generic doctor line —
    // never a doctor email address, since the backend never sends one to
    // this page.
    expect(screen.getByTestId('emails-preview-patient')).toHaveTextContent('ama@example.com');
    expect(screen.getByTestId('emails-preview-doctor')).toBeInTheDocument();
    expect(screen.getByTestId('emails-preview-doctor')).not.toHaveTextContent('@');

    await user.click(screen.getByRole('radio', { name: 'Decline' }));
    expect(screen.getByTestId('emails-preview-patient')).toHaveTextContent('ama@example.com');
    expect(screen.queryByTestId('emails-preview-doctor')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    expect(screen.getByTestId('emails-preview-patient')).toHaveTextContent('ama@example.com');
    expect(screen.getByTestId('emails-preview-doctor')).toBeInTheDocument();
  });

  it('the confirm button label changes with the selected decision', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    expect(screen.getByRole('button', { name: 'Approve for the new time' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Decline' }));
    expect(screen.getByRole('button', { name: 'Decline request' })).toBeInTheDocument();
  });

  it('the confirm button is disabled for "Approve a different slot" until both a date and time are chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    expect(screen.getByRole('button', { name: 'Approve for the new time' })).toBeDisabled();

    await user.type(screen.getByLabelText('New date'), '2026-12-15');
    expect(screen.getByRole('button', { name: 'Approve for the new time' })).toBeDisabled();

    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, '2026-12-15'));
    await user.selectOptions(screen.getByLabelText('New time'), '10:00');

    expect(screen.getByRole('button', { name: 'Approve for the new time' })).not.toBeDisabled();
  });

  it('the confirm button is disabled for "Decline" until a reason is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Decline' }));
    expect(screen.getByRole('button', { name: 'Decline request' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Reason'), 'slot_taken');
    expect(screen.getByRole('button', { name: 'Decline request' })).not.toBeDisabled();
  });

  it('submitting "Approve" calls approveRequest and shows the approved outcome banner', async () => {
    approveRequest.mockResolvedValueOnce({ request: requestDetailFixture({ status: 'approved' }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveRequest).toHaveBeenCalledWith(authedFetch, 42));
    expect(await screen.findByRole('status')).toHaveTextContent(/emails sent/i);
  });

  it('typing an internal note and submitting "Approve" includes internal_note in the approveRequest payload', async () => {
    approveRequest.mockResolvedValueOnce({ request: requestDetailFixture({ status: 'approved' }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.type(screen.getByLabelText('Internal note'), 'Called patient to confirm.');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(approveRequest).toHaveBeenCalledWith(authedFetch, 42, { internal_note: 'Called patient to confirm.' }),
    );
  });

  it('submitting "Approve a different slot" calls approveAlternateRequest with the chosen date+time', async () => {
    approveAlternateRequest.mockResolvedValueOnce({ request: requestDetailFixture({ status: 'approved' }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    await user.type(screen.getByLabelText('New date'), '2026-12-15');
    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, '2026-12-15'));
    await user.selectOptions(screen.getByLabelText('New time'), '10:00');

    await user.click(screen.getByRole('button', { name: 'Approve for the new time' }));

    await waitFor(() =>
      expect(approveAlternateRequest).toHaveBeenCalledWith(authedFetch, 42, { date: '2026-12-15', time: '10:00' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/emails sent/i);
  });

  it('typing an internal note and submitting "Approve a different slot" includes internal_note in the approveAlternateRequest payload', async () => {
    approveAlternateRequest.mockResolvedValueOnce({ request: requestDetailFixture({ status: 'approved' }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    await user.type(screen.getByLabelText('New date'), '2026-12-15');
    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, '2026-12-15'));
    await user.selectOptions(screen.getByLabelText('New time'), '10:00');
    await user.type(screen.getByLabelText('Internal note'), 'Patient prefers afternoons.');

    await user.click(screen.getByRole('button', { name: 'Approve for the new time' }));

    await waitFor(() =>
      expect(approveAlternateRequest).toHaveBeenCalledWith(authedFetch, 42, {
        date: '2026-12-15',
        time: '10:00',
        internal_note: 'Patient prefers afternoons.',
      }),
    );
  });

  it('submitting "Decline" calls declineRequest with the chosen reason+message and shows the declined outcome banner', async () => {
    declineRequest.mockResolvedValueOnce({ request: requestDetailFixture({ status: 'declined' }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Decline' }));
    await user.selectOptions(screen.getByLabelText('Reason'), 'slot_taken');
    await user.type(screen.getByLabelText('Message to patient'), 'Please rebook.');

    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    await waitFor(() =>
      expect(declineRequest).toHaveBeenCalledWith(authedFetch, 42, {
        decline_reason_code: 'slot_taken',
        decline_message: 'Please rebook.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/slot.*freed/i);
    expect(await screen.findByRole('status')).toHaveTextContent(/patient.*emailed/i);
  });

  it('typing an internal note and submitting "Decline" includes internal_note in the declineRequest payload', async () => {
    declineRequest.mockResolvedValueOnce({ request: requestDetailFixture({ status: 'declined' }) });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Decline' }));
    await user.selectOptions(screen.getByLabelText('Reason'), 'slot_taken');
    await user.type(screen.getByLabelText('Internal note'), 'Doctor flagged this one.');

    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    await waitFor(() =>
      expect(declineRequest).toHaveBeenCalledWith(authedFetch, 42, {
        decline_reason_code: 'slot_taken',
        internal_note: 'Doctor flagged this one.',
      }),
    );
  });

  it('a 422 from approveRequest surfaces via the error banner rather than being swallowed', async () => {
    approveRequest.mockRejectedValueOnce(new ApiError('This request has already been decided', 422));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This request has already been decided');
  });

  it('a 422 from approveAlternateRequest attaches field errors and the banner', async () => {
    approveAlternateRequest.mockRejectedValueOnce(
      new ApiError('Validation failed', 422, { time: 'This time has already been booked' }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    await user.type(screen.getByLabelText('New date'), '2026-12-15');
    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, '2026-12-15'));
    await user.selectOptions(screen.getByLabelText('New time'), '10:00');

    await user.click(screen.getByRole('button', { name: 'Approve for the new time' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed');
    expect(await screen.findByText('This time has already been booked')).toBeInTheDocument();
  });

  it('a 422 from declineRequest surfaces via the error banner', async () => {
    declineRequest.mockRejectedValueOnce(
      new ApiError('Validation failed', 422, { decline_reason_code: 'Select a reason' }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Decline' }));
    await user.selectOptions(screen.getByLabelText('Reason'), 'slot_taken');
    await user.click(screen.getByRole('button', { name: 'Decline request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed');
  });

  it('shows the no-conflicts line for the requested slot even though the backend excludes it from free-times (self-exception)', async () => {
    // The default mock (set in beforeEach) never includes 09:00 — the
    // requested time — because the real backend never would either, for
    // exactly this reason. The requested slot's own membership check must
    // not be the thing deciding this line; re-approving a request at its
    // own slot can never conflict with itself.
    renderPage();
    await screen.findByTestId('request-ref');

    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, REQUESTED_DATE));
    // Regex picked so it can only match the no-conflict-branch string —
    // both branches' text contain the substring "conflict" ("No
    // conflicts..." and "Conflict..."), so a bare /conflict/i here would
    // pass no matter which branch actually rendered.
    expect(screen.getByTestId('no-conflicts-line')).toHaveTextContent(/this time is free/i);
    expect(screen.getByTestId('no-conflicts-line')).not.toHaveTextContent(/already booked/i);
  });

  it('renders the slot grid without crashing when the requested date has zero free slots', async () => {
    // A fully-booked day: the backend's free-times list for the requested
    // date comes back empty (same data today's single conflict line
    // already handles via the self-exception — see the test above).
    getSlots.mockResolvedValue({ slots: [] });
    renderPage();
    await screen.findByTestId('request-ref');

    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, REQUESTED_DATE));
    expect(screen.getByTestId('slot-grid')).toBeInTheDocument();
    // The self-exception still applies with zero other free slots: the
    // requested slot itself renders as the sole, free, selected cell.
    expect(screen.getByTestId('selected-slot-badge')).toHaveTextContent('Free');
    expect(screen.getByTestId('no-conflicts-line')).toHaveTextContent(/this time is free/i);
  });

  it('shows a conflict line for a genuinely unavailable alternate slot on a closed/unavailable day', async () => {
    // The requested date keeps the default (free: 10:00/11:00) mock; the
    // alternate date is a genuinely closed day with zero free times at
    // all, so whatever time ends up in the "New time" field for it is, by
    // construction, unavailable — unlike the requested slot's own self-
    // exception above, there is nothing wrong with this alternate slot
    // reading as booked.
    const ALT_DATE = '2026-12-20';
    getSlots.mockImplementation(async (_fetch: unknown, _doctorId: unknown, date: string) => {
      if (date === ALT_DATE) return { slots: [] };
      return { slots: ['10:00', '11:00'] };
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('request-ref');

    await user.click(screen.getByRole('radio', { name: 'Approve a different slot' }));
    await user.type(screen.getByLabelText('New date'), ALT_DATE);
    await waitFor(() => expect(getSlots).toHaveBeenCalledWith(authedFetch, 10, ALT_DATE));

    // The "New time" dropdown legitimately has no selectable options for a
    // closed day — simulate forcing a value into the underlying <select>
    // anyway (e.g. a stale/forced selection), so the alternate-slot
    // conflict check itself — not the dropdown's own filtering — is what's
    // under test here.
    const timeSelect = screen.getByLabelText('New time') as HTMLSelectElement;
    const forcedOption = document.createElement('option');
    forcedOption.value = '09:00';
    timeSelect.appendChild(forcedOption);
    fireEvent.change(timeSelect, { target: { value: '09:00' } });

    expect(screen.getByTestId('selected-slot-badge')).toHaveTextContent('Booked');
    expect(screen.getByTestId('no-conflicts-line')).toHaveTextContent(/already booked/i);
    expect(screen.getByTestId('no-conflicts-line')).not.toHaveTextContent(/this time is free/i);
  });
});
