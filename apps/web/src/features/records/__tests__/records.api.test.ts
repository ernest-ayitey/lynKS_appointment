import { describe, expect, it, vi } from 'vitest';
import { approveRequest, getQueue, undoRequest } from '../records.api';

// Thin, mechanical tests for the records.api.ts wrappers, matching
// appointments/__tests__/appointments.api.test.ts's style: confirm the
// exact path/method/query string sent to authedFetch and that the parsed
// body comes back unchanged.
describe('records.api', () => {
  it('getQueue GETs /records/queue with no query string when called with no filters', async () => {
    const response = {
      stats: { pending: 0, approved_today: 0, declined_today: 0, oldest_waiting_at: null },
      requests: [],
      total: 0,
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await getQueue(authedFetch);

    expect(authedFetch).toHaveBeenCalledWith('/records/queue');
    expect(result).toBe(response);
  });

  it('getQueue combines status, doctor_id, search, and sort into one query string', async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      stats: { pending: 0, approved_today: 0, declined_today: 0, oldest_waiting_at: null },
      requests: [],
      total: 0,
    });

    await getQueue(authedFetch, { status: 'approved', doctor_id: 10, search: 'Ama', sort: 'newest' });

    expect(authedFetch).toHaveBeenCalledWith('/records/queue?status=approved&doctor_id=10&search=Ama&sort=newest');
  });

  it('approveRequest POSTs to /records/requests/:id/approve and returns the updated request', async () => {
    const response = {
      request: {
        id: 7,
        ref: 'REQ-00007',
        patient: { id: 1, first_name: 'Ama', last_name: 'Boateng' },
        doctor: { id: 10, first_name: 'Kofi', last_name: 'Mensah' },
        department: { id: 1, name: 'Cardiology' },
        date: '2026-12-01',
        time: '09:00',
        duration_minutes: 20,
        visit_type: 'follow_up',
        reason: 'Follow-up checkup',
        status: 'approved',
        submitted_at: '2026-11-26T00:00:00Z',
        decided_at: '2026-11-26T01:00:00Z',
        decline_reason_code: null,
        decline_message: null,
        internal_note: null,
      },
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await approveRequest(authedFetch, 7);

    expect(authedFetch).toHaveBeenCalledWith('/records/requests/7/approve', { method: 'POST' });
    expect(result).toBe(response);
  });

  it('undoRequest POSTs to /records/requests/:id/undo and returns the reverted request', async () => {
    const response = {
      request: {
        id: 7,
        ref: 'REQ-00007',
        patient: { id: 1, first_name: 'Ama', last_name: 'Boateng' },
        doctor: { id: 10, first_name: 'Kofi', last_name: 'Mensah' },
        department: { id: 1, name: 'Cardiology' },
        date: '2026-12-01',
        time: '09:00',
        duration_minutes: 20,
        visit_type: 'follow_up',
        reason: 'Follow-up checkup',
        status: 'pending',
        submitted_at: '2026-11-26T00:00:00Z',
        decided_at: null,
        decline_reason_code: null,
        decline_message: null,
        internal_note: null,
      },
    };
    const authedFetch = vi.fn().mockResolvedValue(response);

    const result = await undoRequest(authedFetch, 7);

    expect(authedFetch).toHaveBeenCalledWith('/records/requests/7/undo', { method: 'POST' });
    expect(result).toBe(response);
  });
});
