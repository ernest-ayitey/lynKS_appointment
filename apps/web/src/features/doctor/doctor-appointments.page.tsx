import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import {
  listDoctorAppointments,
  markAppointmentOutcome,
  type DoctorAppointment,
  type DoctorAppointmentFilters,
} from './doctor-appointments.api';

type DateRangePreset = '' | 'today' | 'this_week' | 'next_30_days';

const DATE_RANGE_OPTIONS: Array<{ key: DateRangePreset; label: string }> = [
  { key: '', label: 'All dates' },
  { key: 'this_week', label: 'This week' },
  { key: 'today', label: 'Today' },
  { key: 'next_30_days', label: 'Next 30 days' },
];

const STATUS_BADGE_CLASSES: Record<string, string> = {
  approved: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// Mirrors appointments/my-appointments.page.tsx's `isoDate` helper exactly.
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Monday of the calendar week containing `date`.
function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
}

// Sunday of the calendar week containing `date`.
function endOfWeek(date: Date): Date {
  const monday = startOfWeek(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

// This plan's resolved mapping (brief for Task 3) from the screen spec's
// three date-range presets to concrete `from`/`to` query params, computed
// client-side — '' (no preset selected) applies no date filter at all.
function dateRangeForPreset(preset: DateRangePreset): { from: string; to: string } | null {
  const today = new Date();
  switch (preset) {
    case 'today':
      return { from: isoDate(today), to: isoDate(today) };
    case 'this_week':
      return { from: isoDate(startOfWeek(today)), to: isoDate(endOfWeek(today)) };
    case 'next_30_days': {
      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      return { from: isoDate(today), to: isoDate(end) };
    }
    case '':
      return null;
  }
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('-');
}

function formatVisitType(visitType: string): string {
  return visitType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function DoctorAppointmentsPage() {
  const { authedFetch } = useAuth();

  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('');
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [listBanner, setListBanner] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [visitNotes, setVisitNotes] = useState('');
  const [actingId, setActingId] = useState<number | null>(null);

  const selected = appointments.find((appointment) => appointment.id === selectedId) ?? null;

  const refetch = useCallback(async () => {
    setListBanner(null);
    try {
      const filters: DoctorAppointmentFilters = {};
      if (search) filters.search = search;
      const range = dateRangeForPreset(datePreset);
      if (range) {
        filters.from = range.from;
        filters.to = range.to;
      }
      const response = await listDoctorAppointments(authedFetch, filters);
      setAppointments(response.appointments);
    } catch (err) {
      setListBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    }
  }, [authedFetch, search, datePreset]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function openRow(appointment: DoctorAppointment) {
    setActionBanner(null);
    setSelectedId(appointment.id);
    setVisitNotes(appointment.visit_notes ?? '');
  }

  async function handleMarkOutcome(status: 'completed' | 'no_show') {
    if (!selected) return;
    setActionBanner(null);
    setActingId(selected.id);
    try {
      await markAppointmentOutcome(authedFetch, selected.id, { status, visit_notes: visitNotes });
      // Re-fetches rather than patching the row in place, matching
      // MyAppointmentsPage#handleCancel's / RecordsQueuePage#handleApprove's
      // refetch-after-action pattern.
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
        <h1 className="text-2xl font-semibold text-slate-900">Doctor appointments</h1>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by patient name"
              aria-label="Search"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />

            <select
              value={datePreset}
              onChange={(event) => setDatePreset(event.target.value as DateRangePreset)}
              aria-label="Date range"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
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

        <div className="flex flex-wrap gap-6">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white shadow">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Patient</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.length === 0 && !listBanner && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      No appointments to show.
                    </td>
                  </tr>
                )}

                {appointments.map((appointment) => (
                  <tr
                    key={appointment.id}
                    onClick={() => openRow(appointment)}
                    aria-selected={appointment.id === selectedId}
                    className={`cursor-pointer hover:bg-slate-50 ${
                      appointment.id === selectedId ? 'bg-slate-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2 text-slate-900">{appointment.date}</td>
                    <td className="px-4 py-2 text-slate-900">{appointment.time}</td>
                    <td className="px-4 py-2 text-slate-900">
                      {appointment.patient.first_name} {appointment.patient.last_name}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{appointment.reason}</td>
                    <td className="px-4 py-2">
                      <span
                        data-testid="appointment-status"
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_BADGE_CLASSES[appointment.status] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {formatStatus(appointment.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <aside className="w-full max-w-sm shrink-0 space-y-4 rounded-lg bg-white p-4 shadow sm:w-96">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    {selected.patient.first_name} {selected.patient.last_name}
                  </p>
                  <p className="flex gap-1 text-sm text-slate-500">
                    <span>{selected.patient.sex ? formatStatus(selected.patient.sex) : '—'}</span>
                    <span>·</span>
                    <span>{selected.patient.age ?? '—'}</span>
                    <span>·</span>
                    <span>{selected.patient.phone ?? '—'}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  className="text-slate-400 hover:text-slate-600"
                >
                  &times;
                </button>
              </div>

              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-slate-500">When</dt>
                  <dd className="text-slate-900">
                    {selected.date} at {selected.time}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Type</dt>
                  <dd className="text-slate-900">{formatVisitType(selected.visit_type)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Reason</dt>
                  <dd className="text-slate-900">{selected.reason}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Approved by</dt>
                  <dd className="text-slate-900">
                    {selected.approved_by ? `Dr. ${selected.approved_by.first_name} ${selected.approved_by.last_name}` : '—'}
                  </dd>
                </div>
              </dl>

              <div>
                <label htmlFor="visit-notes" className="block text-sm font-medium text-slate-700">
                  Visit notes
                </label>
                <textarea
                  id="visit-notes"
                  value={visitNotes}
                  onChange={(event) => setVisitNotes(event.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              {/* Only an `approved` appointment can be marked completed/no-show
                  (the backend's PATCH /appointments/:id rejects anything else
                  with a 422) — hiding these for an already-decided row matches
                  RecordsQueuePage's/MyAppointmentsPage's own convention of
                  gating actions on status rather than letting the user hit a
                  guaranteed error. */}
              {selected.status === 'approved' && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={actingId === selected.id}
                    onClick={() => handleMarkOutcome('completed')}
                    className="rounded-md border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
                  >
                    Mark completed
                  </button>
                  <button
                    type="button"
                    disabled={actingId === selected.id}
                    onClick={() => handleMarkOutcome('no_show')}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    No-show
                  </button>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
