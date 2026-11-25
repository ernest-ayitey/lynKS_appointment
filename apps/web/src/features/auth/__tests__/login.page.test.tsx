import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import LoginPage from '../login.page';

const login = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ login }),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('submits username and password with rememberMe false by default', async () => {
    login.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.type(screen.getByLabelText(/password/i), 'Sup3r!word');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(login).toHaveBeenCalledWith('ernesta', 'Sup3r!word', false);
  });

  it('submits rememberMe true when "Keep me signed in" is checked', async () => {
    login.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.type(screen.getByLabelText(/password/i), 'Sup3r!word');
    await user.click(screen.getByLabelText(/keep me signed in/i));
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(login).toHaveBeenCalledWith('ernesta', 'Sup3r!word', true);
  });

  it('renders the backend error message when login rejects with 401', async () => {
    login.mockRejectedValueOnce(new ApiError('Incorrect username or password', 401));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Incorrect username or password')).toBeInTheDocument();
  });

  it('renders the backend error message verbatim when login rejects with 423', async () => {
    login.mockRejectedValueOnce(new ApiError("This account can't sign in right now", 423));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.type(screen.getByLabelText(/password/i), 'Sup3r!word');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText("This account can't sign in right now")).toBeInTheDocument();
  });

  it('renders a generic banner when the request fails with something other than an ApiError', async () => {
    // fetch rejecting (backend unreachable, offline) used to rethrow out of
    // the submit handler, leaving the user with no feedback at all.
    login.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/username/i), 'ernesta');
    await user.type(screen.getByLabelText(/password/i), 'Sup3r!word');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});
