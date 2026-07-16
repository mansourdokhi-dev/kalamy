import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AdminReportsPage } from './AdminReportsPage';
import { AuthProvider } from '../auth/AuthProvider';
import {
  getOperationalStatusReport,
  getRegisteredUsersReport,
  getServiceModificationsReport,
  getStaffPerformanceReport,
  getComplaintsReport,
} from '../api/reports';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/reports');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'SUPERVISOR') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getOperationalStatusReport as ReturnType<typeof vi.fn>).mockResolvedValue({
    usersByRole: { PATIENT: 5, CAREGIVER: 0, CLINICIAN: 2, SUPERVISOR: 0, ADMIN: 1 },
    patientProfilesByStatus: { ACTIVE: 4, DISABLED: 1 },
    treatmentPlansByStatus: { ACTIVE: 3, INACTIVE: 0 },
    trainingCyclesByStatus: { WAITING_FOR_SPECIALIST: 2 },
  });
  (getRegisteredUsersReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getServiceModificationsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getStaffPerformanceReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getComplaintsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  return render(
    <MantineProvider>
      <AuthProvider>
        <AdminReportsPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminReportsPage', () => {
  it('renders nothing for a CLINICIAN', async () => {
    renderPage('CLINICIAN');
    await waitFor(() => {
      expect(screen.queryByText('التقارير الإدارية')).toBeNull();
    });
  });

  it('SUPERVISOR sees the operational status tab with non-zero stats only', async () => {
    renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByTestId('stat-PATIENT')).toBeTruthy();
      expect(screen.getByTestId('stat-CLINICIAN')).toBeTruthy();
    });
    expect(screen.queryByTestId('stat-CAREGIVER')).toBeNull();
    expect(screen.queryByTestId('stat-SUPERVISOR')).toBeNull();
  });

  it('fetches the registered-users report when its tab is activated', async () => {
    renderPage('ADMIN');
    await waitFor(() => expect(screen.getByTestId('tab-registeredUsers')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tab-registeredUsers'));
    await waitFor(() => {
      expect(getRegisteredUsersReport).toHaveBeenCalled();
    });
  });
});
