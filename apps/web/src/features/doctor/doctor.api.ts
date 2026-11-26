// Thin wrappers around the doctor-only endpoints in apps/api/app/routes/doctors.rb
// ('/doctor/session-settings', '/doctor/availability'). Each takes the
// caller's `authedFetch` (from useAuth()) rather than importing the auth
// context directly, so these stay easy to unit test in isolation.

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
