import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE, applyApiError } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import {
  getAvailability,
  getSessionSettings,
  updateAvailability,
  updateSessionSettings,
  type SessionSettings,
} from './doctor.api';

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

// Mon-first, matching the screen spec's weekly-repeat chips. `value` is the
// matching `Date#getDay()` (Sun = 0 ... Sat = 6).
const WEEKDAY_CHIPS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

// These mirror DEFAULT_SESSION_SETTINGS in apps/api/app/routes/doctors.rb —
// what GET /doctor/session-settings returns before the doctor has ever saved
// a row — so the form starts in the same state the backend would hand back.
const DEFAULT_SETTINGS: SessionSettings = {
  start_time: '09:00',
  end_time: '17:00',
  slot_length_minutes: 20,
  max_patients_per_day: null,
  break_start: null,
  break_end: null,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Number of blank leading cells before day 1, with the grid starting on
// Monday (Date#getDay() is Sun-first, so shift it to Mon-first).
function leadingBlankCount(date: Date): number {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  return (firstOfMonth.getDay() + 6) % 7;
}

// Every date in `monthDate`'s month that falls on `weekday` (Date#getDay()
// numbering). A client-side convenience over the same set/unset arrays the
// backend already accepts — not a stored rule, per the design spec.
function datesForWeekday(monthDate: Date, weekday: number): string[] {
  const total = daysInMonth(monthDate);
  const dates: string[] = [];
  for (let day = 1; day <= total; day++) {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    if (date.getDay() === weekday) dates.push(isoDate(date));
  }
  return dates;
}

interface SessionSettingsFormValues {
  startTime: string;
  endTime: string;
  slotLengthMinutes: string;
  maxPatientsPerDay: string;
  breakStart: string;
  breakEnd: string;
}

const SETTINGS_FIELD_MAP: Record<string, keyof SessionSettingsFormValues> = {
  start_time: 'startTime',
  end_time: 'endTime',
  slot_length_minutes: 'slotLengthMinutes',
  max_patients_per_day: 'maxPatientsPerDay',
  break_start: 'breakStart',
  break_end: 'breakEnd',
};

function toFormValues(settings: SessionSettings): SessionSettingsFormValues {
  return {
    startTime: settings.start_time,
    endTime: settings.end_time,
    slotLengthMinutes: String(settings.slot_length_minutes),
    maxPatientsPerDay: settings.max_patients_per_day === null ? '' : String(settings.max_patients_per_day),
    breakStart: settings.break_start ?? '',
    breakEnd: settings.break_end ?? '',
  };
}

export default function DoctorAvailabilityPage() {
  const { authedFetch } = useAuth();

  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [availableDays, setAvailableDays] = useState<Set<string>>(new Set());
  // Local overrides not yet saved: 'set' marks a date available, 'unset'
  // marks it unavailable, regardless of what `availableDays` currently says.
  const [pendingChanges, setPendingChanges] = useState<Map<string, 'set' | 'unset'>>(new Map());
  const [availabilityBanner, setAvailabilityBanner] = useState<string | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);

  const [settingsBanner, setSettingsBanner] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting: savingSettings },
  } = useForm<SessionSettingsFormValues>({ defaultValues: toFormValues(DEFAULT_SETTINGS) });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await getAvailability(authedFetch, monthKey(monthDate));
        if (!cancelled) setAvailableDays(new Set(response.days));
      } catch {
        if (!cancelled) setAvailabilityBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authedFetch, monthDate]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const settings = await getSessionSettings(authedFetch);
        if (!cancelled) reset(toFormValues(settings));
      } catch {
        if (!cancelled) setSettingsBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch]);

  function isAvailable(dateIso: string): boolean {
    const pending = pendingChanges.get(dateIso);
    if (pending) return pending === 'set';
    return availableDays.has(dateIso);
  }

  function toggleDay(dateIso: string) {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      next.set(dateIso, isAvailable(dateIso) ? 'unset' : 'set');
      return next;
    });
  }

  function applyWeekday(weekday: number) {
    const dates = datesForWeekday(monthDate, weekday);
    setPendingChanges((prev) => {
      const next = new Map(prev);
      dates.forEach((dateIso) => next.set(dateIso, 'set'));
      return next;
    });
  }

  async function handleSaveAvailability() {
    setAvailabilityBanner(null);
    const set: string[] = [];
    const unset: string[] = [];
    pendingChanges.forEach((action, dateIso) => (action === 'set' ? set : unset).push(dateIso));

    setSavingAvailability(true);
    try {
      await updateAvailability(authedFetch, { set, unset });
      setPendingChanges(new Map());
      const response = await getAvailability(authedFetch, monthKey(monthDate));
      setAvailableDays(new Set(response.days));
    } catch (err) {
      // The calendar has no per-field inputs to hang errors off, so this
      // banner is the only place a validation failure can surface. The
      // backend's 422 `message` is always the generic "Please correct the
      // highlighted fields" — the actionable detail ("Dates must not be in
      // the past", "Dates must be within 180 days from today", "Enter valid
      // dates (YYYY-MM-DD)") is in `errors.dates`, the single key
      // PUT /doctor/availability reports under. Prefer it; fall back to
      // `message` for responses with no field errors at all (401/403/500).
      if (err instanceof ApiError) {
        setAvailabilityBanner(err.errors?.dates ?? err.message);
      } else {
        setAvailabilityBanner(GENERIC_ERROR_MESSAGE);
      }
    } finally {
      setSavingAvailability(false);
    }
  }

  async function onSubmitSettings(data: SessionSettingsFormValues) {
    setSettingsBanner(null);
    const payload: SessionSettings = {
      start_time: data.startTime,
      end_time: data.endTime,
      slot_length_minutes: Number(data.slotLengthMinutes),
      max_patients_per_day: data.maxPatientsPerDay === '' ? null : Number(data.maxPatientsPerDay),
      break_start: data.breakStart === '' ? null : data.breakStart,
      break_end: data.breakEnd === '' ? null : data.breakEnd,
    };
    try {
      const settings = await updateSessionSettings(authedFetch, payload);
      reset(toFormValues(settings));
    } catch (err) {
      if (err instanceof ApiError) {
        applyApiError(err, SETTINGS_FIELD_MAP, setError, setSettingsBanner);
        return;
      }
      setSettingsBanner(GENERIC_ERROR_MESSAGE);
    }
  }

  const blanks = Array.from({ length: leadingBlankCount(monthDate) });
  const days = Array.from({ length: daysInMonth(monthDate) }, (_, i) => i + 1);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <h1 className="text-2xl font-semibold text-slate-900">Doctor availability</h1>

        <section className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
            >
              ‹
            </button>
            <h2 className="text-lg font-medium text-slate-900">
              {MONTH_NAMES[monthDate.getMonth()]} {monthDate.getFullYear()}
            </h2>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
            >
              ›
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {WEEKDAY_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => applyWeekday(chip.value)}
                className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {blanks.map((_, index) => (
              <div key={`blank-${index}`} />
            ))}
            {days.map((day) => {
              const dateIso = isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
              const available = isAvailable(dateIso);
              return (
                <button
                  key={dateIso}
                  type="button"
                  aria-label={dateIso}
                  aria-pressed={available}
                  onClick={() => toggleDay(dateIso)}
                  className={`rounded-md py-2 ${
                    available ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {availabilityBanner && (
            <div role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {availabilityBanner}
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveAvailability}
            disabled={savingAvailability}
            className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Save availability
          </button>
        </section>

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-medium text-slate-900">Session settings</h2>

          <form onSubmit={handleSubmit(onSubmitSettings)} className="space-y-4" noValidate>
            {settingsBanner && (
              <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {settingsBanner}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="startTime" className="block text-sm font-medium text-slate-700">
                  Start time
                </label>
                <input
                  id="startTime"
                  type="time"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register('startTime', { required: true })}
                />
                {errors.startTime && <p className="mt-1 text-sm text-red-600">{errors.startTime.message}</p>}
              </div>

              <div>
                <label htmlFor="endTime" className="block text-sm font-medium text-slate-700">
                  End time
                </label>
                <input
                  id="endTime"
                  type="time"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register('endTime', { required: true })}
                />
                {errors.endTime && <p className="mt-1 text-sm text-red-600">{errors.endTime.message}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="slotLengthMinutes" className="block text-sm font-medium text-slate-700">
                Slot length (minutes)
              </label>
              <input
                id="slotLengthMinutes"
                type="number"
                min={1}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register('slotLengthMinutes', { required: true })}
              />
              {errors.slotLengthMinutes && (
                <p className="mt-1 text-sm text-red-600">{errors.slotLengthMinutes.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="maxPatientsPerDay" className="block text-sm font-medium text-slate-700">
                Max patients per day (optional)
              </label>
              <input
                id="maxPatientsPerDay"
                type="number"
                min={1}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...register('maxPatientsPerDay')}
              />
              {errors.maxPatientsPerDay && (
                <p className="mt-1 text-sm text-red-600">{errors.maxPatientsPerDay.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="breakStart" className="block text-sm font-medium text-slate-700">
                  Break start (optional)
                </label>
                <input
                  id="breakStart"
                  type="time"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register('breakStart')}
                />
                {errors.breakStart && <p className="mt-1 text-sm text-red-600">{errors.breakStart.message}</p>}
              </div>

              <div>
                <label htmlFor="breakEnd" className="block text-sm font-medium text-slate-700">
                  Break end (optional)
                </label>
                <input
                  id="breakEnd"
                  type="time"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register('breakEnd')}
                />
                {errors.breakEnd && <p className="mt-1 text-sm text-red-600">{errors.breakEnd.message}</p>}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Save session settings
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
