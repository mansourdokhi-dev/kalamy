import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PatientDetailPage } from './PatientDetailPage';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';
import { getCurrentCycle } from '../api/cycles';
import { getProgressDashboard, getPassedLevels } from '../api/progress';
import { getAssessmentResultsReport, getMedicalReport } from '../api/reports';

vi.mock('../api/patients');
vi.mock('../api/auth');
vi.mock('../storage/session');
vi.mock('../api/cycles');
vi.mock('../api/progress');
vi.mock('../api/reports');

beforeEach(() => {
  vi.clearAllMocks();
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role: 'CLINICIAN',
    mustChangePassword: false,
  });
  // SampleReviewSection chains `.then()` directly on getCurrentCycle's return value
  // (not awaited), so the default auto-mock (a vi.fn() returning `undefined`) would
  // throw synchronously ("Cannot read properties of undefined (reading 'then')") and
  // crash the whole page render. Give it a rejected promise so the component's own
  // `.catch()` handles it gracefully (the section just renders nothing, which is fine
  // since this test file doesn't assert on SampleReviewSection's content).
  (getCurrentCycle as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
  // ProgressSection destructures the Promise.all result straight into state (no
  // `undefined` guard beyond a `=== null` check), so the default auto-mock
  // (`undefined`) makes `passedLevels.length` throw during render. Reject both so
  // the section's own `.catch()` handles it and renders its error alert instead.
  (getProgressDashboard as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
  (getPassedLevels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
  // ReportsSection also chains `.then()`/`.catch()` un-awaited on a Promise.all of
  // these two calls, so give both a rejected promise for the same reason as above.
  (getAssessmentResultsReport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
  (getMedicalReport as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not mocked in this test'));
});

function renderPage() {
  return render(
    <MantineProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/patients/patient-1']}>
          <Routes>
            <Route path="/patients/:id" element={<PatientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </MantineProvider>,
  );
}

describe('PatientDetailPage', () => {
  it('shows the patient name and status once loaded', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'patient-1',
      fullName: 'سارة الحربي',
      status: 'ACTIVE',
      clinicalInfo: null,
    });

    renderPage();

    // The full name now also appears inside ProfileSection's read-only field list,
    // so target the page heading specifically to avoid an ambiguous match.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'سارة الحربي' })).toBeTruthy();
    });
    expect(getPatient).toHaveBeenCalledWith('patient-1');
  });

  it('shows a load error when the patient cannot be fetched', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('تعذر تحميل بيانات المريض')).toBeTruthy();
    });
  });
});
