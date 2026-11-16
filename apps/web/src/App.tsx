import { Route, Routes } from 'react-router-dom';

import { EnterCodePage } from './features/auth/enter-code.page';
import { PatientSignInPage } from './features/auth/patient-sign-in.page';

function BookingHomePage() {
  return (
    <main>
      <h1>lynKS Appointment</h1>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<BookingHomePage />} />
      <Route path="/sign-in" element={<PatientSignInPage />} />
      <Route path="/enter-code" element={<EnterCodePage />} />
    </Routes>
  );
}

export default App;
