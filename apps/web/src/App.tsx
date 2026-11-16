import { Route, Routes } from 'react-router-dom';

import { ChooseRoleLocationPage } from './features/auth/choose-role-location.page';
import { EnterCodePage } from './features/auth/enter-code.page';
import { PatientSignInPage } from './features/auth/patient-sign-in.page';
import { StaffSignInPage } from './features/auth/staff-sign-in.page';
import { StaffTwoStepPage } from './features/auth/staff-two-step.page';

function BookingHomePage() {
  return (
    <main>
      <h1>lynKS Appointment</h1>
    </main>
  );
}

function StaffDashboardPage() {
  return (
    <main>
      <h1>Staff dashboard</h1>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<BookingHomePage />} />
      <Route path="/sign-in" element={<PatientSignInPage />} />
      <Route path="/enter-code" element={<EnterCodePage />} />
      <Route path="/staff/sign-in" element={<StaffSignInPage />} />
      <Route path="/staff/two-step" element={<StaffTwoStepPage />} />
      <Route path="/staff/choose-role-location" element={<ChooseRoleLocationPage />} />
      <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
    </Routes>
  );
}

export default App;
