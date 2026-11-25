import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import ResetPasswordPage from '../reset-password.page';

const resetPassword = vi.fn();
const navigate = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ resetPassword }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function renderPage(token = 'abc123') {
  render(
    <MemoryRouter initialEntries={[`/reset-password/${token}`]}>
      <Routes>
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = 'Sup3r!word') {
  await user.type(screen.getByLabelText(/^new password$/i), password);
  await user.type(screen.getByLabelText(/confirm password/i), password);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ResetPasswordPage', () => {
  it('reads the token from the URL and submits it with the password payload', async () => {
    resetPassword.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage('the-token-from-the-url');

    await fillAndSubmit(user, 'Sup3r!word');

    expect(resetPassword).toHaveBeenCalledWith('the-token-from-the-url', {
      password: 'Sup3r!word',
      password_confirmation: 'Sup3r!word',
    });
  });

  it('navigates to / on success', async () => {
    resetPassword.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('renders field errors from a 422 with errors', async () => {
    resetPassword.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        password_confirmation: "Passwords don't match",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the message as a banner with a link back to forgot-password on a 422 with no errors', async () => {
    resetPassword.mockRejectedValueOnce(new ApiError('This link is invalid or has expired', 422));
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText('This link is invalid or has expired')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /request a new link/i });
    expect(link).toHaveAttribute('href', '/forgot-password');
    expect(navigate).not.toHaveBeenCalled();
  });
});
