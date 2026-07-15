import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SampleReviewSection } from './SampleReviewSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getCurrentCycle } from '../api/cycles';
import { reviewSample } from '../api/specialist-review';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/cycles');
vi.mock('../api/specialist-review');
vi.mock('../api/auth');
vi.mock('../storage/session');

const baseCycle = {
  id: 'cycle-1',
  patientProfileId: 'patient-1',
  treatmentPlanId: 'plan-1',
  levelId: 'level-1',
  levelVersionId: 'version-1',
  cycleNumber: 1,
  status: 'UNDER_REVIEW',
  humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
  firstTrainingEventAt: '2026-07-01T00:00:00.000Z',
  closedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  speechSample: {
    id: 'sample-1',
    trainingCycleId: 'cycle-1',
    selfSeverityCurrent: 5,
    selfSeverityExpectedNext: 3,
    camperdownPerformanceRating: 6,
    clientOpinionScore: 7,
    submittedAt: '2026-07-14T00:00:00.000Z',
    reviewedByUserId: null,
    clinicianOpinionScore: null,
    reviewNotes: null,
    reviewedAt: null,
    decision: null,
    reservedByUserId: 'staff-1',
    reservedAt: '2026-07-14T01:00:00.000Z',
    reviewDeadlineAt: '2026-07-16T01:00:00.000Z',
    interventionType: null,
    interventionRequestedAt: null,
    interventionDeadlineAt: null,
    interventionCompletedAt: null,
    interventionOutcomeNotes: null,
    parts: [
      { id: 'part-1', partType: 'READING', label: 'قراءة نص', order: 1, recordingUrl: 'x', mimeType: 'video/mp4', fileSizeBytes: 1000, durationSeconds: 30, technicallyDamaged: false },
    ],
  },
};

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'CLINICIAN') {
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
          <SampleReviewSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SampleReviewSection', () => {
  it('renders nothing for a SUPERVISOR', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    const { container } = renderSection('SUPERVISOR');
    await waitFor(() => {
      expect(container.textContent).not.toContain('مراجعة العينة');
    });
  });

  it('renders nothing when the cycle is not in a review-relevant status', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle, status: 'ACTIVE_LEVEL_TRAINING', speechSample: null });
    const { container } = renderSection();
    await waitFor(() => {
      expect(container.textContent).not.toContain('مراجعة العينة');
    });
  });

  it('shows the self-report fields for a reviewable sample', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('مراجعة العينة')).toBeTruthy();
      expect(screen.getByText(/5/)).toBeTruthy();
    });
  });

  it('hides the decision form when the sample is reserved by a different specialist', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseCycle,
      speechSample: { ...baseCycle.speechSample, reservedByUserId: 'someone-else' },
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('محجوزة لأخصائي آخر')).toBeTruthy();
    });
    expect(screen.queryByText('إرسال القرار')).toBeNull();
  });

  it('shows the not-yet-reserved label when nobody holds the reservation', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseCycle,
      status: 'WAITING_FOR_SPECIALIST',
      speechSample: { ...baseCycle.speechSample, reservedByUserId: null },
    });
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لم تُحجز بعد للمراجعة')).toBeTruthy();
    });
    expect(screen.queryByText('محجوزة لأخصائي آخر')).toBeNull();
    expect(screen.queryByText('إرسال القرار')).toBeNull();
  });

  it('submits a TRANSITION decision with the entered score', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (reviewSample as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, decision: 'TRANSITION' });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText('تقييم الأخصائي (1-9)')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('تقييم الأخصائي (1-9)'), { target: { value: '8' } });
    fireEvent.click(screen.getByText('إرسال القرار'));

    await waitFor(() => {
      expect(reviewSample).toHaveBeenCalledWith('patient-1', { decision: 'TRANSITION', clinicianOpinionScore: 8, reviewNotes: '' });
    });
  });
});
