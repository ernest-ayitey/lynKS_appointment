import { describe, expect, it, vi } from 'vitest';
import { getDepartments, getDoctors, getPublicAvailability, getSlots } from '../doctor.api';

// Thin, mechanical tests for the four patient-facing lookup wrappers added in
// Task 6 — each just needs to hit the right path with the right query
// params and hand back whatever authedFetch resolved with, matching this
// file's existing wrapper tests' style (exercised indirectly through
// doctor-availability.page.test.tsx for the doctor's-own wrappers).
describe('doctor.api public lookup wrappers', () => {
  it('getDepartments calls GET /departments and returns the parsed body', async () => {
    const body = [{ id: 1, name: 'Cardiology', doctor_count: 3 }];
    const authedFetch = vi.fn().mockResolvedValue(body);

    const result = await getDepartments(authedFetch);

    expect(authedFetch).toHaveBeenCalledWith('/departments');
    expect(result).toBe(body);
  });

  it('getDoctors calls GET /doctors with no query string when no department id is given', async () => {
    const body = [
      {
        id: 10,
        first_name: 'Ama',
        last_name: 'Boateng',
        department: { id: 1, name: 'Cardiology' },
        specialty_title: 'Cardiologist',
      },
    ];
    const authedFetch = vi.fn().mockResolvedValue(body);

    const result = await getDoctors(authedFetch);

    expect(authedFetch).toHaveBeenCalledWith('/doctors');
    expect(result).toBe(body);
  });

  it('getDoctors calls GET /doctors?department_id= with the given department id', async () => {
    const authedFetch = vi.fn().mockResolvedValue([]);

    await getDoctors(authedFetch, 2);

    expect(authedFetch).toHaveBeenCalledWith('/doctors?department_id=2');
  });

  it('getPublicAvailability calls GET /doctors/:id/availability?month= and returns the parsed body', async () => {
    const body = { days: ['2026-12-01', '2026-12-02'] };
    const authedFetch = vi.fn().mockResolvedValue(body);

    const result = await getPublicAvailability(authedFetch, 7, '2026-12');

    expect(authedFetch).toHaveBeenCalledWith('/doctors/7/availability?month=2026-12');
    expect(result).toBe(body);
  });

  it('getSlots calls GET /doctors/:id/slots?date= and returns the parsed body', async () => {
    const body = { slots: ['09:00', '09:20'] };
    const authedFetch = vi.fn().mockResolvedValue(body);

    const result = await getSlots(authedFetch, 7, '2026-12-01');

    expect(authedFetch).toHaveBeenCalledWith('/doctors/7/slots?date=2026-12-01');
    expect(result).toBe(body);
  });
});
