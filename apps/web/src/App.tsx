import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/app-shell';
import BookAppointmentPage from './features/appointments/book-appointment.page';
import MyAppointmentsPage from './features/appointments/my-appointments.page';
import ChangePasswordPage from './features/auth/change-password.page';
import ForgotPasswordPage from './features/auth/forgot-password.page';
import LoginPage from './features/auth/login.page';
import RegisterPage from './features/auth/register.page';
import ResetPasswordPage from './features/auth/reset-password.page';
import RoleLandingPage from './features/dashboard/role-landing.page';
import DoctorAppointmentsPage from './features/doctor/doctor-appointments.page';
import DoctorAvailabilityPage from './features/doctor/doctor-availability.page';
import DoctorDashboardPage from './features/doctor/doctor-dashboard.page';
import RecordsQueuePage from './features/records/records-queue.page';
import RequestReviewPage from './features/records/request-review.page';
import { AuthProvider, useAuth } from './lib/auth-context';
import { ErrorBoundary } from './lib/error-boundary';
import { ProtectedRoute } from './lib/protected-route';

const queryClient = new QueryClient();

// The `/` landing route, split out of ProtectedRoute's gate itself (which
// stays role-agnostic) so this redirect only applies once
// ProtectedRoute has already resolved auth/must_change_password -- by the
// time this renders, `user` is guaranteed non-null, same guarantee
// ProtectedRoute's own `allowedRoles` redirect relies on.
//
// Scoped to the doctor role only: a doctor's real dashboard lives at
// `/doctor/dashboard`, and leaving doctors on the generic
// `RoleLandingPage` stub (reachable only via the sidebar's "Dashboard"
// link) meant the app had two different things called "Dashboard" at
// once. Patient and records roles keep rendering `RoleLandingPage`
// unchanged -- their own dashboards don't exist yet.
function RootRoute() {
  const { user } = useAuth();

  if (user?.role === 'doctor') {
    return <Navigate to="/doctor/dashboard" replace />;
  }

  return (
    <AppShell>
      <RoleLandingPage />
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route
                path="/change-password"
                element={
                  <ProtectedRoute>
                    <ChangePasswordPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <RootRoute />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctor/availability"
                element={
                  <ProtectedRoute allowedRoles={['doctor']}>
                    <AppShell activeNavKey="doctor-availability">
                      <DoctorAvailabilityPage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctor/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['doctor']}>
                    <AppShell activeNavKey="doctor-dashboard">
                      <DoctorDashboardPage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctor/appointments"
                element={
                  <ProtectedRoute allowedRoles={['doctor']}>
                    <AppShell activeNavKey="doctor-appointments">
                      <DoctorAppointmentsPage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/book"
                element={
                  <ProtectedRoute allowedRoles={['patient']}>
                    <AppShell activeNavKey="patient-book">
                      <BookAppointmentPage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/appointments"
                element={
                  <ProtectedRoute allowedRoles={['patient']}>
                    <AppShell activeNavKey="patient-appointments">
                      <MyAppointmentsPage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/records/queue"
                element={
                  <ProtectedRoute allowedRoles={['records']}>
                    <AppShell activeNavKey="records-queue">
                      <RecordsQueuePage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/records/requests/:id"
                element={
                  <ProtectedRoute allowedRoles={['records']}>
                    <AppShell activeNavKey="records-queue">
                      <RequestReviewPage />
                    </AppShell>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
