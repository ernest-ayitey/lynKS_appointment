import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import {
  listDoctorAppointments,
  markAppointmentOutcome,
  type DoctorAppointment,
} from './doctor-appointments.api';
import { getDashboardStats, getRecentEmails, type DashboardStats, type RecentEmail } from './doctor-dashboard.api';
import { getAvailability, getSlots } from './doctor.api';

// Same pairing doctor-appointments.page.tsx's own STATUS_BADGE_CLASSES already
// uses (Task 6) -- reused here verbatim rather than inventing a second amber
// token for the same "arrived" status.
const STATUS_BADGE_CLASSES: Record<string, string> = {
  approved: 'bg-green-100 text-green-800',
  arrived: 'bg-amber-100 text-amber-800',
  completed: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
};

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  arrived: 'Arrived',
  completed: 'Completed',
  no_show: 'No-show',
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// Mirrors doctor-appointments.page.tsx's own `isoDate` helper exactly.
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Mirrors doctor-availability.page.tsx's own `monthKey` helper exactly.
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTodayHeader(date: Date): string {
  return `Today · ${WEEKDAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

// `dateIso` is a plain "YYYY-MM-DD" string -- parsed via explicit
// year/month/day components (not `new Date(dateIso)`) so this never drifts
// a day from UTC-vs-local parsing the way a bare ISO string constructor can.
function formatDayTag(dateIso: string): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${SHORT_WEEKDAYS[date.getDay()]} ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

type ScheduleRow =
  | { kind: 'appointment'; appointment: DoctorAppointment }
  | { kind: 'open-slot'; time: string; key: string };

// Builds today's schedule rows by merging the day's appointments with
// `todaySlots` -- the doctor's real free slots for today, from the exact
// same `getSlots` call the "full day" widget below already uses. A slot
// counts as an "Open slot" row only when it doesn't fall inside any
// appointment's own [time, time + duration_minutes) range; every other
// slot is already booked. This is deliberately not derived from
// `duration_minutes` gap-math alone: `getSlots` already excludes the
// doctor's break window and respects their session start/end (same
// endpoint the booking flow itself uses), so it's the only source that can
// tell a genuine open slot apart from a lunch break -- and it naturally
// produces a trailing "Open slot" row after the day's last appointment
// too (the wireframe's own "14:00 · Open slot" example), which pure
// between-appointments gap math could never produce.
function buildScheduleRows(appointments: DoctorAppointment[], todaySlots: string[]): ScheduleRow[] {
  const occupiedRanges = appointments.map((appointment) => ({
    start: timeToMinutes(appointment.time),
    end: timeToMinutes(appointment.time) + appointment.duration_minutes,
  }));
  const openSlotTimes = todaySlots.filter((slot) => {
    const minutes = timeToMinutes(slot);
    return !occupiedRanges.some((range) => minutes >= range.start && minutes < range.end);
  });

  const rows: ScheduleRow[] = [
    ...appointments.map((appointment): ScheduleRow => ({ kind: 'appointment', appointment })),
    ...openSlotTimes.map((time): ScheduleRow => ({ kind: 'open-slot', time, key: `gap-${time}` })),
  ];
  return rows.sort((a, b) => {
    const timeA = a.kind === 'appointment' ? a.appointment.time : a.time;
    const timeB = b.kind === 'appointment' ? b.appointment.time : b.time;
    return timeToMinutes(timeA) - timeToMinutes(timeB);
  });
}

// The chronologically-next `approved`/`arrived` appointment in today's
// schedule relative to `now` -- not just "the first approved one in the
// list": an appointment whose time has already passed (patient a no-show,
// or simply running late) is skipped rather than claiming the "Next" tag.
function computeNextAppointmentId(appointments: DoctorAppointment[], now: Date): number | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const candidates = appointments
    .filter((appointment) => appointment.status === 'approved' || appointment.status === 'arrived')
    .filter((appointment) => timeToMinutes(appointment.time) >= nowMinutes)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  return candidates[0]?.id ?? null;
}

interface AvailableDayTag {
  date: string;
  full: boolean;
}

// Next 4 of the doctor's own available days that are today-or-later, each
// tagged "full" when getSlots comes back empty for it. Reads the current
// month first and only reaches for next month if fewer than 4 qualifying
// dates remain in the current one -- the common case (an active doctor with
// several available days left this month) never needs the second call.
async function loadUpcomingAvailableDays(
  authedFetch: Parameters<typeof getAvailability>[0],
  doctorId: number,
  today: Date,
): Promise<AvailableDayTag[]> {
  const todayIso = isoDate(today);
  const currentMonth = await getAvailability(authedFetch, monthKey(today));
  let dates = currentMonth.days.filter((day) => day >= todayIso);
  if (dates.length < 4) {
    const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonth = await getAvailability(authedFetch, monthKey(nextMonthDate));
    dates = dates.concat(nextMonth.days);
  }
  dates = [...dates].sort().slice(0, 4);

  return Promise.all(
    dates.map(async (date) => {
      const slots = await getSlots(authedFetch, doctorId, date);
      return { date, full: slots.slots.length === 0 };
    }),
  );
}

export default function DoctorDashboardPage() {
  const { authedFetch, user } = useAuth();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [schedule, setSchedule] = useState<DoctorAppointment[]>([]);
  const [todaySlots, setTodaySlots] = useState<string[]>([]);
  const [emails, setEmails] = useState<RecentEmail[]>([]);
  const [availableDays, setAvailableDays] = useState<AvailableDayTag[]>([]);
  const [listBanner, setListBanner] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    setListBanner(null);
    try {
      const today = new Date();
      const todayIso = isoDate(today);
      const [statsResponse, scheduleResponse, todaySlotsResponse, emailsResponse, availableDaysResponse] =
        await Promise.all([
          getDashboardStats(authedFetch),
          listDoctorAppointments(authedFetch, { from: todayIso, to: todayIso }),
          // Same `getSlots` endpoint the "next available days" widget below
          // uses, called for today specifically -- it already excludes the
          // doctor's break window and respects their session start/end, so
          // diffing it against today's booked appointments (in
          // buildScheduleRows) gives genuinely correct "Open slot" rows
          // instead of naive gap math between appointment times.
          user ? getSlots(authedFetch, user.id, todayIso) : Promise.resolve({ slots: [] }),
          getRecentEmails(authedFetch),
          user ? loadUpcomingAvailableDays(authedFetch, user.id, today) : Promise.resolve([]),
        ]);
      setStats(statsResponse);
      setSchedule(scheduleResponse.appointments);
      setTodaySlots(todaySlotsResponse.slots);
      setEmails(emailsResponse.emails);
      setAvailableDays(availableDaysResponse);
    } catch (err) {
      setListBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
    }
    // Depends on `user?.id` (a primitive), not `user` itself: AuthContext's
    // exposed `user` is a fresh object on every render triggered by its own
    // internal state (and some test doubles return a new object per call
    // too), which would otherwise recreate `refetch` -- and re-run the
    // effect below -- on every single render.
  }, [authedFetch, user?.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function handleMarkArrived(id: number) {
    setActionBanner(null);
    setActingId(id);
    try {
      await markAppointmentOutcome(authedFetch, id, { status: 'arrived' });
      await refetch();
    } catch (err) {
      // Mirrors doctor-appointments.page.tsx's own precedent: the real
      // PATCH /appointments/:id 422 carries the generic banner text as
      // `message` and the actionable detail under `errors.status`.
      if (err instanceof ApiError) {
        setActionBanner(err.errors?.status ?? err.message);
      } else {
        setActionBanner(GENERIC_ERROR_MESSAGE);
      }
    } finally {
      setActingId(null);
    }
  }

  const today = new Date();
  const nextAppointmentId = computeNextAppointmentId(schedule, today);
  const scheduleRows = buildScheduleRows(schedule, todaySlots);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{formatTodayHeader(today)}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Only appointments approved by Records appear in your schedule.
          </p>
        </div>
        <Link
          to="/doctor/availability"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Set available days
        </Link>
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Patients today</div>
          <div data-testid="stat-patients-today" className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.patients_today ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">This week</div>
          <div data-testid="stat-this-week" className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.this_week ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Pending (with Records)</div>
          <div data-testid="stat-pending" className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.pending ?? '—'}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Available days this month</div>
          <div data-testid="stat-available-days" className="mt-1 text-2xl font-bold text-slate-900">
            {stats?.available_days_this_month ?? '—'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[2_1_400px] rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Today&apos;s schedule</h2>

          {scheduleRows.length === 0 && (
            <p className="py-4 text-sm text-slate-500">No appointments scheduled today.</p>
          )}

          {scheduleRows.map((row) => {
            if (row.kind === 'open-slot') {
              return (
                <div key={row.key} className="flex items-center gap-3 border-b border-slate-100 py-3 text-sm">
                  <strong className="w-16 shrink-0 text-slate-900">{row.time}</strong>
                  <span className="flex-1 text-slate-500">Open slot</span>
                </div>
              );
            }

            const { appointment } = row;
            const isNext = appointment.id === nextAppointmentId;
            const tagLabel = isNext ? 'Next' : STATUS_LABELS[appointment.status] ?? appointment.status;
            const tagClasses = isNext
              ? STATUS_BADGE_CLASSES.approved
              : STATUS_BADGE_CLASSES[appointment.status] ?? 'bg-slate-100 text-slate-600';

            return (
              <div
                key={appointment.id}
                className={`flex flex-wrap items-center gap-3 border-b border-slate-100 py-3 text-sm ${
                  isNext ? '-mx-5 bg-blue-50 px-5' : ''
                }`}
              >
                <strong className="w-16 shrink-0 text-slate-900">{appointment.time}</strong>
                <span className="flex-1">
                  <span className="font-medium text-slate-900">
                    {appointment.patient.first_name} {appointment.patient.last_name}
                  </span>{' '}
                  · {appointment.reason}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tagClasses}`}>{tagLabel}</span>
                {isNext && appointment.status === 'approved' && (
                  <button
                    type="button"
                    disabled={actingId === appointment.id}
                    onClick={() => handleMarkArrived(appointment.id)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Mark arrived
                  </button>
                )}
              </div>
            );
          })}

          <Link to="/doctor/appointments" className="mt-3 inline-block text-sm font-medium">
            View all appointments →
          </Link>
        </section>

        <section className="min-w-0 flex-[1_1_260px] space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">My next available days</h2>
          {availableDays.length === 0 ? (
            <p className="text-sm text-slate-500">No upcoming available days set.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableDays.map((day) => (
                <span
                  key={day.date}
                  className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
                >
                  {formatDayTag(day.date)}
                  {day.full ? ' · full' : ''}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">Patients can only book on these days.</p>

          <h2 className="pt-2 text-base font-semibold text-slate-900">Recent emails</h2>
          {emails.length === 0 ? (
            <p className="text-sm text-slate-500">No recent emails.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
              {emails.map((email) => (
                <li key={email.ref + email.sent_at}>{email.subject}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
