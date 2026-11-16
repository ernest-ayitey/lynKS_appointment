import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { StaffSignInPage } from '../staff-sign-in.page';
import * as authApi from '../auth.api';
import { authStorage } from '../../../lib/auth-storage';

vi.mock('../auth.api');

interface TwoStepStubLocationState {
  sessionToken?: string;
}

function TwoStepStub() {
  const location = useLocation();
  const state = location.state as TwoStepStubLocationState | null;
  return <div>Two-step screen — sessionToken: {state?.sessionToken ?? '(none)'}</div>;
}

function DashboardStub() {
  return <div>Staff dashboard</div>;
}

function renderSignInPage() {
  return render(
    <MemoryRouter initialEntries={['/staff/sign-in']}>
      <Routes>
        <Route path="/staff/sign-in" element={<StaffSignInPage />} />
        <Route path="/staff/two-step" element={<TwoStepStub />} />
        <Route path="/staff/dashboard" element={<DashboardStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StaffSignInPage', () => {
  it('navigates straight to the dashboard when login returns final tokens (single role/location, no 2-step)', async () => {
    vi.mocked(authApi.staffLogin).mockResolvedValue({
      sessionToken: 'session-1',
      requiresTwoStep: false,
    });
    vi.mocked(authApi.resolveRoleLocation).mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    const setTokensSpy = vi.spyOn(authStorage, 'setTokens');
    const user = userEvent.setup();

    renderSignInPage();

    await user.type(screen.getByLabelText(/work email/i), 'k.asante@clinic.com');
    await user.type(screen.getByLabelText(/password/i), 'correct-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Staff dashboard')).toBeInTheDocument();
    expect(authApi.resolveRoleLocation).toHaveBeenCalledWith('session-1');
    expect(setTokensSpy).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(screen.queryByText(/Two-step screen/)).not.toBeInTheDocument();
  });

  it('navigates to the 2-step screen when requiresTwoStep is true', async () => {
    vi.mocked(authApi.staffLogin).mockResolvedValue({
      sessionToken: 'session-2',
      requiresTwoStep: true,
    });
    const user = userEvent.setup();

    renderSignInPage();

    await user.type(screen.getByLabelText(/work email/i), 'k.asante@clinic.com');
    await user.type(screen.getByLabelText(/password/i), 'correct-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Two-step screen — sessionToken: session-2'),
    ).toBeInTheDocument();
    expect(authApi.resolveRoleLocation).not.toHaveBeenCalled();
  });

  it('shows an inline error and does not navigate when staffLogin fails', async () => {
    const { ApiError } = await import('../../../lib/api-client');
    vi.mocked(authApi.staffLogin).mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    const user = userEvent.setup();

    renderSignInPage();

    await user.type(screen.getByLabelText(/work email/i), 'k.asante@clinic.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Staff dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText(/Two-step screen/)).not.toBeInTheDocument();
  });
});
