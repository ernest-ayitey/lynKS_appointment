import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import RecordsQueuePage from '../records-queue.page';

const authedFetch = vi.fn();
const getQueue = vi.fn();
const approveRequest = vi.fn();
const undoRequest = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ authedFetch }),
}));

vi.mock('../records.api', () => ({
  getQueue: (...args: unknown[]) => getQueue(...args),
  approveRequest: (...args: unknown[]) => approveRequest(...args),
  undoRequest: (...args: unknown[]) => undoRequest(...args),
}));

function statsFixture(overrides: Record<string, unknown> = {}) {
  return { pending: 0, approved_today: 0, declined_today: 0, oldest_waiting_at: null, ...overrides };
}

function requestFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ref: 'REQ-00001',
    patient: { id: 1, first_name: 'Ama', last_name: 'Boateng' },
    doctor: { id: 10, first_name: 'Kofi', last_name: 'Mensah' },
    department: { id: 1, name: 'Cardiology' },
    date: '2026-12-01',
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

function renderPage() {
  render(
    <MemoryRouter>
      <RecordsQueuePage />
    </MemoryRouter>,
  );
}

describe('RecordsQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueue.mockResolvedValue({ stats: statsFixture(), requests: [], total: 0 });
  });

  it('loads the Pending tab on mount, calling getQueue with status: pending', async () => {
    renderPage();

    await waitFor(() => expect(getQueue).toHaveBeenCalledWith(authedFetch, { status: 'pending' }));
  });

  it('renders the four stat cards, showing an em dash (not "null") when oldest_waiting_at is null', async () => {
    getQueue.mockResolvedValueOnce({
      stats: { pending: 5, approved_today: 2, declined_today: 1, oldest_waiting_at: null },
      requests: [],
      total: 0,
    });

    renderPage();

    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('stat-pending')).toHaveTextContent('5');
    expect(screen.getByTestId('stat-approved-today')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-declined-today')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-oldest-waiting')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-oldest-waiting')).not.toHaveTextContent('null');
  });

  it('renders a relative time for a non-null oldest_waiting_at', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    getQueue.mockResolvedValueOnce({
      stats: { pending: 1, approved_today: 0, declined_today: 0, oldest_waiting_at: twoHoursAgo },
      requests: [],
      total: 0,
    });

    renderPage();

    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('stat-oldest-waiting')).toHaveTextContent('2h ago');
  });

  it('switching to the Approved tab re-fetches with status: approved', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'Approved' }));

    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(2));
    expect(getQueue).toHaveBeenLastCalledWith(authedFetch, { status: 'approved' });
  });

  it('switching to the Declined tab re-fetches with status: declined', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'Declined' }));

    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(2));
    expect(getQueue).toHaveBeenLastCalledWith(authedFetch, { status: 'declined' });
  });

  it('switching to the Cancelled tab re-fetches with status: cancelled', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('tab', { name: 'Cancelled' }));

    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(2));
    expect(getQueue).toHaveBeenLastCalledWith(authedFetch, { status: 'cancelled' });
  });

  it('typing in the search box re-fetches with the search term added to the current tab filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));

    await user.type(screen.getByRole('searchbox'), 'Ama');

    await waitFor(() => expect(getQueue).toHaveBeenLastCalledWith(authedFetch, { status: 'pending', search: 'Ama' }));
  });

  it('choosing a doctor from the Doctor filter re-fetches with doctor_id set', async () => {
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [requestFixture({ id: 42 })], total: 1 });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Approve' });

    await user.selectOptions(screen.getByLabelText('Doctor'), '10');

    await waitFor(() =>
      expect(getQueue).toHaveBeenLastCalledWith(authedFetch, { status: 'pending', doctor_id: 10 }),
    );
  });

  it('choosing a value from the Sort filter re-fetches with sort set', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Sort'), 'newest');

    await waitFor(() => expect(getQueue).toHaveBeenLastCalledWith(authedFetch, { status: 'pending', sort: 'newest' }));
  });

  it("a pending row's Review action is a link to /records/requests/:id", async () => {
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [requestFixture({ id: 42 })], total: 1 });

    renderPage();

    const reviewLink = await screen.findByRole('link', { name: 'Review' });
    expect(reviewLink).toHaveAttribute('href', '/records/requests/42');
  });

  it('a pending row has no inline Decline action — Decline is also a link to the review screen', async () => {
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [requestFixture({ id: 42 })], total: 1 });

    renderPage();

    const declineLink = await screen.findByRole('link', { name: 'Decline' });
    expect(declineLink).toHaveAttribute('href', '/records/requests/42');
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('clicking Approve on a pending row calls approveRequest then refetches the queue', async () => {
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [requestFixture({ id: 42 })], total: 1 });
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [], total: 0 });
    approveRequest.mockResolvedValueOnce({ request: requestFixture({ id: 42, status: 'approved' }) });

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Approve' });

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveRequest).toHaveBeenCalledWith(authedFetch, 42));
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(2));
  });

  it('renders an error banner when approveRequest fails', async () => {
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [requestFixture({ id: 42 })], total: 1 });
    approveRequest.mockRejectedValueOnce(new ApiError('This request has already been decided', 422));

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Approve' });

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This request has already been decided');
  });

  it('a non-pending row shows the decided outcome and an Undo button that calls undoRequest then refetches', async () => {
    const declinedRow = requestFixture({
      id: 99,
      status: 'declined',
      decided_at: '2026-11-26T01:00:00Z',
      decline_reason_code: 'slot_taken',
    });
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [declinedRow], total: 1 });
    getQueue.mockResolvedValueOnce({ stats: statsFixture(), requests: [], total: 0 });
    undoRequest.mockResolvedValueOnce({ request: requestFixture({ id: 99, status: 'pending' }) });

    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Undo' });

    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(undoRequest).toHaveBeenCalledWith(authedFetch, 99));
    await waitFor(() => expect(getQueue).toHaveBeenCalledTimes(2));
  });

  it('shows a generic error banner when the initial load fails with a non-ApiError rejection', async () => {
    getQueue.mockReset();
    getQueue.mockRejectedValueOnce(new Error('network down'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});
