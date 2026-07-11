import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PatientsPage } from './PatientsPage';
import { searchPatients } from '../api/patients';
import { ApiError } from '../api/client';

vi.mock('../api/patients');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PatientsPage', () => {
  it('shows the empty-state prompt before any search is run', () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <PatientsPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.getByText('ابحث عن مريض بالاسم أو رقم الهوية')).toBeTruthy();
    expect(searchPatients).not.toHaveBeenCalled();
  });

  it('searches and renders a results table', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'patient-1',
        fullName: 'محمد العتيبي',
        nationalId: '1234567890',
        gender: 'MALE',
        dateOfBirth: '1995-05-05T00:00:00.000Z',
        status: 'ACTIVE',
      },
    ]);

    render(
      <MantineProvider>
        <MemoryRouter>
          <PatientsPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'محمد' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(
      () => {
        expect(searchPatients).toHaveBeenCalledWith('محمد');
        expect(screen.getByText('محمد العتيبي')).toBeTruthy();
        expect(screen.getByText('1234567890')).toBeTruthy();
        expect(screen.getByText('ذكر')).toBeTruthy();
        expect(screen.getByText('نشط')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('shows the no-results message when a search returns nothing', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(
      <MantineProvider>
        <MemoryRouter>
          <PatientsPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'zzz' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('لا توجد نتائج')).toBeTruthy();
    });
  });

  it('shows an error alert when the search fails', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    render(
      <MantineProvider>
        <MemoryRouter>
          <PatientsPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'a' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
  });

  it('navigates to the patient detail page when a row is clicked', async () => {
    (searchPatients as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'patient-42',
        fullName: 'خالد القحطاني',
        nationalId: '9998887770',
        gender: 'MALE',
        dateOfBirth: '1988-01-01T00:00:00.000Z',
        status: 'ACTIVE',
      },
    ]);

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/patients']}>
          <Routes>
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<div>patient detail page</div>} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'خالد' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('خالد القحطاني')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('خالد القحطاني'));
    await waitFor(() => {
      expect(screen.getByText('patient detail page')).toBeTruthy();
    });
  });
});
