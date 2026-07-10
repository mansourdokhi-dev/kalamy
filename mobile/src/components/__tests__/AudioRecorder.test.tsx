import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { AudioRecorder } from '../AudioRecorder';
import { useAudioRecorder, useAudioRecorderState, requestRecordingPermissionsAsync } from 'expo-audio';

jest.mock('expo-audio', () => ({
  useAudioRecorder: jest.fn(),
  useAudioRecorderState: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(),
}));

function mockRecorder(overrides: Partial<{ uri: string | null }> = {}) {
  return {
    uri: overrides.uri ?? null,
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
  };
}

function mockState(overrides: Partial<{ isRecording: boolean; durationMillis: number }> = {}) {
  return { isRecording: overrides.isRecording ?? false, durationMillis: overrides.durationMillis ?? 0, canRecord: true };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AudioRecorder', () => {
  it('requests mic permission and starts recording on first press when permission is granted', async () => {
    const recorder = mockRecorder();
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState());
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    const onRecorded = jest.fn();

    await render(<ThemeProvider><AudioRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('ابدأ التسجيل'));

    await waitFor(() => {
      expect(recorder.prepareToRecordAsync).toHaveBeenCalled();
      expect(recorder.record).toHaveBeenCalled();
    });
  });

  it('shows a permission-denied message and does not start recording when permission is refused', async () => {
    const recorder = mockRecorder();
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState());
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    await render(<ThemeProvider><AudioRecorder onRecorded={jest.fn()} /></ThemeProvider>);
    fireEvent.press(screen.getByText('ابدأ التسجيل'));

    await waitFor(() => {
      expect(screen.getByText('يلزم الوصول إلى الميكروفون لتسجيل عينتك')).toBeTruthy();
    });
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('stops recording and calls onRecorded with the resulting uri when pressed again while recording', async () => {
    const recorder = mockRecorder({ uri: 'file:///tmp/recording-1.m4a' });
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState({ isRecording: true, durationMillis: 5000 }));
    const onRecorded = jest.fn();

    await render(<ThemeProvider><AudioRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('إيقاف التسجيل'));

    await waitFor(() => {
      expect(recorder.stop).toHaveBeenCalled();
      expect(onRecorded).toHaveBeenCalledWith('file:///tmp/recording-1.m4a');
    });
  });

  it('auto-stops and calls onRecorded once the 3-minute cap is reached', async () => {
    const recorder = mockRecorder({ uri: 'file:///tmp/recording-2.m4a' });
    (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
    (useAudioRecorderState as jest.Mock).mockReturnValue(mockState({ isRecording: true, durationMillis: 3 * 60 * 1000 }));
    const onRecorded = jest.fn();

    await render(<ThemeProvider><AudioRecorder onRecorded={onRecorded} /></ThemeProvider>);

    await waitFor(() => {
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      expect(onRecorded).toHaveBeenCalledWith('file:///tmp/recording-2.m4a');
    });
  });
});
