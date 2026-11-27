import { useAuth } from '../../lib/auth-context';

export default function RoleLandingPage() {
  const { user } = useAuth();

  return (
    <div className="rounded-lg bg-white p-8 shadow">
      <p className="text-slate-900">
        Signed in as {user?.role}: {user?.first_name} {user?.last_name}
      </p>
    </div>
  );
}
