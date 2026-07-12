import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { VideoRecorder } from '../VideoRecorder';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

// By default recordAsync() resolves right away, which is what the existing
// tests rely on. The re-entrancy test below swaps in a controllable resolver
// so it can hold the first recordAsync() call open while it exercises a
// rapid stop-then-start re-press against it.
let mockRecordAsyncCallCount = 0;
let mockRecordAsyncImpl: () => Promise<{ uri: string }> = () => Promise.resolve({ uri: 'file:///tmp/video-1.mp4' });

jest.mock('expo-camera', () => ({
  CameraView: (() => {
    const React = require('react');
    const { View } = require('react-native');
    return React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        recordAsync: jest.fn(() => {
          mockRecordAsyncCallCount += 1;
          return mockRecordAsyncImpl();
        }),
        stopRecording: jest.fn(),
      }));
      return <View testID="camera-view" />;
    });
  })(),
  useCameraPermissions: jest.fn(),
  useMicrophonePermissions: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordAsyncCallCount = 0;
  mockRecordAsyncImpl = () => Promise.resolve({ uri: 'file:///tmp/video-1.mp4' });
});

describe('VideoRecorder', () => {
  it('requests camera and microphone permission on first press, shows the camera view once granted', async () => {
    const requestCamera = jest.fn().mockResolvedValue({ granted: true });
    const requestMic = jest.fn().mockResolvedValue({ granted: true });
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false }, requestCamera]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: false }, requestMic]);

    await render(<ThemeProvider><VideoRecorder onRecorded={jest.fn()} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));

    await waitFor(() => {
      expect(requestCamera).toHaveBeenCalled();
      expect(requestMic).toHaveBeenCalled();
      expect(screen.getByTestId('camera-view')).toBeTruthy();
    });
  });

  it('shows a permission-denied message when either permission is refused', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false }, jest.fn().mockResolvedValue({ granted: false })]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: false }, jest.fn().mockResolvedValue({ granted: true })]);

    await render(<ThemeProvider><VideoRecorder onRecorded={jest.fn()} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));

    await waitFor(() => {
      expect(screen.getByText('يلزم الوصول إلى الكاميرا والميكروفون لتسجيل عينتك')).toBeTruthy();
    });
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('starts recording, stops on press, and calls onRecorded with uri and duration', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    const onRecorded = jest.fn();

    await render(<ThemeProvider><VideoRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));
    await waitFor(() => expect(screen.getByTestId('camera-view')).toBeTruthy());

    fireEvent.press(screen.getByText('ابدأ التسجيل'));
    await waitFor(() => expect(screen.getByText('إيقاف التسجيل')).toBeTruthy());
    fireEvent.press(screen.getByText('إيقاف التسجيل'));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledWith('file:///tmp/video-1.mp4', expect.any(Number));
    });
  });

  it('blocks a second recordAsync() call fired by a rapid stop-then-start re-press', async () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
    const onRecorded = jest.fn();

    // Hold the first recordAsync() call open (it won't resolve until the
    // test explicitly resolves it below), simulating the native recording
    // still finishing in the background after the user has pressed stop.
    let resolveFirstRecording: ((value: { uri: string }) => void) | undefined;
    mockRecordAsyncImpl = () => new Promise((resolve) => { resolveFirstRecording = resolve; });

    await render(<ThemeProvider><VideoRecorder onRecorded={onRecorded} /></ThemeProvider>);
    fireEvent.press(screen.getByText('تفعيل الكاميرا'));
    await waitFor(() => expect(screen.getByTestId('camera-view')).toBeTruthy());

    fireEvent.press(screen.getByText('ابدأ التسجيل'));
    await waitFor(() => expect(screen.getByText('إيقاف التسجيل')).toBeTruthy());
    expect(mockRecordAsyncCallCount).toBe(1);

    // Press stop (flips the UI back to "start" immediately) and then press
    // start again right away, while the first recordAsync() call is still
    // unresolved. Without the re-entrancy guard this fires a second,
    // concurrent recordAsync() call.
    fireEvent.press(screen.getByText('إيقاف التسجيل'));
    await waitFor(() => expect(screen.getByText('ابدأ التسجيل')).toBeTruthy());
    fireEvent.press(screen.getByText('ابدأ التسجيل'));

    expect(mockRecordAsyncCallCount).toBe(1);

    // Now let the first (and only) recordAsync() call settle and confirm the
    // component recovers normally and reports exactly one recording.
    resolveFirstRecording?.({ uri: 'file:///tmp/video-1.mp4' });
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
    expect(onRecorded).toHaveBeenCalledWith('file:///tmp/video-1.mp4', expect.any(Number));
  });
});
