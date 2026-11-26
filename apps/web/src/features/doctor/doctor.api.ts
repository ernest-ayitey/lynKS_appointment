// Thin wrappers around apps/api/app/routes/doctors.rb's endpoints: the
// doctor-only ones ('/doctor/session-settings', '/doctor/availability') plus
// the public, patient-facing lookup endpoints ('/departments', '/doctors',
// '/doctors/:id/availability', '/doctors/:id/slots') a patient needs to
// render a booking calendar. Each takes the caller's `authedFetch` (from
// useAuth()) rather than importing the auth context directly, so these stay
// easy to unit test in isolation.

export interface SessionSettings {
  start_time: string;
  end_time: string;
  slot_length_minutes: number;
  max_patients_per_day: number | null;
  break_start: string | null;
  break_end: string | null;
}

export interface AvailabilityDays {
  days: string[];
}

export interface AvailabilityUpdate {
  set: string[];
  unset: string[];
}

export interface Department {
  id: number;
  name: string;
  doctor_count: number;
}

export interface DoctorDepartment {
  id: number;
  name: string;
}

export interface Doctor {
  id: number;
  first_name: string;
  last_name: string;
  department: DoctorDepartment;
  specialty_title: string;
}

export interface Slots {
  slots: string[];
}

type AuthedFetch = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

export function getSessionSettings(authedFetch: AuthedFetch): Promise<SessionSettings> {
  return authedFetch<SessionSettings>('/doctor/session-settings');
}

export function updateSessionSettings(
  authedFetch: AuthedFetch,
  payload: SessionSettings,
): Promise<SessionSettings> {
  return authedFetch<SessionSettings>('/doctor/session-settings', { method: 'PUT', body: payload });
}

export function getAvailability(authedFetch: AuthedFetch, month: string): Promise<AvailabilityDays> {
  return authedFetch<AvailabilityDays>(`/doctor/availability?month=${encodeURIComponent(month)}`);
}

export function updateAvailability(
  authedFetch: AuthedFetch,
  payload: AvailabilityUpdate,
): Promise<AvailabilityDays> {
  return authedFetch<AvailabilityDays>('/doctor/availability', { method: 'PUT', body: payload });
}

// Public, patient-facing lookups below — none of these take `current_user`
// into account the way the doctor's-own wrappers above do; they're keyed by
// `:id` in the path instead, per GET /doctors/:id/availability and
// GET /doctors/:id/slots in doctors.rb.

export function getDepartments(authedFetch: AuthedFetch): Promise<Department[]> {
  return authedFetch<Department[]>('/departments');
}

// An omitted/empty `departmentId` means "no filter", matching the backend's
// own treatment of a blank `department_id` query param (see doctors.rb's
// `GET /doctors`) rather than a filter that matches nothing.
export function getDoctors(authedFetch: AuthedFetch, departmentId?: number | string): Promise<Doctor[]> {
  const query =
    departmentId === undefined || departmentId === ''
      ? ''
      : `?department_id=${encodeURIComponent(departmentId)}`;
  return authedFetch<Doctor[]>(`/doctors${query}`);
}

export function getPublicAvailability(
  authedFetch: AuthedFetch,
  doctorId: number,
  month: string,
): Promise<AvailabilityDays> {
  return authedFetch<AvailabilityDays>(`/doctors/${doctorId}/availability?month=${encodeURIComponent(month)}`);
}

export function getSlots(authedFetch: AuthedFetch, doctorId: number, date: string): Promise<Slots> {
  return authedFetch<Slots>(`/doctors/${doctorId}/slots?date=${encodeURIComponent(date)}`);
}
