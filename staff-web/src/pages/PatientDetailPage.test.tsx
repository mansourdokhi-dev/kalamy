import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PatientDetailPage } from './PatientDetailPage';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/auth');
vi.mock('../storage/session');

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
