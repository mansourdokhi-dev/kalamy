import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PatientDetailPage } from './PatientDetailPage';
import { getPatient } from '../api/patients';

vi.mock('../api/patients');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PatientDetailPage', () => {
  it('shows the patient name and status once loaded', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'patient-1',
      fullName: 'سارة الحربي',
      status: 'ACTIVE',
      clinicalInfo: null,
    });

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/patients/patient-1']}>
          <Routes>
            <Route path="/patients/:id" element={<PatientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('سارة الحربي')).toBeTruthy();
    });
    expect(getPatient).toHaveBeenCalledWith('patient-1');
  });

  it('shows a load error when the patient cannot be fetched', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/patients/patient-1']}>
          <Routes>
            <Route path="/patients/:id" element={<PatientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('تعذر تحميل بيانات المريض')).toBeTruthy();
    });
  });
});
