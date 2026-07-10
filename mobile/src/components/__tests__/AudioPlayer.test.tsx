import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { AudioPlayer } from '../AudioPlayer';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(),
  useAudioPlayerStatus: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AudioPlayer', () => {
  it('shows a play button and current/total time when paused', async () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ playing: false, currentTime: 0, duration: 12 });

    await render(<ThemeProvider><AudioPlayer uri="file:///tmp/a.m4a" /></ThemeProvider>);

    expect(screen.getByText('تشغيل')).toBeTruthy();
    expect(screen.getByText('0 ث / 12 ث')).toBeTruthy();
  });

  it('calls player.play() when the play button is pressed', async () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ playing: false, currentTime: 0, duration: 12 });

    await render(<ThemeProvider><AudioPlayer uri="file:///tmp/a.m4a" /></ThemeProvider>);
    await act(async () => {
      fireEvent.press(screen.getByText('تشغيل'));
    });

    expect(player.play).toHaveBeenCalled();
  });

  it('shows a pause button and calls player.pause() when pressed while playing', async () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ playing: true, currentTime: 4, duration: 12 });

    await render(<ThemeProvider><AudioPlayer uri="file:///tmp/a.m4a" /></ThemeProvider>);
    expect(screen.getByText('إيقاف مؤقت')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('إيقاف مؤقت'));
    });

    expect(player.pause).toHaveBeenCalled();
  });
});
