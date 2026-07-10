import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ReportsScreen from '../reports';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getAssessmentResultsReport, getMedicalReport } from '../../../src/api/reports';
import { ApiError } from '../../../src/api/client';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/reports');

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('ReportsScreen', () => {
  it('renders both sections with full data', async () => {
    (getAssessmentResultsReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      assessments: [
        {
          id: 'assessment-1',
          type: 'INITIAL',
          status: 'APPROVED',
          ssi4Frequency: 10,
          ssi4Duration: 8,
          ssi4PhysicalConcomitants: 4,
          ssi4Total: 22,
          severityCategory: 'MODERATE',
          approvedAt: '2026-06-01T00:00:00.000Z',
          createdAt: '2026-05-30T00:00:00.000Z',
        },
      ],
    });
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: {
        referralReason: 'تلعثم منذ الطفولة',
        initialDiagnosis: 'تلعثم متوسط',
        medicalHistory: 'لا يوجد',
        medications: 'لا يوجد',
        allergies: 'لا يوجد',
        familyHistory: 'أخ مصاب',
      },
      latestApprovedAssessment: {
        id: 'assessment-1',
        type: 'INITIAL',
        severityCategory: 'MODERATE',
        ssi4Total: 22,
        approvedAt: '2026-06-01T00:00:00.000Z',
      },
      activeTreatmentPlan: {
        id: 'plan-1',
        phase: 'PHASE_1',
        goals: 'Improve fluency',
        reviewDate: '2026-10-10T00:00:00.000Z',
      },
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('نتائج التقييمات')).toBeTruthy();
      expect(screen.getByText('أولي')).toBeTruthy();
      expect(screen.getByText('متوسط')).toBeTruthy();
      expect(screen.getByText('22')).toBeTruthy();
      expect(screen.getByText('التقرير الطبي')).toBeTruthy();
      expect(screen.getByText('Patient One')).toBeTruthy();
      expect(screen.getByText('تلعثم منذ الطفولة')).toBeTruthy();
      expect(screen.getByText('Improve fluency')).toBeTruthy();
    });
  });

  it('shows the empty-assessments message when there are none', async () => {
    (getAssessmentResultsReport as jest.Mock).mockResolvedValue({ patientProfileId: 'profile-1', assessments: [] });
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد تقييمات بعد')).toBeTruthy();
    });
  });

  it('shows all three medical-report empty states when their fields are null', async () => {
    (getAssessmentResultsReport as jest.Mock).mockResolvedValue({ patientProfileId: 'profile-1', assessments: [] });
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد معلومات سريرية مسجّلة')).toBeTruthy();
      expect(screen.getByText('لا يوجد تقييم معتمد بعد')).toBeTruthy();
      expect(screen.getByText('لا توجد خطة علاجية حالية')).toBeTruthy();
    });
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getAssessmentResultsReport as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));
    (getMedicalReport as jest.Mock).mockResolvedValue({
      patientProfileId: 'profile-1',
      patientFullName: 'Patient One',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    });

    render(<ThemeProvider><ReportsScreen /></ThemeProvider>);

    await waitFor(
      () => {
        expect(screen.getByText('Something broke')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
