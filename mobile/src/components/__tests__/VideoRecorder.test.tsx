import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { VideoRecorder } from '../VideoRecorder';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

jest.mock('expo-camera', () => ({
  CameraView: (() => {
    const React = require('react');
    const { View } = require('react-native');
    return React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        recordAsync: jest.fn(() => Promise.resolve({ uri: 'file:///tmp/video-1.mp4' })),
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
});
