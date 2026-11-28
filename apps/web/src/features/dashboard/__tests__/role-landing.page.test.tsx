import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RoleLandingPage from '../role-landing.page';

const useAuth = vi.fn();
const logout = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => useAuth(),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <RoleLandingPage />
    </MemoryRouter>,
  );
}

describe('RoleLandingPage', () => {
  it('renders the signed-in-as message for the current user', () => {
    useAuth.mockReturnValue({
      user: { role: 'patient', first_name: 'John', last_name: 'Doe' },
      logout,
    });

    renderPage();

    expect(screen.getByText(/signed in as patient: John Doe/i)).toBeInTheDocument();
  });
});
