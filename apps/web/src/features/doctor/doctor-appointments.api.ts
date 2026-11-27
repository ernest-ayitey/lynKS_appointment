// Thin wrapper around the doctor-facing appointment endpoints in
// apps/api/app/routes/appointments.rb ('/doctor/appointments',
// 'PATCH /appointments/:id'). Takes the caller's `authedFetch` (from
// useAuth()) rather than importing the auth context directly, matching
// ../appointments/appointments.api.ts's and ../records/records.api.ts's
// convention. Field names mirror the live `doctor_appointment_json` in
// appointments.rb exactly, not just this plan's prose.

export interface DoctorAppointmentPatient {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  sex: string | null;
  age: number | null;
}

export interface DoctorAppointment {
  id: number;
  ref: string;
  patient: DoctorAppointmentPatient;
  date: string;
  time: string;
  duration_minutes: number;
  visit_type: string;
  reason: string;
  status: string;
  approved_by: { id: number; first_name: string; last_name: string } | null;
  visit_notes: string | null;
}

export interface DoctorAppointmentFilters {
  search?: string;
  from?: string;
  to?: string;
}

export interface DoctorAppointmentList {
  appointments: DoctorAppointment[];
  total: number;
}

type AuthedFetch = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

// An absent/empty filter contributes no query param at all, matching
// appointments.rb's `GET /doctor/appointments`'s own lenient treatment of a
// missing `search`/`from`/`to` (see filter_by_patient_name/filter_by_date_range)
// rather than a filter that matches zero rows.
export function listDoctorAppointments(
  authedFetch: AuthedFetch,
  filters?: DoctorAppointmentFilters,
): Promise<DoctorAppointmentList> {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);

  const query = params.toString();
  return authedFetch<DoctorAppointmentList>(`/doctor/appointments${query ? `?${query}` : ''}`);
}

// `{ status, visit_notes? }` per appointments.rb's `PATCH /appointments/:id`
// — `status` must be 'completed' or 'no_show' (PATCHABLE_STATUSES); the
// backend only accepts this on an `approved` appointment.
export function markAppointmentOutcome(
  authedFetch: AuthedFetch,
  id: number,
  payload: { status: 'completed' | 'no_show'; visit_notes?: string },
): Promise<DoctorAppointment> {
  return authedFetch<DoctorAppointment>(`/appointments/${id}`, { method: 'PATCH', body: payload });
}
