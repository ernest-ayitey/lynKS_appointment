import { describe, expect, it, vi } from 'vitest';
import { bookAppointment, cancelAppointment, listAppointments } from '../appointments.api';

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

  it('listAppointments GETs /appointments with no query string when called with no filters', async () => {
    const response = { appointments: [], total: 0 };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await listAppointments(authedFetch, {});

    expect(authedFetch).toHaveBeenCalledWith('/appointments');
    expect(result).toBe(response);
  });

  // The two tabs a naive single-status implementation would get wrong: this
  // one asserts the single-value case (`status=approved`, matching the
  // screen spec's "Upcoming (approved)" dashboard stat).
  it('listAppointments sends a single status value unencoded', async () => {
    const authedFetch = vi.fn().mockResolvedValue({ appointments: [], total: 0 });

    await listAppointments(authedFetch, { status: 'approved' });

    expect(authedFetch).toHaveBeenCalledWith('/appointments?status=approved');
  });

  // The other naive-implementation trap: a comma-separated multi-status
  // value must survive as a single `status` param (matching Task 3's
  // `filter_by_status`, which splits on ','), not be split into repeated
  // `status=` params or URL-encoded into `%2C`.
  it('listAppointments sends a comma-separated status list as a single status param', async () => {
    const authedFetch = vi.fn().mockResolvedValue({ appointments: [], total: 0 });

    await listAppointments(authedFetch, { status: 'declined,cancelled' });

    expect(authedFetch).toHaveBeenCalledWith('/appointments?status=declined%2Ccancelled');
  });

  it('listAppointments sends a to-only filter (the Past tab) without a status param', async () => {
    const authedFetch = vi.fn().mockResolvedValue({ appointments: [], total: 0 });

    await listAppointments(authedFetch, { to: '2026-11-25' });

    expect(authedFetch).toHaveBeenCalledWith('/appointments?to=2026-11-25');
  });

  it('listAppointments combines multiple filters into one query string', async () => {
    const authedFetch = vi.fn().mockResolvedValue({ appointments: [], total: 0 });

    await listAppointments(authedFetch, { status: 'pending', search: 'Ama', from: '2026-01-01', to: '2026-12-31' });

    expect(authedFetch).toHaveBeenCalledWith(
      '/appointments?status=pending&search=Ama&from=2026-01-01&to=2026-12-31',
    );
  });

  it('cancelAppointment POSTs to /appointments/:id/cancel and returns the updated appointment', async () => {
    const response = {
      id: 7,
      doctor: { id: 10, first_name: 'Ama', last_name: 'Boateng' },
      department: { id: 1, name: 'Cardiology' },
      date: '2026-12-01',
      time: '09:00',
      duration_minutes: 20,
      visit_type: 'follow_up',
      reason: 'Follow-up checkup',
      status: 'cancelled',
      submitted_at: '2026-11-26T00:00:00Z',
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await cancelAppointment(authedFetch, 7);

    expect(authedFetch).toHaveBeenCalledWith('/appointments/7/cancel', { method: 'POST' });
    expect(result).toBe(response);
  });
});
