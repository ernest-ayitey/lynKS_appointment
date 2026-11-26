// Thin wrapper around the patient-facing appointment endpoints in
// apps/api/app/routes/appointments.rb ('/appointments'). Takes the caller's
// `authedFetch` (from useAuth()) rather than importing the auth context
// directly, matching ../doctor/doctor.api.ts's convention.

export interface AppointmentDoctor {
  id: number;
  first_name: string;
  last_name: string;
}

export interface AppointmentDepartment {
  id: number;
  name: string;
}

export interface Appointment {
  id: number;
  doctor: AppointmentDoctor;
  department: AppointmentDepartment;
  date: string;
  time: string;
  duration_minutes: number;
  visit_type: string;
  reason: string;
  status: string;
  submitted_at: string;
}

export interface BookAppointmentPayload {
  doctor_id: number;
  date: string;
  time: string;
  visit_type: string;
  reason: string;
  sms_reminder_opt_in: boolean;
}

// Mirrors GET /appointments's four optional query params in
// appointments.rb. `status` may be a single value or, per Task 3's
// `filter_by_status`, a comma-separated list (e.g. 'declined,cancelled') —
// it is passed through as one string either way, not an array, so callers
// own the joining.
export interface AppointmentFilters {
  status?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface AppointmentList {
  appointments: Appointment[];
  total: number;
}

type AuthedFetch = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

export function bookAppointment(authedFetch: AuthedFetch, payload: BookAppointmentPayload): Promise<Appointment> {
  return authedFetch<Appointment>('/appointments', { method: 'POST', body: payload });
}

// An absent/empty filter contributes no query param at all, matching the
// backend's own lenient treatment of missing `status`/`search`/`from`/`to`
// (see filter_by_status etc. in appointments.rb) rather than a filter that
// matches zero rows. `URLSearchParams` percent-encodes the comma in a
// multi-status value (e.g. 'declined,cancelled' -> 'declined%2Ccancelled'),
// which the backend's `split(',')` on the decoded param value still parses
// correctly.
export function listAppointments(authedFetch: AuthedFetch, filters?: AppointmentFilters): Promise<AppointmentList> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);

  const query = params.toString();
  return authedFetch<AppointmentList>(`/appointments${query ? `?${query}` : ''}`);
}

export function cancelAppointment(authedFetch: AuthedFetch, id: number): Promise<Appointment> {
  return authedFetch<Appointment>(`/appointments/${id}/cancel`, { method: 'POST' });
}
