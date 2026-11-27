import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE, applyApiError } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import {
  getDepartments,
  getDoctors,
  getPublicAvailability,
  getSlots,
  type Department,
  type Doctor,
} from '../doctor/doctor.api';
import { bookAppointment, type BookAppointmentPayload } from './appointments.api';

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

// Mirrors Appointment::VISIT_TYPES in apps/api/app/models/appointment.rb.
const VISIT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'new_consultation', label: 'New consultation' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'review_results', label: 'Review results' },
];

interface BookAppointmentFormValues {
  departmentId: string;
  doctorId: string;
  date: string;
  time: string;
  visitType: string;
  reason: string;
  smsReminderOptIn: boolean;
}

// Maps the backend's snake_case `errors` keys (apps/api/app/routes/appointments.rb's
// POST /appointments) to this form's field names.
const BACKEND_FIELD_TO_FORM_FIELD: Record<string, keyof BookAppointmentFormValues> = {
  doctor_id: 'doctorId',
  date: 'date',
  time: 'time',
  visit_type: 'visitType',
  reason: 'reason',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Number of blank leading cells before day 1, with the grid starting on
// Monday (Date#getDay() is Sun-first, so shift it to Mon-first) — same grid
// math as doctor-availability.page.tsx's calendar.
function leadingBlankCount(date: Date): number {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  return (firstOfMonth.getDay() + 6) % 7;
}

// A patient only ever books within the current month's calendar here (no
// month navigation) — nothing in this plan's brief asks for booking into a
// future month from this page.
export default function BookAppointmentPage() {
  const { authedFetch } = useAuth();
  const navigate = useNavigate();

  const [monthDate] = useState(() => new Date());

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsBanner, setDepartmentsBanner] = useState<string | null>(null);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsBanner, setDoctorsBanner] = useState<string | null>(null);

  const [availableDays, setAvailableDays] = useState<Set<string>>(new Set());
  const [availabilityBanner, setAvailabilityBanner] = useState<string | null>(null);

  const [slots, setSlots] = useState<string[]>([]);
  const [slotsBanner, setSlotsBanner] = useState<string | null>(null);

  const [formBanner, setFormBanner] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BookAppointmentFormValues>({
    defaultValues: {
      departmentId: '',
      doctorId: '',
      date: '',
      time: '',
      visitType: '',
      reason: '',
      smsReminderOptIn: false,
    },
  });

  const departmentId = watch('departmentId');
  const doctorId = watch('doctorId');
  const date = watch('date');
  const time = watch('time');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await getDepartments(authedFetch);
        if (!cancelled) setDepartments(response);
      } catch {
        if (!cancelled) setDepartmentsBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authedFetch]);

  // Re-fetches whenever the selected department changes (an empty selection
  // means "all departments", same as omitting `department_id` on the
  // backend) and clears the doctor selection below it, since a previously
  // picked doctor may no longer be in the narrowed list.
  useEffect(() => {
    let cancelled = false;
    setValue('doctorId', '');
    async function load() {
      try {
        const response = await getDoctors(authedFetch, departmentId || undefined);
        if (!cancelled) setDoctors(response);
      } catch {
        if (!cancelled) setDoctorsBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch, departmentId]);

  // Loads the current month's availability once a doctor is picked, and
  // clears the date selection below it on every doctor change.
  useEffect(() => {
    setAvailableDays(new Set());
    setValue('date', '');
    if (!doctorId) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const response = await getPublicAvailability(authedFetch, Number(doctorId), monthKey(monthDate));
        if (!cancelled) setAvailableDays(new Set(response.days));
      } catch {
        if (!cancelled) setAvailabilityBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch, doctorId]);

  // Loads that day's slots once an available day is picked, and clears the
  // time selection below it on every date change.
  useEffect(() => {
    setSlots([]);
    setValue('time', '');
    if (!doctorId || !date) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const response = await getSlots(authedFetch, Number(doctorId), date);
        if (!cancelled) setSlots(response.slots);
      } catch {
        if (!cancelled) setSlotsBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch, doctorId, date]);

  // `availableDays` can legitimately contain past dates: doctors.rb's
  // `available_dates_in_month` applies no past-date filter (stale rows
  // accumulate until a doctor unsets them via PUT /doctor/availability),
  // and POST /appointments unconditionally 422s on a past date regardless
  // of what DoctorAvailabilityDay says. So a day must be both in
  // `availableDays` AND today-or-later to ever be selectable here.
  const todayIso = isoDate(new Date());

  function isBookable(dateIso: string): boolean {
    return availableDays.has(dateIso) && dateIso >= todayIso;
  }

  function selectDate(dateIso: string) {
    if (!isBookable(dateIso)) return;
    setValue('date', dateIso, { shouldValidate: true });
  }

  function selectTime(slot: string) {
    setValue('time', slot, { shouldValidate: true });
  }

  async function onSubmit(data: BookAppointmentFormValues) {
    setFormBanner(null);
    const payload: BookAppointmentPayload = {
      doctor_id: Number(data.doctorId),
      date: data.date,
      time: data.time,
      visit_type: data.visitType,
      reason: data.reason,
      sms_reminder_opt_in: data.smsReminderOptIn,
    };
    try {
      await bookAppointment(authedFetch, payload);
      navigate('/appointments');
    } catch (err) {
      if (err instanceof ApiError) {
        applyApiError(err, BACKEND_FIELD_TO_FORM_FIELD, setError, setFormBanner);
        return;
      }
      setFormBanner(GENERIC_ERROR_MESSAGE);
    }
  }

  const blanks = Array.from({ length: leadingBlankCount(monthDate) });
  const days = Array.from({ length: daysInMonth(monthDate) }, (_, i) => i + 1);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Book an appointment</h1>
        <p className="mt-1 text-sm text-slate-500">
          Only days your doctor has marked as available can be selected.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {formBanner && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {formBanner}
          </div>
        )}

        {/* Registered-but-unrendered: these two selections are driven by
            the calendar/slot buttons below via `setValue`, not a visible
            input, but still need to participate in react-hook-form's
            validation and submitted values. */}
        <input type="hidden" {...register('date', { required: true })} />
        <input type="hidden" {...register('time', { required: true })} />

        <section className="rounded-lg border border-slate-300 bg-white p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
              1
            </span>
            Choose department &amp; doctor
          </div>

          <div className="mt-4">
            <label htmlFor="departmentId" className="block text-sm font-medium text-slate-700">
              Department
            </label>
            <select
              id="departmentId"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('departmentId')}
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            {departmentsBanner && <p className="mt-1 text-sm text-red-600">{departmentsBanner}</p>}
          </div>

          <div className="mt-4">
            <label htmlFor="doctorId" className="block text-sm font-medium text-slate-700">
              Doctor
            </label>
            <select
              id="doctorId"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('doctorId', { required: true })}
            >
              <option value="">Select a doctor</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.first_name} {doctor.last_name} — {doctor.department.name}
                </option>
              ))}
            </select>
            {errors.doctorId && <p className="mt-1 text-sm text-red-600">{errors.doctorId.message}</p>}
            {doctorsBanner && <p className="mt-1 text-sm text-red-600">{doctorsBanner}</p>}
          </div>
        </section>

        {doctorId && (
          <section className="rounded-lg border border-slate-300 bg-white p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  2
                </span>
                Pick an available day
              </div>
              <span className="text-sm font-medium text-slate-900">
                {MONTH_NAMES[monthDate.getMonth()]} {monthDate.getFullYear()}
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-sm">
              {blanks.map((_, index) => (
                <div key={`blank-${index}`} />
              ))}
              {days.map((day) => {
                const dateIso = isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
                const available = isBookable(dateIso);
                const selected = date === dateIso;
                return (
                  <button
                    key={dateIso}
                    type="button"
                    aria-label={dateIso}
                    aria-pressed={selected}
                    disabled={!available}
                    onClick={() => selectDate(dateIso)}
                    className={`rounded-md border py-2 font-medium ${
                      selected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : available
                          ? 'border-blue-600 bg-white text-blue-700 hover:bg-blue-50'
                          : 'cursor-not-allowed border-transparent bg-slate-50 text-slate-300'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            {errors.date && <p className="mt-2 text-sm text-red-600">{errors.date.message}</p>}
            {availabilityBanner && <p className="mt-2 text-sm text-red-600">{availabilityBanner}</p>}
          </section>
        )}

        {date && (
          <section className="rounded-lg border border-slate-300 bg-white p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                3
              </span>
              Choose a time
            </div>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={time === slot}
                  onClick={() => selectTime(slot)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                    time === slot
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {slot}
                </button>
              ))}
              {slots.length === 0 && <p className="text-sm text-slate-500">No times available for this day.</p>}
            </div>
            {errors.time && <p className="mt-2 text-sm text-red-600">{errors.time.message}</p>}
            {slotsBanner && <p className="mt-2 text-sm text-red-600">{slotsBanner}</p>}
          </section>
        )}

        <section className="space-y-4 rounded-lg border border-slate-300 bg-white p-6">
          <div>
            <label htmlFor="visitType" className="block text-sm font-medium text-slate-700">
              Visit type
            </label>
            <select
              id="visitType"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('visitType', { required: true })}
            >
              <option value="">Select a visit type</option>
              {VISIT_TYPES.map((visitType) => (
                <option key={visitType.value} value={visitType.value}>
                  {visitType.label}
                </option>
              ))}
            </select>
            {errors.visitType && <p className="mt-1 text-sm text-red-600">{errors.visitType.message}</p>}
          </div>

          <div>
            <label htmlFor="reason" className="block text-sm font-medium text-slate-700">
              Reason for visit
            </label>
            <textarea
              id="reason"
              rows={3}
              placeholder="Briefly describe your symptoms or reason"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('reason', { required: true })}
            />
            {errors.reason && <p className="mt-1 text-sm text-red-600">{errors.reason.message}</p>}
          </div>

          <label htmlFor="smsReminderOptIn" className="flex items-center gap-2 text-sm text-slate-700">
            <input id="smsReminderOptIn" type="checkbox" {...register('smsReminderOptIn')} />
            Send me an SMS reminder
          </label>
        </section>

        <button
          type="submit"
          disabled={isSubmitting || !doctorId || !date || !time}
          className="w-full rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:border-blue-700 hover:bg-blue-700 disabled:opacity-60"
        >
          Book appointment
        </button>
      </form>
    </div>
  );
}
