import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { PatientSignInPage } from '../patient-sign-in.page';
import * as authApi from '../auth.api';

vi.mock('../auth.api');

interface EnterCodeStubLocationState {
  requestId?: string;
}

function EnterCodeStub() {
  const location = useLocation();
  const state = location.state as EnterCodeStubLocationState | null;
  return <div>Enter code screen — requestId: {state?.requestId ?? '(none)'}</div>;
}

function renderSignInPage() {
  return render(
    <MemoryRouter initialEntries={['/sign-in']}>
      <Routes>
        <Route path="/sign-in" element={<PatientSignInPage />} />
        <Route path="/enter-code" element={<EnterCodeStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PatientSignInPage', () => {
  it('submits the phone number and navigates to enter-code with the returned requestId', async () => {
    const requestOtpMock = vi.mocked(authApi.requestOtp).mockResolvedValue({
      requestId: 'req-123',
      expiresInSeconds: 300,
    });
    const user = userEvent.setup();

    renderSignInPage();

    await user.type(screen.getByLabelText(/mobile number/i), '5551234567');
    await user.click(screen.getByRole('button', { name: /text me a code/i }));

    expect(requestOtpMock).toHaveBeenCalledWith('5551234567');
    expect(
      await screen.findByText('Enter code screen — requestId: req-123'),
    ).toBeInTheDocument();
  });

  it('shows an inline error and does not navigate when requestOtp fails', async () => {
    const { ApiError } = await import('../../../lib/api-client');
    vi.mocked(authApi.requestOtp).mockRejectedValue(new ApiError(500, 'Server error'));
    const user = userEvent.setup();

    renderSignInPage();

    await user.type(screen.getByLabelText(/mobile number/i), '5551234567');
    await user.click(screen.getByRole('button', { name: /text me a code/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Enter code screen/)).not.toBeInTheDocument();
  });
});
