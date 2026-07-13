import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
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

  describe('on web', () => {
    const originalFetch = global.fetch;
    const originalCreateObjectURL = global.URL.createObjectURL;
    const originalRevokeObjectURL = global.URL.revokeObjectURL;

    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      global.fetch = originalFetch;
      global.URL.createObjectURL = originalCreateObjectURL;
      global.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('fetches the video with the auth header and passes a blob object URL to useVideoPlayer, not a headers-based source', async () => {
      (getToken as jest.Mock).mockResolvedValue('token-123');
      const fakeBlob = { fake: 'blob' };
      global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(fakeBlob) });
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-object-url');
      global.URL.revokeObjectURL = jest.fn();
      (useVideoPlayer as jest.Mock).mockReturnValue({ play: jest.fn(), pause: jest.fn(), playing: false });
      (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

      await render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByTestId('video-view')).toBeTruthy();
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/patients/p1/sample-parts/part-1/media'),
        expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } })
      );
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(fakeBlob);
      const [source] = (useVideoPlayer as jest.Mock).mock.calls[(useVideoPlayer as jest.Mock).mock.calls.length - 1];
      expect(source).toBe('blob:mock-object-url');
    });

    it('revokes the object URL on unmount', async () => {
      (getToken as jest.Mock).mockResolvedValue('token-123');
      global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve({}) });
      global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-object-url');
      global.URL.revokeObjectURL = jest.fn();
      (useVideoPlayer as jest.Mock).mockReturnValue({ play: jest.fn(), pause: jest.fn(), playing: false });
      (useEvent as jest.Mock).mockReturnValue({ isPlaying: false });

      const result = await render(<ThemeProvider><VideoPlayer path="/api/v1/patients/p1/sample-parts/part-1/media" /></ThemeProvider>);
      await waitFor(() => {
        expect(screen.getByTestId('video-view')).toBeTruthy();
      });

      await result.unmount();

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-object-url');
    });
  });
});
