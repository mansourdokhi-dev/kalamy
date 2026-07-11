import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
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
        <PatientsPage />
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
        <PatientsPage />
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
        <PatientsPage />
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
        <PatientsPage />
      </MantineProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو رقم الهوية'), { target: { value: 'a' } });
    fireEvent.submit(screen.getByTestId('patient-search-form'));

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
  });
});
