import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: string[];
}) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return null;
  }

  // Fail closed. `status === 'authenticated'` with a null user is unreachable
  // today by construction (applySession and the boot path always set user and
  // status together), but this component is the gate every protected page in
  // the app wraps in: an ambiguous state must redirect, never render the
  // authenticated app. Without this, `user?.must_change_password` would
  // optional-chain to undefined and fall through to children.
  if (status === 'unauthenticated' || user === null) {
    return <Navigate to="/login" replace />;
  }

  // Advisory only — NOT a security boundary. This redirect is enforced
  // entirely client-side: the backend's authenticate! (apps/api/app/routes/
  // auth.rb) never checks must_change_password on any route. It stops an
  // honest client from accidentally skipping the forced-change screen, but a
  // user who edits must_change_password in their own browser's sessionStorage
  // ('auth:user') can bypass it and still use their valid access token
  // against the API. Closing that needs server-side enforcement, which is a
  // backend change outside this frontend plan's scope.
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // No dedicated "403" page exists yet, so a role-restricted page the
  // user's role isn't allowed on just redirects home rather than showing
  // one. A future plan can add a real forbidden page without changing
  // this component's contract.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
