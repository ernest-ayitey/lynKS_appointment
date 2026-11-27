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
  await user.type(screen.getByLabelText(/confirm new password/i), password);
  await user.click(screen.getByRole('button', { name: /save and sign in/i }));
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

  it('renders the overall message as a banner alongside a field error, keeping the form', async () => {
    resetPassword.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        password_confirmation: "Passwords don't match",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByText('Please correct the highlighted fields')).toBeInTheDocument();
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    // A field error means retyping can help, so the form stays and the
    // "request a new link" escape hatch is not offered.
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /request a new link/i })).not.toBeInTheDocument();
  });

  it('renders a generic banner and keeps the form when the request fails with something other than an ApiError', async () => {
    resetPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    // The link may well still be valid — a network failure must not send the
    // user off to request a new one.
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /request a new link/i })).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
