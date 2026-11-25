import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import RegisterPage from '../register.page';

const register = vi.fn();
const checkUsernameAvailability = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ register }),
}));

vi.mock('../auth.api', () => ({
  checkUsernameAvailability: (...args: unknown[]) => checkUsernameAvailability(...args),
}));

function renderPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, username = 'ernesta') {
  await user.type(screen.getByLabelText(/first name/i), 'Ernest');
  await user.type(screen.getByLabelText(/last name/i), 'Ayitey');
  await user.type(screen.getByLabelText(/date of birth/i), '1990-05-15');
  await user.selectOptions(screen.getByLabelText(/gender/i), 'female');
  await user.type(screen.getByLabelText(/email/i), 'ernesta@example.com');
  await user.type(screen.getByLabelText(/phone/i), '0241234567');
  await user.type(screen.getByLabelText(/^username/i), username);
  await user.type(screen.getByLabelText(/^password/i), 'Sup3r!word');
  await user.type(screen.getByLabelText(/confirm password/i), 'Sup3r!word');
  await user.click(screen.getByLabelText(/accept the terms/i));
}

describe('RegisterPage', () => {
  it('submits the exact snake_case payload the backend expects', async () => {
    checkUsernameAvailability.mockResolvedValue(true);
    register.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(register).toHaveBeenCalledWith({
      first_name: 'Ernest',
      last_name: 'Ayitey',
      date_of_birth: '1990-05-15',
      gender: 'female',
      email: 'ernesta@example.com',
      phone: '0241234567',
      username: 'ernesta',
      password: 'Sup3r!word',
      password_confirmation: 'Sup3r!word',
      accept_terms: true,
    });
  });

  it('checks username availability after debounce and renders the resolved hint', async () => {
    checkUsernameAvailability.mockResolvedValue(true);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^username/i), 'ernesta');

    expect(await screen.findByText(/username is available/i)).toBeInTheDocument();
    expect(checkUsernameAvailability).toHaveBeenCalledWith('ernesta');
  });

  it('renders "taken" when the availability check resolves false', async () => {
    checkUsernameAvailability.mockResolvedValue(false);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^username/i), 'ernesta');

    expect(await screen.findByText(/username is taken/i)).toBeInTheDocument();
  });

  it('shows the submit-time 422 field error even though the live check said "available"', async () => {
    checkUsernameAvailability.mockResolvedValue(true);
    register.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        username: 'Username is already taken',
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillRequiredFields(user, 'ernesta');

    // The live check resolves "available" before submission.
    expect(await screen.findByText(/username is available/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create account/i }));

    // The submit-time 422 error must win over the stale "available" hint.
    expect(await screen.findByText('Username is already taken')).toBeInTheDocument();
    expect(screen.queryByText(/username is available/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Please correct the highlighted fields')).toBeInTheDocument();
  });

  it('attaches a 422 field error to the right input when its name diverges from the backend key', async () => {
    checkUsernameAvailability.mockResolvedValue(true);
    register.mockRejectedValueOnce(
      new ApiError('Please correct the highlighted fields', 422, {
        password_confirmation: "Passwords don't match",
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
  });
});
