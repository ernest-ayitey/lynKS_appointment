import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '../forgot-password.page';

const forgotPassword = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ forgotPassword }),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

describe('ForgotPasswordPage', () => {
  it('submits the username and renders the backend message when the account is found', async () => {
    forgotPassword.mockResolvedValueOnce({
      message: 'If an account exists for that username, a reset link has been sent.',
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(forgotPassword).toHaveBeenCalledWith('ernesta');
    expect(
      await screen.findByText('If an account exists for that username, a reset link has been sent.'),
    ).toBeInTheDocument();
  });

  it('renders the exact same generic message when the account is not found', async () => {
    forgotPassword.mockResolvedValueOnce({
      message: 'If an account exists for that username, a reset link has been sent.',
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'no-such-user');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    // There is no "found" vs "not found" distinction to render — the backend's
    // own message is shown verbatim either way.
    expect(
      await screen.findByText('If an account exists for that username, a reset link has been sent.'),
    ).toBeInTheDocument();
  });

  it('replaces the form with the success message', async () => {
    forgotPassword.mockResolvedValueOnce({ message: 'Check your messages for a reset link.' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText('Check your messages for a reset link.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });
});
