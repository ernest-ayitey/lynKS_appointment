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

type AuthedFetch = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

export function bookAppointment(authedFetch: AuthedFetch, payload: BookAppointmentPayload): Promise<Appointment> {
  return authedFetch<Appointment>('/appointments', { method: 'POST', body: payload });
}
