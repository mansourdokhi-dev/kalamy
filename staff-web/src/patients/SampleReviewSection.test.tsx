import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SampleReviewSection } from './SampleReviewSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getCurrentCycle } from '../api/cycles';
import { reviewSample, requestIntervention, completeIntervention, transferReviewResponsibility } from '../api/specialist-review';
import { listMyClinicians } from '../api/supervision';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';
import { fetchSampleMediaBlob } from '../api/sample-media';

vi.mock('../api/patients');
vi.mock('../api/cycles');
vi.mock('../api/specialist-review');
vi.mock('../api/supervision');
vi.mock('../api/auth');
vi.mock('../storage/session');
vi.mock('../api/sample-media');

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
    // baseCycle.speechSample.reservedByUserId is 'staff-1', matching the
    // CLINICIAN reservation holder used throughout the existing tests below.
    // A SUPERVISOR is never the reservation holder in real usage (per the
    // brief's note), so it needs a distinct id here too, or isReservationHolder
    // would spuriously become true and hide the transfer branch.
    id: role === 'SUPERVISOR' ? 'supervisor-1' : 'staff-1',
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
  // Default so tests that render as SUPERVISOR without exercising the transfer
  // flow itself (e.g. the not-transfer-eligible case) don't crash the
  // unconditional listMyClinicians useEffect; tests that care override this.
  (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('SampleReviewSection', () => {
  it('renders nothing for a SUPERVISOR when the cycle is not transfer-eligible', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle, status: 'WAITING_FOR_SPECIALIST' });
    renderSection('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByText('مراجعة العينة')).toBeTruthy();
    });
    expect(screen.queryByText('نقل مسؤولية المراجعة')).toBeNull();
  });

  it('shows the transfer form for a SUPERVISOR when the cycle is transfer-eligible', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'clinician-2', fullName: 'أخصائي آخر', mobile: '+966500000009', email: null, role: 'CLINICIAN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-07-01T00:00:00.000Z', supervisorUserId: 'staff-1' },
    ]);
    renderSection('SUPERVISOR');
    await waitFor(() => {
      expect(screen.getByText('نقل مسؤولية المراجعة')).toBeTruthy();
    });
    expect(screen.queryByText('إرسال القرار')).toBeNull();
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

  it('plays a sample part by fetching an authenticated blob URL', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (fetchSampleMediaBlob as ReturnType<typeof vi.fn>).mockResolvedValue('blob:mock-url');
    renderSection();

    await waitFor(() => expect(screen.getByText('قراءة نص')).toBeTruthy());
    fireEvent.click(screen.getAllByText('تشغيل')[0]);

    await waitFor(() => {
      expect(fetchSampleMediaBlob).toHaveBeenCalledWith('patient-1', 'part-1');
    });
  });

  it('requests an intervention with the entered type and reason', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (requestIntervention as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, interventionType: 'VIDEO_MEETING' });
    renderSection();

    await waitFor(() => expect(screen.getByText('طلب تدخل مباشر')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('سبب التدخل'), { target: { value: 'يحتاج ملاحظة مباشرة' } });
    fireEvent.click(screen.getByText('طلب تدخل مباشر'));

    await waitFor(() => {
      expect(requestIntervention).toHaveBeenCalledWith('cycle-1', { interventionType: 'VIDEO_MEETING', reasonNote: 'يحتاج ملاحظة مباشرة' });
    });
  });

  it('completes an intervention with the entered outcome notes', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseCycle,
      status: 'DIRECT_INTERVENTION_REQUIRED',
      speechSample: {
        ...baseCycle.speechSample,
        interventionType: 'VIDEO_MEETING',
        interventionRequestedAt: '2026-07-14T02:00:00.000Z',
        interventionDeadlineAt: '2026-07-21T02:00:00.000Z',
      },
    });
    (completeIntervention as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, interventionCompletedAt: '2026-07-14T03:00:00.000Z' });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText('نتيجة التدخل')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('نتيجة التدخل'), { target: { value: 'تحسّن ملحوظ' } });
    fireEvent.click(screen.getByText('إنهاء التدخل'));

    await waitFor(() => {
      expect(completeIntervention).toHaveBeenCalledWith('cycle-1', { outcomeNotes: 'تحسّن ملحوظ' });
    });
  });

  it('submits a transfer with the selected clinician and reason', async () => {
    (getCurrentCycle as ReturnType<typeof vi.fn>).mockResolvedValue(baseCycle);
    (listMyClinicians as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'clinician-2', fullName: 'أخصائي آخر', mobile: '+966500000009', email: null, role: 'CLINICIAN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-07-01T00:00:00.000Z', supervisorUserId: 'staff-1' },
    ]);
    (transferReviewResponsibility as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseCycle.speechSample, reservedByUserId: 'clinician-2' });
    renderSection('SUPERVISOR');

    await waitFor(() => expect(screen.getByTestId('transfer-target-select')).toBeTruthy());
    // Same lesson as StaffAccountsPage.test.tsx: data-testid lands on the Select's
    // own <input role="combobox">, so click it directly rather than scoping
    // within(...).getByRole('combobox'), which finds no descendant.
    fireEvent.click(screen.getByTestId('transfer-target-select'));
    fireEvent.click(await screen.findByText('أخصائي آخر'));
    fireEvent.change(screen.getByLabelText('سبب النقل'), { target: { value: 'إجازة طارئة' } });
    fireEvent.click(screen.getByText('تنفيذ النقل'));

    await waitFor(() => {
      expect(transferReviewResponsibility).toHaveBeenCalledWith('cycle-1', { toUserId: 'clinician-2', reason: 'إجازة طارئة' });
    });
  });
});
