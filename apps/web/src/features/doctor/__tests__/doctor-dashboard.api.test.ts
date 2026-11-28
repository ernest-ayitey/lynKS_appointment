import { describe, expect, it, vi } from 'vitest';
import { getDashboardStats, getRecentEmails } from '../doctor-dashboard.api';

// Thin, mechanical tests for the doctor-dashboard.api.ts wrappers, matching
// doctor-appointments/__tests__/doctor-appointments.api.test.ts's style:
// confirm the exact path/method sent to authedFetch and that the parsed
// response comes back unchanged.
describe('doctor-dashboard.api', () => {
  it('getDashboardStats GETs /doctor/dashboard/stats and returns the parsed stats', async () => {
    const response = {
      patients_today: 3,
      this_week: 12,
      pending: 2,
      available_days_this_month: 18,
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await getDashboardStats(authedFetch);

    expect(authedFetch).toHaveBeenCalledWith('/doctor/dashboard/stats');
    expect(result).toBe(response);
  });

  it('getRecentEmails GETs /doctor/dashboard/emails and returns the parsed emails', async () => {
    const response = {
      emails: [
        {
          recipient_email: 'doctor@example.com',
          subject: 'New appointment request',
          sent_at: '2026-11-27T10:00:00Z',
          ref: 'REQ-00007',
        },
      ],
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await getRecentEmails(authedFetch);

    expect(authedFetch).toHaveBeenCalledWith('/doctor/dashboard/emails');
    expect(result).toBe(response);
  });
});
