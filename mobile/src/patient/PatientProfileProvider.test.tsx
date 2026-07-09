import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { PatientProfileProvider, usePatientProfile, computeAgeGroup } from './PatientProfileProvider';
import { getMyPatientProfile } from '../api/patients';

jest.mock('../api/patients');

function Consumer() {
  const { patientProfileId, loading, notFound, error } = usePatientProfile();
  const { ageGroup } = useTheme();
  if (loading) return <Text>loading</Text>;
  if (notFound) return <Text>not-found</Text>;
  if (error) return <Text>{error}</Text>;
  return <Text>{`${patientProfileId}:${ageGroup}`}</Text>;
}

describe('computeAgeGroup', () => {
  it('classifies under 13 as child, 13-17 as teen, 18+ as adult', () => {
    const now = new Date('2026-07-09');
    expect(computeAgeGroup('2015-01-01', now)).toBe('child');
    expect(computeAgeGroup('2010-01-01', now)).toBe('teen');
    expect(computeAgeGroup('1990-01-01', now)).toBe('adult');
  });
});

describe('PatientProfileProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the profile, exposes patientProfileId, and applies age-group theming', async () => {
    (getMyPatientProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      dateOfBirth: '2015-01-01',
    });

    render(
      <ThemeProvider>
        <PatientProfileProvider>
          <Consumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('profile-1:child')).toBeTruthy();
    });
  });

  it('exposes notFound when no profile exists yet', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    (getMyPatientProfile as jest.Mock).mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No patient profile exists for this user yet'));

    render(
      <ThemeProvider>
        <PatientProfileProvider>
          <Consumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('not-found')).toBeTruthy();
    });
  });

  it('exposes a generic error for a real failure', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    (getMyPatientProfile as jest.Mock).mockRejectedValue(new ApiError(500, 'UNKNOWN_ERROR', 'حدث خطأ غير متوقع'));

    render(
      <ThemeProvider>
        <PatientProfileProvider>
          <Consumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('حدث خطأ غير متوقع')).toBeTruthy();
    });
  });
});
