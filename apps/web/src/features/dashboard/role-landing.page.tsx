import { useAuth } from '../../lib/auth-context';

export default function RoleLandingPage() {
  const { user } = useAuth();

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-8">
      <p className="text-slate-900">
        Signed in as {user?.role}: {user?.first_name} {user?.last_name}
      </p>
    </div>
  );
}
