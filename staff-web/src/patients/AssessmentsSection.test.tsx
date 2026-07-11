import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AssessmentsSection } from './AssessmentsSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listAssessments, createAssessment, approveAssessment } from '../api/assessments';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/assessments');
vi.mock('../api/auth');
vi.mock('../storage/session');

const draftAssessment = {
  id: 'assessment-1',
  patientProfileId: 'patient-1',
  clinicianUserId: 'staff-1',
  type: 'INITIAL',
  status: 'DRAFT',
  createdAt: '2026-01-01T00:00:00.000Z',
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
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <AssessmentsSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssessmentsSection', () => {
  it('shows the empty state when there are no assessments', async () => {
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد تقييمات بعد')).toBeTruthy();
    });
  });

  it('creates a new draft assessment and opens its intake form', async () => {
    // First call is the mount-time load (empty list); refreshList() after the
    // create call reflects the backend now having the new draft in it, same
    // as a real listAssessments endpoint would after a write.
    (listAssessments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValue([draftAssessment]);
    (createAssessment as ReturnType<typeof vi.fn>).mockResolvedValue(draftAssessment);
    renderSection();

    await waitFor(() => expect(screen.getByText('لا توجد تقييمات بعد')).toBeTruthy());
    fireEvent.click(screen.getByText('تقييم جديد'));

    await waitFor(() => {
      expect(createAssessment).toHaveBeenCalledWith('patient-1', 'INITIAL');
      expect(screen.getByTestId('assessment-intake-form')).toBeTruthy();
    });
  });

  it('approves a draft assessment with the selected severity category', async () => {
    // Mount-time load returns the draft; refreshList() after approval returns
    // the same row updated to APPROVED, mirroring a real backend's list
    // endpoint reflecting the prior write instead of a static mock.
    (listAssessments as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([draftAssessment])
      .mockResolvedValue([{ ...draftAssessment, status: 'APPROVED', severityCategory: 'MILD' }]);
    (approveAssessment as ReturnType<typeof vi.fn>).mockResolvedValue({ ...draftAssessment, status: 'APPROVED', severityCategory: 'MILD' });
    renderSection();

    await waitFor(() => expect(screen.getByTestId('assessment-row-assessment-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assessment-row-assessment-1'));
    await waitFor(() => expect(screen.getByText('اعتماد')).toBeTruthy());
    fireEvent.click(screen.getByText('اعتماد'));

    await waitFor(() => {
      expect(approveAssessment).toHaveBeenCalledWith('patient-1', 'assessment-1', 'MILD');
    });
  });

  it('hides creation and approval controls for a SUPERVISOR', async () => {
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([draftAssessment]);
    renderSection('SUPERVISOR');

    await waitFor(() => expect(screen.getByTestId('assessment-row-assessment-1')).toBeTruthy());
    expect(screen.queryByText('تقييم جديد')).toBeNull();
    fireEvent.click(screen.getByTestId('assessment-row-assessment-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('assessment-intake-form')).toBeNull();
    });
  });
});
