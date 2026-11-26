import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import { cancelAppointment, listAppointments, type Appointment, type AppointmentFilters } from './appointments.api';

type TabKey = 'all' | 'upcoming' | 'pending' | 'past' | 'declined-cancelled';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'pending', label: 'Pending' },
  { key: 'past', label: 'Past' },
  { key: 'declined-cancelled', label: 'Declined/cancelled' },
];

// Mirrors Appointment::OCCUPYING_STATUSES in apps/api/app/models/appointment.rb
// — the two non-terminal statuses POST /appointments/:id/cancel accepts.
// Duplicated as plain strings rather than imported, since this is
// TypeScript and that constant lives in the Ruby backend.
const CANCELLABLE_STATUSES = new Set(['pending', 'approved']);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// This plan's resolved mapping (brief for Task 7) from the screen spec's
// five tabs to concrete `GET /appointments` query params — not left to a
// naive per-tab single-status guess, which can't express "Past" (no status
// at all, just a date cutoff) or "Declined/cancelled" (two statuses) the
// same way "Upcoming"/"Pending" (one status each) can.
function filtersForTab(tab: TabKey): AppointmentFilters {
  switch (tab) {
    case 'all':
      return {};
    case 'upcoming':
      // Same definition as the dashboard's "Upcoming (approved)" stat card,
      // so this tab and that count agree.
      return { status: 'approved' };
    case 'pending':
      return { status: 'pending' };
    case 'past': {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return { to: isoDate(yesterday) };
    }
    case 'declined-cancelled':
      return { status: 'declined,cancelled' };
  }
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatVisitType(visitType: string): string {
  return visitType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-600',
  completed: 'bg-blue-100 text-blue-800',
};

export default function MyAppointmentsPage() {
  const { authedFetch } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [listBanner, setListBanner] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    setListBanner(null);
    try {
      const response = await listAppointments(authedFetch, filtersForTab(activeTab));
      setAppointments(response.appointments);
    } catch (err) {
      setListBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    }
  }, [authedFetch, activeTab]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function handleCancel(id: number) {
    setActionBanner(null);
    setCancellingId(id);
    try {
      await cancelAppointment(authedFetch, id);
      // Re-fetches rather than patching the row in place: a cancelled
      // appointment no longer matches the current tab's filter (e.g. the
      // Pending tab's status=pending), so it should drop out of view here,
      // not linger with an updated status.
      await refetch();
    } catch (err) {
      setActionBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">My appointments</h1>

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

        <div className="space-y-3">
          {appointments.length === 0 && !listBanner && (
            <p className="text-sm text-slate-500">No appointments to show.</p>
          )}

          {appointments.map((appointment) => (
            <div key={appointment.id} className="rounded-lg bg-white p-4 shadow">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    Dr. {appointment.doctor.first_name} {appointment.doctor.last_name}
                  </p>
                  <p className="text-sm text-slate-500">{appointment.department.name}</p>
                </div>
                <span
                  data-testid="appointment-status"
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_BADGE_CLASSES[appointment.status] ?? 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {formatStatus(appointment.status)}
                </span>
              </div>

              <div className="mt-2 text-sm text-slate-700">
                <p>
                  {appointment.date} at {appointment.time} ({appointment.duration_minutes} min)
                </p>
                <p>{formatVisitType(appointment.visit_type)}</p>
                <p className="text-slate-500">{appointment.reason}</p>
              </div>

              {CANCELLABLE_STATUSES.has(appointment.status) && (
                <button
                  type="button"
                  disabled={cancellingId === appointment.id}
                  onClick={() => handleCancel(appointment.id)}
                  className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
