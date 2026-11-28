import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthCard from '../auth-card';

describe('AuthCard', () => {
  it('renders a logo/clinic-name header when no stepLabel is given', () => {
    render(
      <AuthCard title="Sign in">
        <div>card body</div>
      </AuthCard>,
    );

    expect(screen.getByText('[Clinic Name]')).toBeInTheDocument();
  });

  it('renders the stepLabel instead of a logo header when stepLabel is given', () => {
    render(
      <AuthCard title="Reset your password" stepLabel="STEP 1 OF 2">
        <div>card body</div>
      </AuthCard>,
    );

    expect(screen.getByText('STEP 1 OF 2')).toBeInTheDocument();
    expect(screen.queryByText('[Clinic Name]')).not.toBeInTheDocument();
  });

  it('renders title, subtitle, and children inside the card', () => {
    render(
      <AuthCard title="Sign in" subtitle="Patients, doctors, records and admin staff all sign in here.">
        <div>card body</div>
      </AuthCard>,
    );

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(
      screen.getByText('Patients, doctors, records and admin staff all sign in here.'),
    ).toBeInTheDocument();
    expect(screen.getByText('card body')).toBeInTheDocument();
  });
});
