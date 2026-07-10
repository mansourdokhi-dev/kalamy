import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import SampleRecordingScreen from '../sample-recording';
import { usePatientProfile } from '../../../src/patient/PatientProfileProvider';
import {
  getCurrentCycle,
  getActiveLevelVersion,
  openSampleSession,
  listAttempts,
  recordAttempt,
  deleteAttempt,
  uploadRecording,
  submitSample,
} from '../../../src/api/treatmentEngine';

jest.mock('../../../src/patient/PatientProfileProvider');
jest.mock('../../../src/api/treatmentEngine');
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

jest.mock('../../../src/components/AudioRecorder', () => ({
  AudioRecorder: ({ onRecorded }: { onRecorded: (uri: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onRecorded('file:///mock-recording.m4a')}>
        <Text>SIMULATE_RECORD</Text>
      </Pressable>
    );
  },
}));

jest.mock('../../../src/components/AudioPlayer', () => ({
  AudioPlayer: () => {
    const { Text } = require('react-native');
    return <Text>MOCK_PLAYER</Text>;
  },
}));

function mockLevelVersion(samplePartTemplateJson: string) {
  return {
    id: 'version-1',
    levelId: 'level-1',
    versionNumber: 1,
    cognitiveVideo1Url: null,
    cognitiveVideo1Question: null,
    cognitiveVideo2Url: null,
    cognitiveVideo2Question: null,
    behavioralTechnique: 'x',
    humanModelVideoUrl: null,
    humanModelDurationSeconds: null,
    trainingListJson: '[]',
    samplePartTemplateJson,
    publishedAt: '2026-07-01T00:00:00.000Z',
  };
}

function mockAttempt(id: string, attemptNumber: number) {
  return {
    id,
    sampleSessionId: 'session-1',
    attemptNumber,
    recordingUrl: `https://example.com/${id}.m4a`,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

const twoPartsTemplate = JSON.stringify([
  { partType: 'مقطع', label: 'مقطع 1', order: 1, required: true },
  { partType: 'كلمة', label: 'كلمة 1', order: 2, required: true },
]);

beforeEach(() => {
  jest.clearAllMocks();
  (usePatientProfile as jest.Mock).mockReturnValue({ patientProfileId: 'profile-1', loading: false, notFound: false, error: null });
  (getActiveLevelVersion as jest.Mock).mockResolvedValue(mockLevelVersion(twoPartsTemplate));
});

describe('SampleRecordingScreen', () => {
  it('opens a new sample session when the cycle is SAMPLE_ELIGIBLE, then shows the required parts', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_ELIGIBLE' });
    (openSampleSession as jest.Mock).mockResolvedValue({ id: 'session-1', trainingCycleId: 'cycle-1', attemptsUsed: 0, status: 'OPEN' });
    (listAttempts as jest.Mock).mockResolvedValue([]);

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(openSampleSession).toHaveBeenCalledWith('profile-1');
      expect(screen.getByText('مقطع 1')).toBeTruthy();
      expect(screen.getByText('كلمة 1')).toBeTruthy();
    });
  });

  it('does not re-open a session when the cycle is already SAMPLE_PREPARATION, and lists existing attempts', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock).mockResolvedValue([mockAttempt('attempt-1', 1)]);

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(openSampleSession).not.toHaveBeenCalled();
      expect(screen.getByText('محاولة 1')).toBeTruthy();
    });
  });

  it('records a new attempt: uploads the file, records it, and refreshes the attempts list', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mockAttempt('attempt-1', 1)]);
    (uploadRecording as jest.Mock).mockResolvedValue({ url: 'https://example.com/attempt-1.m4a' });
    (recordAttempt as jest.Mock).mockResolvedValue(mockAttempt('attempt-1', 1));

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('SIMULATE_RECORD')).toBeTruthy());
    fireEvent.press(screen.getByText('SIMULATE_RECORD'));

    await waitFor(() => {
      expect(uploadRecording).toHaveBeenCalledWith('profile-1', 'file:///mock-recording.m4a');
      expect(recordAttempt).toHaveBeenCalledWith('profile-1', 'https://example.com/attempt-1.m4a');
      expect(screen.getByText('محاولة 1')).toBeTruthy();
    });
  });

  it('disables recording once 10 attempts exist', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    const tenAttempts = Array.from({ length: 10 }, (_, i) => mockAttempt(`attempt-${i}`, i + 1));
    (listAttempts as jest.Mock).mockResolvedValue(tenAttempts);

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('وصلت للحد الأقصى (10 محاولات)')).toBeTruthy();
    });
    expect(screen.queryByText('SIMULATE_RECORD')).toBeNull();
  });

  it('deletes an attempt and refreshes the list', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (listAttempts as jest.Mock)
      .mockResolvedValueOnce([mockAttempt('attempt-1', 1)])
      .mockResolvedValueOnce([]);
    (deleteAttempt as jest.Mock).mockResolvedValue({ ...mockAttempt('attempt-1', 1), deletedAt: '2026-07-01T00:00:00.000Z' });

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('محاولة 1')).toBeTruthy());
    fireEvent.press(screen.getByText('حذف'));

    await waitFor(() => {
      expect(deleteAttempt).toHaveBeenCalledWith('profile-1', 'attempt-1');
      expect(screen.queryByText('محاولة 1')).toBeNull();
    });
  });

  it('gates Step 2/3 progression on part assignment, then submits with the correct shape', async () => {
    (getCurrentCycle as jest.Mock).mockResolvedValue({ id: 'cycle-1', levelId: 'level-1', status: 'SAMPLE_PREPARATION' });
    (getActiveLevelVersion as jest.Mock).mockResolvedValue(
      mockLevelVersion(JSON.stringify([{ partType: 'مقطع', label: 'مقطع 1', order: 1, required: true }])),
    );
    (listAttempts as jest.Mock).mockResolvedValue([mockAttempt('attempt-1', 1)]);
    (submitSample as jest.Mock).mockResolvedValue({ id: 'sample-1' });

    render(<ThemeProvider><SampleRecordingScreen /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('محاولة 1')).toBeTruthy());

    fireEvent.press(screen.getByText('التالي'));
    await waitFor(() => expect(screen.getByText('اختر التسجيل المناسب لكل جزء')).toBeTruthy());

    // Step 2's own Next is disabled until the single required part is assigned
    fireEvent.press(screen.getByText('التالي'));
    expect(screen.queryByText('تقييمك الذاتي')).toBeNull();

    fireEvent.press(screen.getByText('محاولة 1'));
    await waitFor(() => expect(screen.queryByText('تقييمك الذاتي')).toBeNull());
    fireEvent.press(screen.getByText('التالي'));
    await waitFor(() => expect(screen.getByText('تقييمك الذاتي')).toBeTruthy());

    fireEvent.press(screen.getByText('إرسال العينة'));

    await waitFor(() => {
      expect(submitSample).toHaveBeenCalledWith('profile-1', {
        parts: [{ partType: 'مقطع', label: 'مقطع 1', order: 1, sourceAttemptId: 'attempt-1' }],
        selfSeverityCurrent: 5,
        selfSeverityExpectedNext: 5,
        camperdownPerformanceRating: 5,
        clientOpinionScore: 5,
      });
    });
  });
});
