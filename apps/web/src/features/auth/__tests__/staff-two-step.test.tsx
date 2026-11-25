import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { StaffTwoStepPage } from '../staff-two-step.page';
import * as authApi from '../auth.api';
import { authStorage } from '../../../lib/auth-storage';

vi.mock('../auth.api');

interface PickerStubLocationState {
  sessionToken?: string;
  options?: authApi.RoleLocationOption[];
}

function PickerStub() {
  const location = useLocation();
  const state = location.state as PickerStubLocationState | null;
  return (
    <div>
      Role/location picker — sessionToken: {state?.sessionToken ?? '(none)'}, options:{' '}
      {state?.options?.length ?? 0}
    </div>
  );
}

function DashboardStub() {
  return <div>Staff dashboard</div>;
}

function renderTwoStepPage(
  state: { sessionToken?: string; email?: string } = {
    sessionToken: 'session-2',
    email: 'k.asante@clinic.com',
  },
) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/staff/two-step', state }]}>
      <Routes>
        <Route path="/staff/two-step" element={<StaffTwoStepPage />} />
        <Route path="/staff/choose-role-location" element={<PickerStub />} />
        <Route path="/staff/dashboard" element={<DashboardStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StaffTwoStepPage', () => {
  it('navigates to the role/location picker when two-step verify returns an options list', async () => {
    vi.mocked(authApi.requestStaffTwoStep).mockResolvedValue({ requestId: 'req-2fa-1' });
    vi.mocked(authApi.verifyStaffTwoStep).mockResolvedValue({ sessionToken: 'session-3' });
    vi.mocked(authApi.resolveRoleLocation).mockResolvedValue({
      options: [
        { staffUserLocationId: 'sul-1', roleName: 'Doctor', locationName: 'Osu clinic' },
        { staffUserLocationId: 'sul-2', roleName: 'Clinic admin', locationName: 'Osu clinic' },
      ],
    });
    const user = userEvent.setup();

    renderTwoStepPage();

    expect(await screen.findByLabelText(/code/i)).toBeInTheDocument();
    expect(authApi.requestStaffTwoStep).toHaveBeenCalledWith('session-2');

    await user.type(screen.getByLabelText(/code/i), '702000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(authApi.verifyStaffTwoStep).toHaveBeenCalledWith('session-2', 'req-2fa-1', '702000');
    expect(authApi.resolveRoleLocation).toHaveBeenCalledWith('session-3');
    expect(
      await screen.findByText('Role/location picker — sessionToken: session-3, options: 2'),
    ).toBeInTheDocument();
  });

  it('navigates straight to the dashboard when two-step verify leads to a single resolved role/location', async () => {
    vi.mocked(authApi.requestStaffTwoStep).mockResolvedValue({ requestId: 'req-2fa-2' });
    vi.mocked(authApi.verifyStaffTwoStep).mockResolvedValue({ sessionToken: 'session-4' });
    vi.mocked(authApi.resolveRoleLocation).mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    const setTokensSpy = vi.spyOn(authStorage, 'setTokens');
    const user = userEvent.setup();

    renderTwoStepPage();

    await screen.findByLabelText(/code/i);
    await user.type(screen.getByLabelText(/code/i), '702000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByText('Staff dashboard')).toBeInTheDocument();
    expect(setTokensSpy).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('shows an inline error and does not navigate when verifyStaffTwoStep rejects', async () => {
    const { ApiError } = await import('../../../lib/api-client');
    vi.mocked(authApi.requestStaffTwoStep).mockResolvedValue({ requestId: 'req-2fa-3' });
    vi.mocked(authApi.verifyStaffTwoStep).mockRejectedValue(new ApiError(401, 'Invalid code'));
    const user = userEvent.setup();

    renderTwoStepPage();

    await screen.findByLabelText(/code/i);
    await user.type(screen.getByLabelText(/code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Role\/location picker/)).not.toBeInTheDocument();
    expect(screen.queryByText('Staff dashboard')).not.toBeInTheDocument();
  });
});
