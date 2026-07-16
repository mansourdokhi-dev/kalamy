// staff-web/src/pages/MyCliniciansPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MyCliniciansPage } from './MyCliniciansPage';
import { AuthProvider } from '../auth/AuthProvider';
import { listMyClinicians } from '../api/supervision';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/supervision');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'SUPERVISOR') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'supervisor-1',
    fullName: 'Staff Supervisor',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <AuthProvider>
        <MyCliniciansPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MyCliniciansPage', () => {
  it('renders nothing for a CLINICIAN', async () => {
    const { container } = renderPage('CLINICIAN');
    await waitFor(() => {
      expect(container.textContent).not.toContain('الأخصائيون الخاضعون لإشرافي');
    });
    expect(listMyClinicians).not.toHaveBeenCalled();
  });

  it('renders nothing for an ADMIN', async () => {
    const { container } = renderPage('ADMIN');
    await waitFor(() => {
      expect(container.textContent).not.toContain('الأخصائيون الخاضعون لإشرافي');
    });
  });

  it('fetches using the logged-in supervisor\'s own id', async () => {
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(listMyClinicians).toHaveBeenCalledWith('supervisor-1');
    });
  });

  it('shows the empty state when there are no assigned clinicians', async () => {
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByText('لا يوجد أخصائيون معينون لك حاليًا')).toBeTruthy();
    });
  });

  it('renders a clinician row', async () => {
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'clinician-1', fullName: 'أخصائي تجريبي', mobile: '+966500000001', email: null, role: 'CLINICIAN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-07-10T00:00:00.000Z', supervisorUserId: 'supervisor-1' },
    ]);
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByTestId('clinician-row-clinician-1')).toBeTruthy();
    });
  });
});
