import { Text, Pressable } from 'react-native';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
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

function RefreshConsumer() {
  const { patientProfileId, notFound, refresh } = usePatientProfile();
  return (
    <>
      <Text>{notFound ? 'not-found' : `id:${patientProfileId}`}</Text>
      <Pressable testID="refresh" onPress={() => refresh()}>
        <Text>refresh</Text>
      </Pressable>
    </>
  );
}

describe('computeAgeGroup', () => {
  it('classifies under 13 as child, 13-17 as teen, 18+ as adult', () => {
    const now = new Date('2026-07-09');
    expect(computeAgeGroup('2015-01-01', now)).toBe('child');
    expect(computeAgeGroup('2010-01-01', now)).toBe('teen');
    expect(computeAgeGroup('1990-01-01', now)).toBe('adult');
  });

  it('is not affected by timezone-sensitive date parsing near a January 1st birthday', () => {
    const now = new Date('2026-12-15');
    // Born 2015-01-01: turned 11 on 2026-01-01, hasn't had a 2027 birthday yet, so age is 11 -> child.
    expect(computeAgeGroup('2015-01-01', now)).toBe('child');
  });
});

describe('PatientProfileProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the profile, exposes patientProfileId, and applies age-group theming', async () => {
    (getMyPatientProfile as jest.Mock).mockResolvedValue({
      id: 'profile-1',
      dateOfBirth: '2015-01-01',
    });

    await render(
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

    await render(
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

  it('re-fetches when refresh() is called (e.g. after login), recovering from an initial not-found', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    // First mount (logged out / no profile) rejects; after login the same call succeeds.
    (getMyPatientProfile as jest.Mock)
      .mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'No patient profile exists for this user yet'))
      .mockResolvedValueOnce({ id: 'profile-9', dateOfBirth: '1990-01-01' });

    await render(
      <ThemeProvider>
        <PatientProfileProvider>
          <RefreshConsumer />
        </PatientProfileProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('not-found')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('refresh'));

    await waitFor(() => {
      expect(screen.getByText('id:profile-9')).toBeTruthy();
    });
  });

  it('exposes a generic error for a real failure', async () => {
    const { ApiError } = jest.requireActual('../api/client');
    (getMyPatientProfile as jest.Mock).mockRejectedValue(new ApiError(500, 'UNKNOWN_ERROR', 'حدث خطأ غير متوقع'));

    await render(
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
