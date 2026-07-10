import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import SampleRerecordScreen from '../sample-rerecord';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import { getCurrentCycle, uploadRecording, rerecordDamagedParts } from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

jest.mock('../../../src/components/AudioRecorder', () => ({
  AudioRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onRecorded('file:///mock-rerecording.m4a')}>
        <Text>SIMULATE_RECORD</Text>
      </Pressable>
    );
  },
}));

function mockCycleWithDamagedParts() {
  return {
    id: 'cycle-1',
    patientProfileId: 'profile-1',
    treatmentPlanId: 'plan-1',
    levelId: 'level-1',
    levelVersionId: 'version-1',
    cycleNumber: 1,
    status: 'TECHNICAL_PARTIAL_RERECORD',
    humanModelWatchedAt: '2026-07-01T00:00:00.000Z',
    firstTrainingEventAt: '2026-07-01T00:00:00.000Z',
    closedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    speechSample: {
      id: 'sample-1',
      trainingCycleId: 'cycle-1',
      selfSeverityCurrent: 5,
      selfSeverityExpectedNext: 5,
      camperdownPerformanceRating: 5,
      clientOpinionScore: 5,
      submittedAt: '2026-07-01T00:00:00.000Z',
      reviewedByUserId: 'clinician-1',
      clinicianOpinionScore: 4,
      reviewNotes: null,
      reviewedAt: '2026-07-02T00:00:00.000Z',
      decision: null,
      parts: [
        { id: 'part-1', partType: 'مقطع', label: 'مقطع 1', order: 1, recordingUrl: null, technicallyDamaged: true },
        { id: 'part-2', partType: 'كلمة', label: 'كلمة 1', order: 2, recordingUrl: 'https://example.com/ok.m4a', technicallyDamaged: false },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
});

describe('SampleRerecordScreen', () => {
  it('shows only the damaged parts, not the untouched ones', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue(mockCycleWithDamagedParts());

    render(<ThemeProvider><SampleRerecordScreen /></ThemeProvider>);

    // See home.test.tsx (commit 42da9d6) and history.test.tsx for why: under
    // CPU-contended/cold-start conditions (e.g. a freshly installed
    // node_modules with no jest transform cache yet), RTL's default ~1s
    // waitFor timeout has been too tight even for mocked promises with no
    // real I/O — especially for the first test in a file, which pays the
    // cost of transforming the module fresh.
    await waitFor(
      () => {
        expect(screen.getByText('مقطع 1')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByText('كلمة 1')).toBeNull();
  });

  it('uploads a re-recording for a damaged part and marks it as recorded', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue(mockCycleWithDamagedParts());
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'https://example.com/fixed.m4a' });

    render(<ThemeProvider><SampleRerecordScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('SIMULATE_RECORD')).toBeTruthy());
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));

    await waitFor(() => {
      expect(uploadRecording).toHaveBeenCalledWith('profile-1', 'file:///mock-rerecording.m4a');
      expect(screen.getByText('تم التسجيل')).toBeTruthy();
    });
  });

  it('keeps Submit disabled until every damaged part has a fresh recording, then submits with the correct shape', async () => {
    const cycleWithTwoDamaged = mockCycleWithDamagedParts();
    cycleWithTwoDamaged.speechSample.parts.push({
      id: 'part-3',
      partType: 'جملة',
      label: 'جملة 1',
      order: 3,
      recordingUrl: null,
      technicallyDamaged: true,
    });
    (getCurrentCycle as jest.Mock).mockResolvedValue(cycleWithTwoDamaged);
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'https://example.com/fixed.m4a' });
    (rerecordDamagedParts as jest.Mock).mockResolvedValue({ id: 'sample-1' });

    render(<ThemeProvider><SampleRerecordScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getAllByText('SIMULATE_RECORD')).toHaveLength(2));

    // Submit is disabled with only 1 of 2 damaged parts recorded
    fireEvent.press(screen.getAllByText('SIMULATE_RECORD')[0]);
    await waitFor(() => expect(screen.getAllByText('تم التسجيل')).toHaveLength(1));
    fireEvent.press(screen.getByText('إرسال'));
    expect(rerecordDamagedParts).not.toHaveBeenCalled();

    // Recording the second damaged part enables Submit
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));
    await waitFor(() => expect(screen.getAllByText('تم التسجيل')).toHaveLength(2));
    fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(rerecordDamagedParts).toHaveBeenCalledWith('profile-1', [
        { id: 'part-1', recordingUrl: 'https://example.com/fixed.m4a' },
        { id: 'part-3', recordingUrl: 'https://example.com/fixed.m4a' },
      ]);
    });
  });
});
