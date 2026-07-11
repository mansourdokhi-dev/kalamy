import { render, screen, waitFor } from '@testing-library/react';
import { PatientDetailProvider, usePatientDetail } from './PatientDetailContext';
import { getPatient } from '../api/patients';

vi.mock('../api/patients');

function Probe() {
  const { patient, loading, error } = usePatientDetail();
  if (loading) return <div>loading</div>;
  if (error) return <div>{error}</div>;
  return <div>{patient?.fullName}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PatientDetailProvider', () => {
  it('loads the patient on mount', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'patient-1',
      fullName: 'محمد العتيبي',
      clinicalInfo: null,
    });

    render(
      <PatientDetailProvider patientId="patient-1">
        <Probe />
      </PatientDetailProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('محمد العتيبي')).toBeTruthy();
    });
    expect(getPatient).toHaveBeenCalledWith('patient-1');
  });

  it('surfaces a load error', async () => {
    (getPatient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    render(
      <PatientDetailProvider patientId="patient-1">
        <Probe />
      </PatientDetailProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('تعذر تحميل بيانات المريض')).toBeTruthy();
    });
  });
});
