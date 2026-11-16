import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { authStorage } from './auth-storage';

interface RequireAuthProps {
  children: ReactNode;
  /**
   * Where to redirect when there is no stored access token. Defaults to
   * the patient sign-in page — routes under `/staff/*` should pass
   * `/staff/sign-in` so staff are sent to the correct sign-in flow
   * rather than the patient one.
   */
  signInPath?: string;
}

/**
 * Route wrapper that redirects to the appropriate sign-in page when
 * there is no access token stored. This is a UI convenience for
 * routing only — it does not validate the token's signature or
 * expiry, and it is never the security boundary. The server rejects
 * any request with a missing/invalid/expired token regardless of what
 * this component decides to render (see the backend's `JwtAuthGuard`
 * and `PermissionsGuard`, Task 5).
 */
export function RequireAuth({ children, signInPath = '/sign-in' }: RequireAuthProps) {
  const location = useLocation();

  if (!authStorage.getAccessToken()) {
    return <Navigate to={signInPath} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
