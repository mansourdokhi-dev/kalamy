import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TreatmentPlanSection } from './TreatmentPlanSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listAssessments } from '../api/assessments';
import { listTreatmentPlans, createTreatmentPlan, transitionPhase, listPlanExercises } from '../api/treatment-plans';
import { listExercises } from '../api/exercises';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/assessments');
vi.mock('../api/treatment-plans');
vi.mock('../api/exercises');
vi.mock('../api/auth');
vi.mock('../storage/session');

const activePlan = {
  id: 'plan-1',
  patientProfileId: 'patient-1',
  clinicianUserId: 'staff-1',
  assessmentId: 'assessment-1',
  phase: 'PHASE_1',
  goals: 'تحسين الطلاقة',
  reviewDate: '2026-03-01T00:00:00.000Z',
  status: 'ACTIVE',
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
  (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listExercises as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (listPlanExercises as ReturnType<typeof vi.fn>).mockResolvedValue([]);

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <TreatmentPlanSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TreatmentPlanSection', () => {
  it('shows the no-active-plan message when there is none', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد خطة علاجية نشطة')).toBeTruthy();
    });
  });

  it('shows the active plan goals and phase once loaded', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([activePlan]);
    // Scoped to the rendered container (not `screen`, which also matches the
    // Mantine Select's portal-rendered phase-transition option list — the
    // same duplicate-text hazard flagged after Task 7).
    const { container } = renderSection();
    await waitFor(() => {
      expect(within(container).getByText('تحسين الطلاقة')).toBeTruthy();
      expect(within(container).getByText('المرحلة الأولى')).toBeTruthy();
    });
  });

  it('creates a new plan from an approved assessment', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // `renderSection()` below sets its own default `listAssessments` mock
    // (empty list) *after* this line runs but *before* the component's
    // mount-time fetch fires, so a plain `mockResolvedValue` here would be
    // clobbered. `mockResolvedValueOnce` queues ahead of that default.
    (listAssessments as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'assessment-1', type: 'INITIAL', status: 'APPROVED', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    (createTreatmentPlan as ReturnType<typeof vi.fn>).mockResolvedValue(activePlan);
    renderSection();

    await waitFor(() => expect(screen.getByText('خطة علاجية جديدة')).toBeTruthy());
    // The assessment field is a Mantine Select with no default value, so it
    // must actually be opened and an option chosen (not just filled via
    // fireEvent.change, which a read-only combobox input ignores). Query by
    // role (not getByLabelText) since Mantine also renders a same-labelled
    // hidden input alongside the visible combobox. The dropdown's Floating-UI
    // positioning never resolves under jsdom (no real layout), so the option
    // stays under a `display: none` ancestor — getByRole would filter it out
    // as inaccessible, so use getByText, which (unlike getByRole) does not
    // exclude hidden elements by default.
    fireEvent.click(screen.getByRole('combobox', { name: 'التقييم المعتمد' }));
    fireEvent.click(await screen.findByText(/أولي/));
    fireEvent.change(screen.getByLabelText('الأهداف'), { target: { value: 'تحسين الطلاقة' } });
    fireEvent.change(screen.getByLabelText('تاريخ المراجعة'), { target: { value: '2026-04-01' } });
    fireEvent.submit(screen.getByTestId('new-plan-form'));

    await waitFor(() => {
      expect(createTreatmentPlan).toHaveBeenCalledWith('patient-1', {
        assessmentId: 'assessment-1',
        goals: 'تحسين الطلاقة',
        reviewDate: '2026-04-01',
      });
    });
  });

  it('transitions the active plan to a new phase', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([activePlan]);
    (transitionPhase as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activePlan, phase: 'PHASE_2' });
    renderSection();

    await waitFor(() => expect(screen.getByText('تحسين الطلاقة')).toBeTruthy());
    fireEvent.submit(screen.getByTestId('phase-transition-form'));

    await waitFor(() => {
      expect(transitionPhase).toHaveBeenCalledWith('patient-1', 'plan-1', { toPhase: 'PHASE_2', rationale: undefined });
    });
  });

  it('hides all write controls for a SUPERVISOR', async () => {
    (listTreatmentPlans as ReturnType<typeof vi.fn>).mockResolvedValue([activePlan]);
    renderSection('SUPERVISOR');

    await waitFor(() => expect(screen.getByText('تحسين الطلاقة')).toBeTruthy());
    expect(screen.queryByTestId('phase-transition-form')).toBeNull();
    expect(screen.queryByTestId('new-plan-form')).toBeNull();
    expect(screen.queryByTestId('link-exercise-form')).toBeNull();
  });
});
