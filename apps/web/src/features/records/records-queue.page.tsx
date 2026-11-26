import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import {
  approveRequest,
  getQueue,
  undoRequest,
  type RecordsQueueFilters,
  type RecordsQueueRequest,
  type RecordsQueueStats,
} from './records.api';

type StatusTab = 'pending' | 'approved' | 'declined' | 'cancelled';

// Per screen-specs.md:125's RecordsQueue tabs — these four map directly
// onto RecordsQueueFilters['status'], one tab per value, so (unlike
// MyAppointmentsPage's tabs) there is no extra date-range/multi-status
// mapping needed here.
const TABS: Array<{ key: StatusTab; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-600',
};

const EMPTY_STATS: RecordsQueueStats = {
  pending: 0,
  approved_today: 0,
  declined_today: 0,
  oldest_waiting_at: null,
};

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDeclineReason(code: string): string {
  return code
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Small local "2h ago"-style formatter for the Submitted column and the
// Oldest-waiting stat card. No date-formatting dependency exists anywhere
// else in this codebase, so this stays a plain function rather than
// pulling one in for two columns.
function relativeTime(iso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function RecordsQueuePage() {
  const { authedFetch } = useAuth();

  const [activeTab, setActiveTab] = useState<StatusTab>('pending');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<RecordsQueueStats>(EMPTY_STATS);
  const [requests, setRequests] = useState<RecordsQueueRequest[]>([]);
  const [listBanner, setListBanner] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    setListBanner(null);
    try {
      const filters: RecordsQueueFilters = { status: activeTab };
      if (search) filters.search = search;
      const response = await getQueue(authedFetch, filters);
      setStats(response.stats);
      setRequests(response.requests);
    } catch (err) {
      setListBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    }
  }, [authedFetch, activeTab, search]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function handleApprove(id: number) {
    setActionBanner(null);
    setActingId(id);
    try {
      await approveRequest(authedFetch, id);
      // Re-fetches rather than patching the row in place: an approved
      // request no longer matches the Pending tab's status filter, so it
      // should drop out of view here, matching
      // MyAppointmentsPage#handleCancel's refetch-after-action pattern.
      await refetch();
    } catch (err) {
      setActionBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setActingId(null);
    }
  }

  async function handleUndo(id: number) {
    setActionBanner(null);
    setActingId(id);
    try {
      await undoRequest(authedFetch, id);
      await refetch();
    } catch (err) {
      setActionBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Approval queue</h1>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-white p-4 shadow">
            <p className="text-sm text-slate-500">Pending</p>
            <p data-testid="stat-pending" className="text-2xl font-semibold text-slate-900">
              {stats.pending}
            </p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <p className="text-sm text-slate-500">Approved today</p>
            <p data-testid="stat-approved-today" className="text-2xl font-semibold text-slate-900">
              {stats.approved_today}
            </p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <p className="text-sm text-slate-500">Declined today</p>
            <p data-testid="stat-declined-today" className="text-2xl font-semibold text-slate-900">
              {stats.declined_today}
            </p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow">
            <p className="text-sm text-slate-500">Oldest waiting</p>
            <p data-testid="stat-oldest-waiting" className="text-2xl font-semibold text-slate-900">
              {stats.oldest_waiting_at ? relativeTime(stats.oldest_waiting_at) : '—'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search patient, ref, or doctor"
            aria-label="Search"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        {listBanner && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {listBanner}
          </div>
        )}
        {actionBanner && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionBanner}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Patient</th>
                <th className="px-4 py-2 font-medium">Doctor</th>
                <th className="px-4 py-2 font-medium">Requested slot</th>
                <th className="px-4 py-2 font-medium">Submitted</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.length === 0 && !listBanner && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No requests to show.
                  </td>
                </tr>
              )}

              {requests.map((request) => (
                <tr key={request.id}>
                  <td className="px-4 py-2 text-slate-900">{request.ref}</td>
                  <td className="px-4 py-2 text-slate-900">
                    {request.patient.first_name} {request.patient.last_name}
                  </td>
                  <td className="px-4 py-2 text-slate-900">
                    Dr. {request.doctor.first_name} {request.doctor.last_name}
                  </td>
                  <td className="px-4 py-2 text-slate-700">
                    {request.date} at {request.time}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{relativeTime(request.submitted_at)}</td>
                  <td className="px-4 py-2">
                    <span
                      data-testid="request-status"
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_BADGE_CLASSES[request.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {formatStatus(request.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {request.status === 'pending' ? (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`/records/requests/${request.id}`}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Review
                        </Link>
                        <button
                          type="button"
                          disabled={actingId === request.id}
                          onClick={() => handleApprove(request.id)}
                          className="rounded-md border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
                        >
                          Approve
                        </button>
                        {/* Decline links to the Review screen rather than acting
                            inline: a decline requires a reason, which only that
                            screen's form collects. */}
                        <Link
                          to={`/records/requests/${request.id}`}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                        >
                          Decline
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-slate-500">
                          {request.decided_at && `Decided ${relativeTime(request.decided_at)}`}
                          {request.decline_reason_code && ` — ${formatDeclineReason(request.decline_reason_code)}`}
                        </p>
                        <button
                          type="button"
                          disabled={actingId === request.id}
                          onClick={() => handleUndo(request.id)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Undo
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
