import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ProfileSection } from './ProfileSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient, updatePatient, lookupCaregiver, linkGuardian } from '../api/patients';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/auth');
vi.mock('../storage/session');

const basePatient = {
  id: 'patient-1',
  userId: 'user-1',
  fullName: 'نورة الشمري',
  gender: 'FEMALE',
  dateOfBirth: '2000-01-01',
  nationalId: '1112223334',
  address: 'الرياض',
  referralSource: 'مستشفى',
  status: 'ACTIVE',
  clinicalInfo: { initialDiagnosis: 'تلعثم متوسط' },
};

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue(basePatient);

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ProfileSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfileSection', () => {
  it('shows the patient fields including clinical info once loaded', async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('تلعثم متوسط')).toBeTruthy();
    });
  });

  it('lets a clinician edit and save clinical info', async () => {
    (updatePatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...basePatient,
      clinicalInfo: { initialDiagnosis: 'تلعثم شديد' },
    });
    renderSection();

    await waitFor(() => expect(screen.getByText('تلعثم متوسط')).toBeTruthy());
    fireEvent.click(screen.getByText('تعديل'));
    fireEvent.submit(screen.getByTestId('profile-edit-form'));

    await waitFor(() => {
      expect(updatePatient).toHaveBeenCalledWith('patient-1', expect.objectContaining({ fullName: 'نورة الشمري' }));
    });
  });

  it('hides edit and status controls for a SUPERVISOR', async () => {
    renderSection('SUPERVISOR');
    await waitFor(() => expect(screen.getByText('تلعثم متوسط')).toBeTruthy());
    expect(screen.queryByText('تعديل')).toBeNull();
    expect(screen.queryByText('تعطيل الحساب')).toBeNull();
  });

  it('looks up and links a guardian by mobile number', async () => {
    (lookupCaregiver as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'guardian-1', fullName: 'ولي الأمر' });
    (linkGuardian as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderSection();

    await waitFor(() => expect(screen.getByText('تلعثم متوسط')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('رقم جوال ولي الأمر'), { target: { value: '+966500000199' } });
    fireEvent.submit(screen.getByTestId('link-guardian-form'));

    await waitFor(() => {
      expect(lookupCaregiver).toHaveBeenCalledWith('+966500000199');
      expect(linkGuardian).toHaveBeenCalledWith('patient-1', { guardianUserId: 'guardian-1', relationship: 'GUARDIAN' });
    });
  });
});
