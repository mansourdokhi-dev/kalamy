import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ProgressSection } from './ProgressSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getProgressDashboard, getPassedLevels } from '../api/progress';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/progress');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection() {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role: 'SUPERVISOR',
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ProgressSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProgressSection', () => {
  it('shows the dashboard stats', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'المستوى الثاني',
      currentLevelOrder: 2,
      levelsCompleted: 1,
      totalTrainingEvents: 12,
      repeatedLevelOrders: [],
      daysInProgram: 30,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('المستوى الثاني')).toBeTruthy();
      expect(screen.getByText(/30/)).toBeTruthy();
    });
  });

  it('is visible to a SUPERVISOR (no role gating)', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: null,
      currentLevelOrder: null,
      levelsCompleted: 0,
      totalTrainingEvents: 0,
      repeatedLevelOrders: [],
      daysInProgram: 0,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('التقدم')).toBeTruthy();
    });
  });

  it('shows the empty state when no levels have been passed', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'Level 1', currentLevelOrder: 1, levelsCompleted: 0, totalTrainingEvents: 0, repeatedLevelOrders: [], daysInProgram: 1,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('لم يُجتز أي مستوى بعد')).toBeTruthy();
    });
  });

  it('lists passed levels with their passed-at date', async () => {
    (getProgressDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      currentLevelName: 'Level 2', currentLevelOrder: 2, levelsCompleted: 1, totalTrainingEvents: 12, repeatedLevelOrders: [], daysInProgram: 30,
    });
    (getPassedLevels as ReturnType<typeof vi.fn>).mockResolvedValue([
      { levelId: 'level-1', levelName: 'المستوى الأول', order: 1, levelVersionId: 'version-1', passedAt: '2026-07-10T00:00:00.000Z' },
    ]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('المستوى الأول')).toBeTruthy();
    });
  });
});
