import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { VideoPlayer } from '../VideoPlayer';
import { useVideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { getToken } from '../../storage/session';

jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(),
  VideoView: () => {
    const { View } = require('react-native');
    return <View testID="video-view" />;
  },
}));

jest.mock('expo', () => ({
  useEvent: jest.fn(),
}));

jest.mock('../../storage/session', () => ({
  getToken: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VideoPlayer', () => {
  it('resolves the auth token before rendering, and passes an authenticated source to useVideoPlayer', async () => {
    (getToken as jest.Mock).mockResolvedValue('token-123');
    const player = { play: jest.fn(), pause: jest.fn(), playing: false };
    (useVideoPlayer as jest.Mock).mockReturnValue(player);
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

    await render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByTestId('video-view')).toBeTruthy();
    });
    const [source] = (useVideoPlayer as jest.Mock).mock.calls[(useVideoPlayer as jest.Mock).mock.calls.length - 1];
    expect(source).toEqual({
      uri: expect.stringContaining('/api/v1/patients/p1/sample-parts/part-1/media'),
      headers: { Authorization: 'Bearer token-123' },
    });
  });

  it('renders nothing until the token has resolved', async () => {
    (getToken as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves within this test
    (useVideoPlayer as jest.Mock).mockReturnValue({ play: jest.fn(), pause: jest.fn(), playing: false });
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

    await render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);

    expect(screen.queryByTestId('video-view')).toBeNull();
  });

  it('calls player.play() when the play button is pressed', async () => {
    (getToken as jest.Mock).mockResolvedValue('token-123');
    const player = { play: jest.fn(), pause: jest.fn(), playing: false };
    (useVideoPlayer as jest.Mock).mockReturnValue(player);
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

    await render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('تشغيل')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('تشغيل'));
    });

    expect(player.play).toHaveBeenCalled();
  });

  it('shows a pause button and calls player.pause() when playing', async () => {
    (getToken as jest.Mock).mockResolvedValue('token-123');
    const player = { play: jest.fn(), pause: jest.fn(), playing: true };
    (useVideoPlayer as jest.Mock).mockReturnValue(player);
    (useEvent as jest.Mock).mockReturnValue({ isPlaying: true });

    await render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('إيقاف مؤقت')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText('إيقاف مؤقت'));
    });

    expect(player.pause).toHaveBeenCalled();
  });
});
