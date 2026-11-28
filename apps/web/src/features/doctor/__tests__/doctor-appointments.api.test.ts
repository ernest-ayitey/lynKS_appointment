import { describe, expect, it, vi } from 'vitest';
import { listDoctorAppointments, markAppointmentOutcome } from '../doctor-appointments.api';

// Thin, mechanical tests for the doctor-appointments.api.ts wrappers,
// matching records/__tests__/records.api.test.ts's and
// appointments/__tests__/appointments.api.test.ts's style: confirm the
// exact path/method/query string sent to authedFetch and that the parsed
// body comes back unchanged.
describe('doctor-appointments.api', () => {
  it('listDoctorAppointments GETs /doctor/appointments with no query string when called with no filters', async () => {
    const response = { appointments: [], total: 0 };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await listDoctorAppointments(authedFetch);

    expect(authedFetch).toHaveBeenCalledWith('/doctor/appointments');
    expect(result).toBe(response);
  });

  it('listDoctorAppointments combines search, from, and to into one query string', async () => {
    const authedFetch = vi.fn().mockResolvedValue({ appointments: [], total: 0 });

    await listDoctorAppointments(authedFetch, { search: 'Ama', from: '2026-11-27', to: '2026-12-04' });

    expect(authedFetch).toHaveBeenCalledWith('/doctor/appointments?search=Ama&from=2026-11-27&to=2026-12-04');
  });

  it('listDoctorAppointments omits a filter key entirely when it is absent', async () => {
    const authedFetch = vi.fn().mockResolvedValue({ appointments: [], total: 0 });

    await listDoctorAppointments(authedFetch, { search: 'Ama' });

    expect(authedFetch).toHaveBeenCalledWith('/doctor/appointments?search=Ama');
  });

  it('markAppointmentOutcome PATCHes /appointments/:id with status and visit_notes, returning the updated appointment', async () => {
    const response = {
      id: 7,
      ref: 'REQ-00007',
      patient: { id: 1, first_name: 'Ama', last_name: 'Boateng', phone: '0551234567', sex: 'female', age: 34 },
      date: '2026-12-01',
      time: '09:00',
      duration_minutes: 20,
      visit_type: 'follow_up',
      reason: 'Follow-up checkup',
      status: 'completed',
      approved_by: { id: 10, first_name: 'Kofi', last_name: 'Mensah' },
      visit_notes: 'Patient is recovering well.',
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await markAppointmentOutcome(authedFetch, 7, {
      status: 'completed',
      visit_notes: 'Patient is recovering well.',
    });

    expect(authedFetch).toHaveBeenCalledWith('/appointments/7', {
      method: 'PATCH',
      body: { status: 'completed', visit_notes: 'Patient is recovering well.' },
    });
    expect(result).toBe(response);
  });

  it('markAppointmentOutcome can be called with just a status (no visit_notes)', async () => {
    const authedFetch = vi.fn().mockResolvedValue({});

    await markAppointmentOutcome(authedFetch, 7, { status: 'no_show' });

    expect(authedFetch).toHaveBeenCalledWith('/appointments/7', {
      method: 'PATCH',
      body: { status: 'no_show' },
    });
  });

  it('markAppointmentOutcome accepts status: "arrived" and PATCHes the same endpoint', async () => {
    const authedFetch = vi.fn().mockResolvedValue({});

    await markAppointmentOutcome(authedFetch, 7, { status: 'arrived' });

    expect(authedFetch).toHaveBeenCalledWith('/appointments/7', {
      method: 'PATCH',
      body: { status: 'arrived' },
    });
  });
});
