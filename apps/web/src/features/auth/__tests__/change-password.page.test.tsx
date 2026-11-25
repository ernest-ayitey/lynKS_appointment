import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import ChangePasswordPage from '../change-password.page';

const changePassword = vi.fn();
const navigate = vi.fn();
const useAuth = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => useAuth(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function mockUser(mustChangePassword: boolean) {
  useAuth.mockReturnValue({
    changePassword,
    user: {
      id: 1,
      username: 'jdoe',
      role: 'patient',
      first_name: 'Jane',
      last_name: 'Doe',
      must_change_password: mustChangePassword,
    },
  });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/change-password']}>
      <ChangePasswordPage />
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = 'Sup3r!word') {
  await user.type(screen.getByLabelText(/current password/i), 'OldPassw0rd!');
  await user.type(screen.getByLabelText(/^new password$/i), password);
  await user.type(screen.getByLabelText(/confirm password/i), password);
  await user.click(screen.getByRole('button', { name: /change password/i }));
}

describe('ChangePasswordPage', () => {
  it('shows a forced-change banner when must_change_password is true', () => {
    mockUser(true);
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(/must change your password before continuing/i);
  });

  it('shows no forced-change banner when must_change_password is false', () => {
    mockUser(false);
    renderPage();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('submits the current, new, and confirmation password to changePassword', async () => {
    mockUser(false);
    changePassword.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user, 'Sup3r!word');

    expect(changePassword).toHaveBeenCalledWith({
      current_password: 'OldPassw0rd!',
      password: 'Sup3r!word',
      password_confirmation: 'Sup3r!word',
    });
  });

  it('navigates to / on success', async () => {
    mockUser(false);
    changePassword.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('renders a 422 field error next to the current-password field', async () => {
    mockUser(false);
    changePassword.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        current_password: 'Incorrect current password',
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText('Incorrect current password')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders a banner for an ApiError with no field-level errors', async () => {
    mockUser(false);
    // A 401/403/500 carries only a message — there is no input to attach it
    // to, and it used to be swallowed entirely.
    changePassword.mockRejectedValueOnce(new ApiError('Session expired, please sign in again', 401));
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText('Session expired, please sign in again')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the overall message as a banner alongside a field error', async () => {
    mockUser(false);
    changePassword.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        current_password: 'Incorrect current password',
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText('Please correct the highlighted fields')).toBeInTheDocument();
    expect(screen.getByText('Incorrect current password')).toBeInTheDocument();
  });

  it('renders a generic banner when the request fails with something other than an ApiError', async () => {
    mockUser(false);
    changePassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
