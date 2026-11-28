import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AuthSplitLayout from '../auth-split-layout';

describe('AuthSplitLayout', () => {
  it('renders the branding panel copy and the children in the form panel', () => {
    render(
      <AuthSplitLayout>
        <div>form panel content</div>
      </AuthSplitLayout>,
    );

    expect(screen.getByText('[Clinic Name]')).toBeInTheDocument();
    expect(screen.getByText('[Illustration / clinic photo]')).toBeInTheDocument();
    expect(
      screen.getByText('Book and manage clinic appointments in one place.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Patients request a visit on a doctor's available day. Our Records team confirms it and you both get an email.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Need help? Call [CLINIC PHONE]')).toBeInTheDocument();

    expect(screen.getByText('form panel content')).toBeInTheDocument();
  });
});
