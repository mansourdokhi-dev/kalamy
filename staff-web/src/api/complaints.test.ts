import { apiRequest } from './client';
import { listComplaints, listMyComplaints, updateComplaintStatus } from './complaints';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('complaints API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listComplaints fetches with no query params when filter is empty', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listComplaints();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints', { auth: true });
  });

  it('listComplaints appends status and relatedClinicianUserId as query params', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listComplaints({ status: 'OPEN', relatedClinicianUserId: 'clinician-1' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints?status=OPEN&relatedClinicianUserId=clinician-1', { auth: true });
  });

  it('listMyComplaints fetches the caller-scoped endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listMyComplaints();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints/mine', { auth: true });
  });

  it('updateComplaintStatus PATCHes the status endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'complaint-1', status: 'RESOLVED' });
    await updateComplaintStatus('complaint-1', 'RESOLVED');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/complaints/complaint-1/status', {
      method: 'PATCH',
      body: { status: 'RESOLVED' },
      auth: true,
    });
  });
});
