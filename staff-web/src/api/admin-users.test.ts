import { apiRequest } from './client';
import { createStaffAccount, listStaffAccounts, updateAccountStatus } from './admin-users';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('admin-users API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createStaffAccount POSTs to /api/v1/admin/staff with the input body', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'staff-1' });
    await createStaffAccount({ fullName: 'أحمد', mobile: '+966500000001', password: 'password123', role: 'CLINICIAN' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/staff', {
      method: 'POST',
      body: { fullName: 'أحمد', mobile: '+966500000001', password: 'password123', role: 'CLINICIAN' },
      auth: true,
    });
  });

  it('listStaffAccounts fetches with no query params when filter is empty', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listStaffAccounts();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/users', { auth: true });
  });

  it('listStaffAccounts appends role and status as query params', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listStaffAccounts({ role: 'CLINICIAN', status: 'ACTIVE' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/users?role=CLINICIAN&status=ACTIVE', { auth: true });
  });

  it('updateAccountStatus PATCHes the status endpoint', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'staff-1', status: 'DISABLED' });
    await updateAccountStatus('staff-1', 'DISABLED');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/admin/users/staff-1/status', {
      method: 'PATCH',
      body: { status: 'DISABLED' },
      auth: true,
    });
  });
});
