import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';

export default function RoleLandingPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow">
        <p className="text-slate-900">
          Signed in as {user?.role}: {user?.first_name} {user?.last_name}
        </p>
        {user?.role === 'doctor' && (
          <Link
            to="/doctor/availability"
            className="mt-4 inline-block rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Manage Availability
          </Link>
        )}
        {user?.role === 'patient' && (
          <>
            <Link
              to="/book"
              className="mt-4 inline-block rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Book an Appointment
            </Link>
            <Link
              to="/appointments"
              className="mt-4 inline-block rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              My Appointments
            </Link>
          </>
        )}
        {user?.role === 'records' && (
          <Link
            to="/records/queue"
            className="mt-4 inline-block rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Review Requests
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
