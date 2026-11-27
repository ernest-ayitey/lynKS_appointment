import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { GENERIC_ERROR_MESSAGE, applyApiError } from '../../lib/api-error-handling';
import { useAuth } from '../../lib/auth-context';
import { getPublicAvailability, getSlots } from '../doctor/doctor.api';
import {
  approveAlternateRequest,
  approveRequest,
  declineRequest,
  getRequest,
  type RecordsPatientStats,
  type RecordsRequestDetail,
} from './records.api';

type Decision = 'approve' | 'approve_alternate' | 'decline';

interface DecisionFormValues {
  decision: Decision;
  altDate: string;
  altTime: string;
  declineReasonCode: string;
  declineMessage: string;
  internalNote: string;
}

// Mirrors Appointment::DECLINE_REASON_CODES in apps/api/app/models/appointment.rb,
// in the fixed order screen-specs.md:135 lists them.
const DECLINE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'doctor_unavailable', label: 'Doctor unavailable' },
  { value: 'slot_taken', label: 'Slot already taken' },
  { value: 'needs_referral', label: 'Needs referral first' },
  { value: 'other', label: 'Other' },
];

// Maps the backend's snake_case `errors` keys to this form's field names —
// one map per decision endpoint, since each has a different payload shape.
// `approveRequest` takes no body today (see records.api.ts), so it has no
// field-level errors to map.
const FIELD_MAP_ALTERNATE: Record<string, keyof DecisionFormValues> = {
  date: 'altDate',
  time: 'altTime',
};
const FIELD_MAP_DECLINE: Record<string, keyof DecisionFormValues> = {
  decline_reason_code: 'declineReasonCode',
  decline_message: 'declineMessage',
};

// Mirrors RecordsQueuePage's STATUS_BADGE_CLASSES — kept as a local copy
// rather than imported, since that page doesn't export it.
const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-600',
};

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatVisitType(visitType: string): string {
  return visitType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function RequestReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { authedFetch } = useAuth();

  const [requestDetail, setRequestDetail] = useState<RecordsRequestDetail | null>(null);
  const [patientStats, setPatientStats] = useState<RecordsPatientStats | null>(null);
  const [loadBanner, setLoadBanner] = useState<string | null>(null);

  // The requested date's free times, and (once an alternate date is picked)
  // that date's free times — each straight from `getSlots`. The doctor-day
  // grid never re-derives "booked" from the full slot grid; it only ever
  // checks membership of one specific time in one of these two lists.
  const [requestedFreeTimes, setRequestedFreeTimes] = useState<string[]>([]);
  const [altFreeTimes, setAltFreeTimes] = useState<string[]>([]);
  const [gridBanner, setGridBanner] = useState<string | null>(null);

  const [formBanner, setFormBanner] = useState<string | null>(null);
  const [outcomeBanner, setOutcomeBanner] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DecisionFormValues>({
    defaultValues: {
      decision: 'approve',
      altDate: '',
      altTime: '',
      declineReasonCode: '',
      declineMessage: '',
      internalNote: '',
    },
  });

  const decision = watch('decision');
  const altDate = watch('altDate');
  const altTime = watch('altTime');
  const declineReasonCode = watch('declineReasonCode');

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const response = await getRequest(authedFetch, Number(id));
        if (!cancelled) {
          setRequestDetail(response.request);
          setPatientStats(response.patient_stats);
          // Seeds the textarea with whatever note already exists, so a
          // records user re-opening a request (or returning after an Undo)
          // can see it rather than facing a blank field that would silently
          // overwrite it on the next submission.
          setValue('internalNote', response.request.internal_note ?? '');
        }
      } catch (err) {
        if (!cancelled) setLoadBanner(err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authedFetch, id]);

  // Loads the requested date's doctor-day data once the request detail has
  // loaded: `getPublicAvailability` for that month (to confirm the day is
  // open) and `getSlots` for that date (the free-times list the "no
  // conflicts" check and the grid's booked/free badge both read from).
  useEffect(() => {
    if (!requestDetail) return undefined;
    let cancelled = false;
    async function load(detail: RecordsRequestDetail) {
      try {
        await getPublicAvailability(authedFetch, detail.doctor.id, detail.date.slice(0, 7));
        const slotsResponse = await getSlots(authedFetch, detail.doctor.id, detail.date);
        if (!cancelled) setRequestedFreeTimes(slotsResponse.slots);
      } catch {
        if (!cancelled) setGridBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load(requestDetail);
    return () => {
      cancelled = true;
    };
  }, [authedFetch, requestDetail]);

  // Loads the chosen alternate date's free times whenever it changes, and
  // clears any previously chosen alternate time below it — same
  // clear-the-dependent-field pattern as BookAppointmentPage's date/time
  // effects.
  useEffect(() => {
    setValue('altTime', '');
    if (!requestDetail || !altDate) {
      setAltFreeTimes([]);
      return undefined;
    }
    let cancelled = false;
    async function load(detail: RecordsRequestDetail, date: string) {
      try {
        const slotsResponse = await getSlots(authedFetch, detail.doctor.id, date);
        if (!cancelled) setAltFreeTimes(slotsResponse.slots);
      } catch {
        if (!cancelled) setGridBanner(GENERIC_ERROR_MESSAGE);
      }
    }
    void load(requestDetail, altDate);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch, requestDetail, altDate]);

  // The confirm button's enabled-state tracks the selected decision's own
  // required fields, not react-hook-form's built-in validation — Approve
  // has none, Approve-a-different-slot needs both a date and a time,
  // Decline needs a reason.
  const canSubmit = useMemo(() => {
    if (decision === 'approve') return true;
    if (decision === 'approve_alternate') return Boolean(altDate && altTime);
    return Boolean(declineReasonCode);
  }, [decision, altDate, altTime, declineReasonCode]);

  const relevantDate = decision === 'approve_alternate' && altDate ? altDate : requestDetail?.date;
  const relevantTime = decision === 'approve_alternate' && altTime ? altTime : requestDetail?.time;
  const relevantFreeTimes = decision === 'approve_alternate' && altTime ? altFreeTimes : requestedFreeTimes;

  // `GET /doctors/:id/slots` excludes every time held by an *occupying*
  // appointment — including this very (still-pending) request's own slot.
  // So membership-testing the originally requested slot against its own
  // free-times list is always false, which would always read as a
  // conflict even though re-approving a request at its own slot can never
  // conflict with itself. Only a genuinely different (alternate) slot
  // needs the plain membership check below — this flag is true whenever
  // the slot under consideration is the request's own, regardless of
  // which decision is currently selected.
  const isOwnSlot = relevantDate === requestDetail?.date && relevantTime === requestDetail?.time;
  const noConflicts = relevantTime ? isOwnSlot || relevantFreeTimes.includes(relevantTime) : false;

  // The slot-grid's cells: every known-free time for the relevant date,
  // plus the relevant (requested/alternate) slot itself if it isn't
  // already one of them — which is always true for the originally
  // requested slot (the backend's free-times list excludes it by design,
  // per `isOwnSlot` above) and can also happen for a forced/stale
  // alternate-time value. Every entry besides the relevant slot is, by
  // construction, a member of `relevantFreeTimes` and therefore free;
  // the relevant slot's own free/booked status is `noConflicts`.
  const slotTimes = useMemo(() => {
    const times = new Set(relevantFreeTimes);
    if (relevantTime) times.add(relevantTime);
    return Array.from(times).sort();
  }, [relevantFreeTimes, relevantTime]);

  async function onSubmit(data: DecisionFormValues) {
    if (!requestDetail) return;
    setFormBanner(null);
    setOutcomeBanner(null);

    // Built once and reused across all three payloads below — `undefined`
    // (never an empty string) when blank, since the backend's three
    // decision routes all default a missing/falsy `internal_note` to the
    // appointment's existing note (records.rb), so a present-but-empty
    // value must not overwrite it.
    const notePayload: { internal_note?: string } | undefined = data.internalNote
      ? { internal_note: data.internalNote }
      : undefined;

    try {
      if (data.decision === 'approve') {
        // `undefined` is passed as "no third argument at all" rather than
        // as an explicit third argument — keeps a no-note Approve call
        // identical in arity to the pre-this-task call site this wrapper
        // still has to support (records-queue.page.tsx's inline Approve
        // button).
        if (notePayload) {
          await approveRequest(authedFetch, requestDetail.id, notePayload);
        } else {
          await approveRequest(authedFetch, requestDetail.id);
        }
        setOutcomeBanner('Approved — emails sent to the patient and doctor.');
      } else if (data.decision === 'approve_alternate') {
        await approveAlternateRequest(authedFetch, requestDetail.id, {
          date: data.altDate,
          time: data.altTime,
          ...notePayload,
        });
        setOutcomeBanner('Approved for the new time — emails sent to the patient and doctor.');
      } else {
        await declineRequest(authedFetch, requestDetail.id, {
          decline_reason_code: data.declineReasonCode,
          ...(data.declineMessage ? { decline_message: data.declineMessage } : {}),
          ...notePayload,
        });
        setOutcomeBanner('Declined — the slot has been freed and the patient has been emailed.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldMap =
          data.decision === 'approve_alternate'
            ? FIELD_MAP_ALTERNATE
            : data.decision === 'decline'
              ? FIELD_MAP_DECLINE
              : {};
        applyApiError(err, fieldMap, setError, setFormBanner);
        return;
      }
      setFormBanner(GENERIC_ERROR_MESSAGE);
    }
  }

  if (!requestDetail || !patientStats) {
    return (
      <div className="mx-auto max-w-6xl">
        {loadBanner ? (
          <p role="alert" className="text-sm text-red-700">
            {loadBanner}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </div>
    );
  }

  const confirmLabel =
    decision === 'approve' ? 'Approve' : decision === 'approve_alternate' ? 'Approve for the new time' : 'Decline request';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          Request <span data-testid="request-ref">{requestDetail.ref}</span>
        </h1>
        <span
          data-testid="request-status"
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            STATUS_BADGE_CLASSES[requestDetail.status] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {formatStatus(requestDetail.status)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-medium text-slate-900">Requested appointment</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Doctor</dt>
              <dd className="text-slate-900">
                Dr. {requestDetail.doctor.first_name} {requestDetail.doctor.last_name}
              </dd>
              <dt className="text-slate-500">Date &amp; time</dt>
              <dd className="text-slate-900">
                {requestDetail.date} at {requestDetail.time}
              </dd>
              <dt className="text-slate-500">Visit type</dt>
              <dd className="text-slate-900">{formatVisitType(requestDetail.visit_type)}</dd>
              <dt className="text-slate-500">Reason</dt>
              <dd className="text-slate-900">{requestDetail.reason}</dd>
              <dt className="text-slate-500">Submitted</dt>
              <dd className="text-slate-900">{requestDetail.submitted_at}</dd>
            </dl>
          </section>

          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-medium text-slate-900">Patient</h2>
            <p className="font-medium text-slate-900">
              {requestDetail.patient.first_name} {requestDetail.patient.last_name}
            </p>
            <p className="text-sm text-slate-500">Patient ID: {requestDetail.patient.id}</p>
            <p className="text-sm text-slate-700">{requestDetail.patient.email}</p>
            <p className="text-sm text-slate-700">{requestDetail.patient.phone}</p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Previous visits</dt>
              <dd className="text-slate-900">
                {patientStats.previous_visits_count} (last: {patientStats.last_visit_date ?? '—'})
              </dd>
              <dt className="text-slate-500">No-shows</dt>
              <dd className="text-slate-900">{patientStats.no_show_count}</dd>
              <dt className="text-slate-500">Other pending</dt>
              <dd className="text-slate-900">{patientStats.other_pending_count}</dd>
            </dl>
          </section>

          <section data-testid="doctor-day-grid" className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-medium text-slate-900">
              Dr. {requestDetail.doctor.last_name}'s day — {relevantDate}
            </h2>
            <div data-testid="slot-grid" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {slotTimes.length === 0 ? (
                <p className="col-span-full text-sm text-slate-500">No known slots for this date yet.</p>
              ) : (
                slotTimes.map((slot) => {
                  const isSelected = slot === relevantTime;
                  const isFree = isSelected ? noConflicts : true;
                  return (
                    <span
                      key={slot}
                      data-testid={isSelected ? 'selected-slot-badge' : undefined}
                      className={[
                        'rounded-md px-2 py-1.5 text-center text-xs font-medium',
                        isFree ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600',
                        isSelected ? 'border-2 border-blue-600' : '',
                      ].join(' ')}
                    >
                      {slot}
                      {isSelected && <span className="block text-[10px] font-semibold">{isFree ? 'Free' : 'Booked'}</span>}
                    </span>
                  );
                })
              )}
            </div>
            <p data-testid="no-conflicts-line" className="mt-4 text-sm font-medium text-slate-900">
              {noConflicts ? 'No conflicts — this time is free.' : 'Conflict — this time is already booked.'}
            </p>
            {gridBanner && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {gridBanner}
              </p>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-medium text-slate-900">Decision</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <fieldset className="space-y-2">
                <legend className="sr-only">Decision</legend>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                    decision === 'approve' ? 'border-2 border-blue-600 bg-slate-50' : 'border-slate-300'
                  }`}
                >
                  <input type="radio" value="approve" aria-label="Approve" className="mt-1" {...register('decision')} />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-slate-900">Approve</span>
                    <span className="text-xs text-slate-500">Confirms the slot and emails patient + doctor</span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                    decision === 'approve_alternate' ? 'border-2 border-blue-600 bg-slate-50' : 'border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    value="approve_alternate"
                    aria-label="Approve a different slot"
                    className="mt-1"
                    {...register('decision')}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-slate-900">Approve a different slot</span>
                    <span className="text-xs text-slate-500">Move to another open slot on the doctor's available days</span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                    decision === 'decline' ? 'border-2 border-blue-600 bg-slate-50' : 'border-slate-300'
                  }`}
                >
                  <input type="radio" value="decline" aria-label="Decline" className="mt-1" {...register('decision')} />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-slate-900">Decline</span>
                    <span className="text-xs text-slate-500">Frees the slot and emails the patient the reason</span>
                  </span>
                </label>
              </fieldset>

              {decision === 'approve_alternate' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="altDate" className="block text-sm font-medium text-slate-700">
                      New date
                    </label>
                    <input
                      id="altDate"
                      type="date"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      {...register('altDate')}
                    />
                    {errors.altDate && <p className="mt-1 text-sm text-red-600">{errors.altDate.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="altTime" className="block text-sm font-medium text-slate-700">
                      New time
                    </label>
                    <select
                      id="altTime"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      {...register('altTime')}
                    >
                      <option value="">Select a time</option>
                      {altFreeTimes.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                    {errors.altTime && <p className="mt-1 text-sm text-red-600">{errors.altTime.message}</p>}
                  </div>
                </div>
              )}

              {decision === 'decline' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="declineReasonCode" className="block text-sm font-medium text-slate-700">
                      Reason
                    </label>
                    <select
                      id="declineReasonCode"
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      {...register('declineReasonCode')}
                    >
                      <option value="">Select a reason</option>
                      {DECLINE_REASONS.map((reason) => (
                        <option key={reason.value} value={reason.value}>
                          {reason.label}
                        </option>
                      ))}
                    </select>
                    {errors.declineReasonCode && (
                      <p className="mt-1 text-sm text-red-600">{errors.declineReasonCode.message}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="declineMessage" className="block text-sm font-medium text-slate-700">
                      Message to patient
                    </label>
                    <textarea
                      id="declineMessage"
                      rows={3}
                      maxLength={255}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      {...register('declineMessage')}
                    />
                    {errors.declineMessage && (
                      <p className="mt-1 text-sm text-red-600">{errors.declineMessage.message}</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="internalNote" className="block text-sm font-medium text-slate-700">
                  Internal note
                </label>
                <textarea
                  id="internalNote"
                  rows={2}
                  maxLength={255}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register('internalNote')}
                />
              </div>

              <div data-testid="emails-preview" className="space-y-1 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Emails that will be sent</p>
                <p data-testid="emails-preview-patient">Patient — {requestDetail.patient.email}</p>
                {decision !== 'decline' && (
                  <p data-testid="emails-preview-doctor">Doctor — the attending doctor</p>
                )}
              </div>

              {formBanner && (
                <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formBanner}
                </div>
              )}
              {outcomeBanner && (
                <div role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                  {outcomeBanner}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !canSubmit}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {confirmLabel}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
