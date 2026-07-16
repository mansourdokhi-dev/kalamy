import { apiRequest } from './client';
import { assignSupervisor, listMyClinicians } from './supervision';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('supervision API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assignSupervisor PUTs the clinician-scoped endpoint with the supervisor id', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'clinician-1', supervisorUserId: 'supervisor-1' });
    await assignSupervisor('clinician-1', 'supervisor-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/supervision/clinician-1', {
      method: 'PUT',
      body: { supervisorUserId: 'supervisor-1' },
      auth: true,
    });
  });

  it('assignSupervisor sends null to unassign', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'clinician-1', supervisorUserId: null });
    await assignSupervisor('clinician-1', null);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/supervision/clinician-1', {
      method: 'PUT',
      body: { supervisorUserId: null },
      auth: true,
    });
  });

  it('listMyClinicians fetches the supervisor-scoped endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listMyClinicians('supervisor-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/supervision/supervisor-1/clinicians', { auth: true });
  });
});
