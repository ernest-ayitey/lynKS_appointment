import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ChooseRoleLocationPage } from '../choose-role-location.page';
import * as authApi from '../auth.api';
import { authStorage } from '../../../lib/auth-storage';
import { ApiError } from '../../../lib/api-client';

vi.mock('../auth.api');

function DashboardStub() {
  return <div>Staff dashboard</div>;
}

const defaultOptions: authApi.RoleLocationOption[] = [
  { staffUserLocationId: 'sul-1', roleName: 'Doctor', locationName: 'Osu clinic' },
  { staffUserLocationId: 'sul-2', roleName: 'Clinic admin', locationName: 'Osu clinic' },
];

function renderPickerPage(
  state: { sessionToken?: string; options?: authApi.RoleLocationOption[] } = {
    sessionToken: 'session-3',
    options: defaultOptions,
  },
) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/staff/choose-role-location', state }]}>
      <Routes>
        <Route path="/staff/choose-role-location" element={<ChooseRoleLocationPage />} />
        <Route path="/staff/dashboard" element={<DashboardStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ChooseRoleLocationPage', () => {
  it('renders the role/location options passed from the previous step', () => {
    renderPickerPage();

    expect(screen.getByText('Doctor')).toBeInTheDocument();
    expect(screen.getByText('Clinic admin')).toBeInTheDocument();
    expect(screen.getAllByText('Osu clinic')).toHaveLength(2);
  });

  it('submits the chosen staffUserLocationId and stores the resulting tokens', async () => {
    vi.mocked(authApi.resolveRoleLocation).mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    const setTokensSpy = vi.spyOn(authStorage, 'setTokens');
    const user = userEvent.setup();

    renderPickerPage();

    await user.click(screen.getByRole('radio', { name: /clinic admin/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(authApi.resolveRoleLocation).toHaveBeenCalledWith('session-3', 'sul-2');
    expect(await screen.findByText('Staff dashboard')).toBeInTheDocument();
    expect(setTokensSpy).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('shows an inline error and stores nothing if the response is options instead of tokens', async () => {
    // Supplying a staffUserLocationId can only yield final tokens per
    // the backend's contract, so this is an unexpected response rather
    // than a live code path — it must surface as an error, not write
    // "undefined" tokens into storage (the same guard the staff
    // sign-in and two-step pages apply).
    vi.mocked(authApi.resolveRoleLocation).mockResolvedValue({ options: defaultOptions });
    const setTokensSpy = vi.spyOn(authStorage, 'setTokens');
    const user = userEvent.setup();

    renderPickerPage();

    await user.click(screen.getByRole('radio', { name: /doctor/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(setTokensSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Staff dashboard')).not.toBeInTheDocument();
  });

  it('shows an inline error and does not navigate when resolveRoleLocation rejects', async () => {
    vi.mocked(authApi.resolveRoleLocation).mockRejectedValue(new ApiError(400, 'Invalid selection'));
    const user = userEvent.setup();

    renderPickerPage();

    await user.click(screen.getByRole('radio', { name: /doctor/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Staff dashboard')).not.toBeInTheDocument();
  });
});
