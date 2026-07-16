import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StaffAccountsPage } from './StaffAccountsPage';
import { AuthProvider } from '../auth/AuthProvider';
import { createStaffAccount, listStaffAccounts, updateAccountStatus } from '../api/admin-users';
import { assignSupervisor } from '../api/supervision';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/admin-users');
vi.mock('../api/supervision');
vi.mock('../api/auth');
vi.mock('../storage/session');

const clinicianRow = {
  id: 'clinician-1',
  fullName: 'أخصائي تجريبي',
  mobile: '+966500000001',
  email: null,
  role: 'CLINICIAN' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-07-10T00:00:00.000Z',
};

const patientRow = {
  id: 'patient-1',
  fullName: 'مريض تجريبي',
  mobile: '+966500000003',
  email: null,
  role: 'PATIENT' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-07-08T00:00:00.000Z',
};

const supervisorRow = {
  id: 'supervisor-1',
  fullName: 'مشرف تجريبي',
  mobile: '+966500000002',
  email: null,
  role: 'SUPERVISOR' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-07-09T00:00:00.000Z',
};

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'ADMIN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <AuthProvider>
        <StaffAccountsPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StaffAccountsPage', () => {
  it('renders nothing for a CLINICIAN', async () => {
    const { container } = renderPage('CLINICIAN');
    await waitFor(() => {
      expect(container.textContent).not.toContain('حسابات الطاقم');
    });
    expect(listStaffAccounts).not.toHaveBeenCalled();
  });

  it('renders nothing for a SUPERVISOR', async () => {
    const { container } = renderPage('SUPERVISOR');
    await waitFor(() => {
      expect(container.textContent).not.toContain('حسابات الطاقم');
    });
  });

  it('ADMIN sees the account list and empty state when there are none', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('ADMIN');
    await waitFor(() => {
      expect(screen.getByText('لا توجد حسابات')).toBeTruthy();
    });
  });

  it('creates a new staff account and refetches the list', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValue([clinicianRow]);
    (createStaffAccount as ReturnType<typeof vi.fn>).mockResolvedValue(clinicianRow);
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('new-staff-account-form')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('الاسم الكامل'), { target: { value: 'أخصائي تجريبي' } });
    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByTestId('new-staff-account-form'));

    await waitFor(() => {
      expect(createStaffAccount).toHaveBeenCalledWith({
        fullName: 'أخصائي تجريبي',
        mobile: '+966500000001',
        email: undefined,
        password: 'password123',
        role: 'CLINICIAN',
      });
      expect(listStaffAccounts).toHaveBeenCalledTimes(2);
    });
  });

  it('toggles an active account to disabled and refetches', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([clinicianRow])
      .mockResolvedValue([{ ...clinicianRow, status: 'DISABLED' }]);
    (updateAccountStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...clinicianRow, status: 'DISABLED' });
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('staff-account-row-clinician-1')).toBeTruthy());
    fireEvent.click(screen.getByText('تعطيل'));

    await waitFor(() => {
      expect(updateAccountStatus).toHaveBeenCalledWith('clinician-1', 'DISABLED');
      expect(listStaffAccounts).toHaveBeenCalledTimes(2);
    });
  });

  it('assigns a supervisor to a CLINICIAN row and shows a confirmation', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([clinicianRow, supervisorRow]);
    (assignSupervisor as ReturnType<typeof vi.fn>).mockResolvedValue({ ...clinicianRow, supervisorUserId: 'supervisor-1' });
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('assign-supervisor-select-clinician-1')).toBeTruthy());
    // data-testid lands directly on the Mantine Select's <input role="combobox">
    // itself, not a wrapper (traced against Mantine 9.4.1 source and confirmed in
    // sub-project 4's review) — click the testid'd element directly, not
    // within(...).getByRole('combobox'), which would find no descendant.
    fireEvent.click(screen.getByTestId('assign-supervisor-select-clinician-1'));
    // The supervisor's full name "مشرف تجريبي" also appears as plain text in
    // the table's Name column for the supervisor row (both rows are rendered
    // in this test), so a plain findByText matches twice: the table cell and
    // the dropdown option. Disambiguate by picking the one rendered inside the
    // Select's listbox (role="option"), same kind of fix documented in
    // ComplaintsPage.test.tsx for an analogous multi-match case.
    const supervisorOptions = await screen.findAllByText('مشرف تجريبي');
    const dropdownOption = supervisorOptions.find((el) => el.closest('[role="option"]'));
    fireEvent.click(dropdownOption!);

    await waitFor(() => {
      expect(assignSupervisor).toHaveBeenCalledWith('clinician-1', 'supervisor-1');
      expect(screen.getByText('تم التعيين')).toBeTruthy();
    });
  });

  it('excludes PATIENT/CAREGIVER rows from the default (no role filter) view', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([patientRow, clinicianRow]);
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('staff-account-row-clinician-1')).toBeTruthy());
    expect(screen.queryByText('مريض تجريبي')).toBeNull();
  });

  it('does not show the supervisor-assignment control for non-CLINICIAN rows', async () => {
    (listStaffAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([supervisorRow]);
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('staff-account-row-supervisor-1')).toBeTruthy());
    expect(screen.queryByTestId('assign-supervisor-select-supervisor-1')).toBeNull();
  });
});
