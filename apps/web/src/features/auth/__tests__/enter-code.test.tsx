import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { EnterCodePage } from '../enter-code.page';
import * as authApi from '../auth.api';
import { authStorage } from '../../../lib/auth-storage';
import { ApiError } from '../../../lib/api-client';

vi.mock('../auth.api');

function renderEnterCodePage(
  state: { requestId?: string; phone?: string } = {
    requestId: 'req-123',
    phone: '555-1234',
  },
) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/enter-code', state }]}>
      <Routes>
        <Route path="/enter-code" element={<EnterCodePage />} />
        <Route path="/" element={<div>Booking home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EnterCodePage', () => {
  it('shows an inline error and does not navigate when verifyOtp rejects with 401', async () => {
    vi.mocked(authApi.verifyOtp).mockRejectedValue(new ApiError(401, 'Invalid or expired OTP'));
    const user = userEvent.setup();

    renderEnterCodePage();

    await user.type(screen.getByLabelText(/code/i), '419000');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Booking home')).not.toBeInTheDocument();
  });

  it('stores tokens and navigates to the booking home on successful verifyOtp', async () => {
    vi.mocked(authApi.verifyOtp).mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accountId: 'account-1',
    });
    const setTokensSpy = vi.spyOn(authStorage, 'setTokens');
    const user = userEvent.setup();

    renderEnterCodePage();

    await user.type(screen.getByLabelText(/code/i), '419000');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Booking home')).toBeInTheDocument();
    expect(setTokensSpy).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });
});
