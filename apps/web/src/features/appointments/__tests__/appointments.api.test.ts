import { describe, expect, it, vi } from 'vitest';
import { bookAppointment } from '../appointments.api';

// Thin, mechanical test for `bookAppointment`, matching
// doctor/__tests__/doctor.api.test.ts's style for its own wrappers:
// confirm the exact path/method/body sent to authedFetch and that the
// parsed body comes back unchanged.
describe('appointments.api', () => {
  it('bookAppointment POSTs the given payload to /appointments and returns the parsed body', async () => {
    const payload = {
      doctor_id: 10,
      date: '2026-12-01',
      time: '09:00',
      visit_type: 'follow_up',
      reason: 'Follow-up checkup',
      sms_reminder_opt_in: true,
    };
    const response = {
      id: 1,
      doctor: { id: 10, first_name: 'Ama', last_name: 'Boateng' },
      department: { id: 1, name: 'Cardiology' },
      date: '2026-12-01',
      time: '09:00',
      duration_minutes: 20,
      visit_type: 'follow_up',
      reason: 'Follow-up checkup',
      status: 'pending',
      submitted_at: '2026-11-26T00:00:00Z',
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await bookAppointment(authedFetch, payload);

    expect(authedFetch).toHaveBeenCalledWith('/appointments', { method: 'POST', body: payload });
    expect(result).toBe(response);
  });
});
