import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ReportsSection } from './ReportsSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getAssessmentResultsReport, getMedicalReport } from '../api/reports';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/reports');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection() {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role: 'CLINICIAN',
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ReportsSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReportsSection', () => {
  it('shows the empty state when there are no assessment results', async () => {
    (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getMedicalReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      patientProfileId: 'patient-1',
      patientFullName: 'مريض',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد نتائج تقييمات')).toBeTruthy();
    });
  });

  it('renders an assessment result row', async () => {
    (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'assessment-1',
        type: 'INITIAL',
        status: 'APPROVED',
        ssi4Frequency: 3,
        ssi4Duration: 2,
        ssi4PhysicalConcomitants: 1,
        ssi4Total: 6,
        severityCategory: 'MILD',
        approvedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2025-12-01T00:00:00.000Z',
      },
    ]);
    (getMedicalReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      patientProfileId: 'patient-1',
      patientFullName: 'مريض',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId('assessment-result-row-assessment-1')).toBeTruthy();
    });
  });

  it('shows clinical info and active plan summary from the medical report', async () => {
    (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getMedicalReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      patientProfileId: 'patient-1',
      patientFullName: 'مريض',
      clinicalInfo: {
        referralReason: 'إحالة من مدرسة',
        initialDiagnosis: null,
        medicalHistory: null,
        medications: null,
        allergies: null,
        familyHistory: null,
      },
      latestApprovedAssessment: {
        id: 'assessment-1',
        type: 'INITIAL',
        severityCategory: 'MILD',
        ssi4Total: 6,
        approvedAt: '2026-01-01T00:00:00.000Z',
      },
      activeTreatmentPlan: {
        id: 'plan-1',
        phase: 'PHASE_1',
        goals: 'تحسين الطلاقة',
        reviewDate: null,
      },
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('إحالة من مدرسة', { exact: false })).toBeTruthy();
      expect(screen.getByTestId('latest-assessment-summary')).toBeTruthy();
      expect(screen.getByTestId('active-plan-summary')).toBeTruthy();
    });
  });
});
