// Thin wrapper around the records-queue endpoints in
// apps/api/app/routes/records.rb ('/records/...'). Takes the caller's
// `authedFetch` (from useAuth()) rather than importing the auth context
// directly, matching ../appointments/appointments.api.ts's convention.
//
// This file is grown across two tasks of the same plan: this task defines
// the read side (`getQueue`) plus `approveRequest`/`undoRequest` (needed by
// the queue page's inline row actions), and a later task adds
// `getRequest`/`approveAlternateRequest`/`declineRequest` for the
// single-request review screen. Both land in this one module rather than
// splitting records.api.ts in two.

export interface RecordsQueueStats {
  pending: number;
  approved_today: number;
  declined_today: number;
  oldest_waiting_at: string | null;
}

export interface RecordsPersonSummary {
  id: number;
  first_name: string;
  last_name: string;
}

// Mirrors records.rb's `request_json(appointment, department:, detailed:)`
// in its default (non-detailed) shape — the queue never passes
// `detailed: true`, so `patient` here never carries email/phone.
export interface RecordsQueueRequest {
  id: number;
  ref: string;
  patient: RecordsPersonSummary;
  doctor: RecordsPersonSummary;
  department: { id: number; name: string };
  date: string;
  time: string;
  duration_minutes: number;
  visit_type: string;
  reason: string;
  status: string;
  submitted_at: string;
  decided_at: string | null;
  decline_reason_code: string | null;
  decline_message: string | null;
  internal_note: string | null;
}

export interface RecordsQueueFilters {
  status?: 'pending' | 'approved' | 'declined' | 'cancelled';
  doctor_id?: number;
  search?: string;
  sort?: 'oldest' | 'newest';
}

export interface RecordsQueueResponse {
  stats: RecordsQueueStats;
  requests: RecordsQueueRequest[];
  total: number;
}

type AuthedFetch = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

// An absent/empty filter contributes no query param at all, matching
// appointments.api.ts's `listAppointments` convention (and records.rb's own
// lenient treatment of a missing `status`/`doctor_id`/`search`/`sort`).
export function getQueue(authedFetch: AuthedFetch, filters?: RecordsQueueFilters): Promise<RecordsQueueResponse> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.doctor_id !== undefined) params.set('doctor_id', String(filters.doctor_id));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.sort) params.set('sort', filters.sort);

  const query = params.toString();
  return authedFetch<RecordsQueueResponse>(`/records/queue${query ? `?${query}` : ''}`);
}

// Approves a pending request at its originally requested date/time.
export function approveRequest(authedFetch: AuthedFetch, id: number): Promise<{ request: RecordsQueueRequest }> {
  return authedFetch<{ request: RecordsQueueRequest }>(`/records/requests/${id}/approve`, { method: 'POST' });
}

// Reverts a declined or approved request back to `pending`.
export function undoRequest(authedFetch: AuthedFetch, id: number): Promise<{ request: RecordsQueueRequest }> {
  return authedFetch<{ request: RecordsQueueRequest }>(`/records/requests/${id}/undo`, { method: 'POST' });
}

// `patient` on the detail endpoint carries email/phone on top of
// RecordsPersonSummary's id/first_name/last_name — mirrors records.rb's
// `request_json(appointment, detailed: true)`.
export interface RecordsPatientDetail extends RecordsPersonSummary {
  email: string;
  phone: string;
}

// Same shape as RecordsQueueRequest, but with the detailed `patient`
// above — this is what `GET /records/requests/:id` returns under `request`,
// never what the queue list returns (which never passes `detailed: true`).
export interface RecordsRequestDetail extends Omit<RecordsQueueRequest, 'patient'> {
  patient: RecordsPatientDetail;
}

// Mirrors records.rb's `patient_stats_for` exactly — these four fields,
// no more.
export interface RecordsPatientStats {
  previous_visits_count: number;
  last_visit_date: string | null;
  no_show_count: number;
  other_pending_count: number;
}

export interface RecordsRequestDetailResponse {
  request: RecordsRequestDetail;
  patient_stats: RecordsPatientStats;
}

// No ownership scoping on the backend — any `records` user can fetch any
// request by id (see records.rb's `GET /records/requests/:id` comment).
export function getRequest(authedFetch: AuthedFetch, id: number): Promise<RecordsRequestDetailResponse> {
  return authedFetch<RecordsRequestDetailResponse>(`/records/requests/${id}`);
}

// `date`/`time` (not `new_date`/`new_time`) per records.rb's
// `POST /records/requests/:id/approve-alternate` — these exact key names
// were settled during this plan's pre-flight review.
export interface ApproveAlternatePayload {
  date: string;
  time: string;
  internal_note?: string;
}

// Approves a pending request onto a different date/time than originally
// requested.
export function approveAlternateRequest(
  authedFetch: AuthedFetch,
  id: number,
  payload: ApproveAlternatePayload,
): Promise<{ request: RecordsQueueRequest }> {
  return authedFetch<{ request: RecordsQueueRequest }>(`/records/requests/${id}/approve-alternate`, {
    method: 'POST',
    body: payload,
  });
}

export interface DeclinePayload {
  decline_reason_code: string;
  decline_message?: string;
  internal_note?: string;
}

// Declines a pending request — the requested slot is released, never
// reassigned.
export function declineRequest(
  authedFetch: AuthedFetch,
  id: number,
  payload: DeclinePayload,
): Promise<{ request: RecordsQueueRequest }> {
  return authedFetch<{ request: RecordsQueueRequest }>(`/records/requests/${id}/decline`, {
    method: 'POST',
    body: payload,
  });
}
