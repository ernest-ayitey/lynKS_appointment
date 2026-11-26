import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ChangePasswordPage from './features/auth/change-password.page';
import ForgotPasswordPage from './features/auth/forgot-password.page';
import LoginPage from './features/auth/login.page';
import RegisterPage from './features/auth/register.page';
import ResetPasswordPage from './features/auth/reset-password.page';
import RoleLandingPage from './features/dashboard/role-landing.page';
import DoctorAvailabilityPage from './features/doctor/doctor-availability.page';
import { AuthProvider } from './lib/auth-context';
import { ErrorBoundary } from './lib/error-boundary';
import { ProtectedRoute } from './lib/protected-route';

const queryClient = new QueryClient();

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
                    <RoleLandingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctor/availability"
                element={
                  <ProtectedRoute allowedRoles={['doctor']}>
                    <DoctorAvailabilityPage />
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
