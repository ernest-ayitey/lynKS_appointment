import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export type NavKey =
  | 'patient-dashboard'
  | 'patient-book'
  | 'patient-appointments'
  | 'patient-profile'
  | 'doctor-dashboard'
  | 'doctor-availability'
  | 'doctor-appointments'
  | 'doctor-profile'
  | 'records-queue'
  | 'records-all-appointments'
  | 'records-doctors-calendars'
  | 'records-patients'
  | 'records-reports';

interface NavItem {
  key: NavKey;
  label: string;
  href: string | null;
}

export const NAV_ITEMS: Record<'patient' | 'doctor' | 'records', NavItem[]> = {
  patient: [
    { key: 'patient-dashboard', label: 'Dashboard', href: null },
    { key: 'patient-book', label: 'Book appointment', href: '/book' },
    { key: 'patient-appointments', label: 'My appointments', href: '/appointments' },
    { key: 'patient-profile', label: 'Profile', href: null },
  ],
  doctor: [
    { key: 'doctor-dashboard', label: 'Dashboard', href: null },
    { key: 'doctor-availability', label: 'My availability', href: '/doctor/availability' },
    { key: 'doctor-appointments', label: 'Appointments', href: '/doctor/appointments' },
    { key: 'doctor-profile', label: 'Profile', href: null },
  ],
  records: [
    { key: 'records-queue', label: 'Approval queue', href: '/records/queue' },
    { key: 'records-all-appointments', label: 'All appointments', href: null },
    { key: 'records-doctors-calendars', label: "Doctors' calendars", href: null },
    { key: 'records-patients', label: 'Patients', href: null },
    { key: 'records-reports', label: 'Reports', href: null },
  ],
};

export interface AppShellProps {
  // Optional: `RoleLandingPage` ('/') doesn't correspond to any single
  // sidebar entry for every role (Records' own nav has no "Dashboard"
  // item at all), so it's the one route that passes no activeNavKey —
  // nothing highlights, which is correct, not a bug.
  activeNavKey?: NavKey;
  children: ReactNode;
}

export default function AppShell({ activeNavKey, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const items: NavItem[] = user && user.role in NAV_ITEMS ? NAV_ITEMS[user.role as keyof typeof NAV_ITEMS] : [];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 bg-white px-6 py-2">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg border-2 border-dashed border-slate-400" aria-hidden="true" />
          <strong>[Clinic Name] Appointments</strong>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-slate-300" aria-hidden="true" />
          <div className="flex flex-col text-sm">
            <strong>
              {user?.first_name} {user?.last_name}
            </strong>
            <span className="text-slate-500">{user?.role}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-wrap gap-6 p-6">
        <nav aria-label="Main menu" className="flex max-w-[240px] flex-1 flex-col gap-1">
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.key}
                to={item.href}
                aria-current={activeNavKey === item.key ? 'page' : undefined}
                className={
                  activeNavKey === item.key
                    ? 'rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white'
                    : 'rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100'
                }
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.key}
                aria-disabled="true"
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-400"
              >
                {item.label}
              </span>
            ),
          )}
        </nav>
        <main className="min-w-0 flex-[999_1_560px]">{children}</main>
      </div>
    </div>
  );
}
