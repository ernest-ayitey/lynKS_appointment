import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

const useAuth = vi.fn();

vi.mock('./lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => useAuth(),
}));

describe('App', () => {
  it('renders the login page at the default route when unauthenticated', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', user: null });

    render(<App />);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });
});
