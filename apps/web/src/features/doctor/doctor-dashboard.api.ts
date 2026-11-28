// Thin wrapper around the doctor dashboard endpoints added to
// apps/api/app/routes/appointments.rb ('GET /doctor/dashboard/stats',
// 'GET /doctor/dashboard/emails'). Takes the caller's `authedFetch` (from
// useAuth()) rather than importing the auth context directly, matching
// ../doctor-appointments.api.ts's and ../doctor.api.ts's convention. Field
// names mirror the live `json(...)` response in `get '/doctor/dashboard/stats'`
// and `doctor_dashboard_email_json` in appointments.rb exactly, not just
// this plan's prose.

export interface DashboardStats {
  patients_today: number;
  this_week: number;
  pending: number;
  available_days_this_month: number;
}

export interface RecentEmail {
  recipient_email: string;
  subject: string;
  sent_at: string;
  ref: string;
}

export interface RecentEmailList {
  emails: RecentEmail[];
}

type AuthedFetch = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

export function getDashboardStats(authedFetch: AuthedFetch): Promise<DashboardStats> {
  return authedFetch<DashboardStats>('/doctor/dashboard/stats');
}

export function getRecentEmails(authedFetch: AuthedFetch): Promise<RecentEmailList> {
  return authedFetch<RecentEmailList>('/doctor/dashboard/emails');
}
