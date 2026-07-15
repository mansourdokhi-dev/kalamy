import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import NotificationsScreen from '../notifications';
import { getMyNotifications, markNotificationRead } from '../../../src/api/notifications';

jest.mock('../../../src/api/notifications');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

const unreadNotification = {
  id: 'n1',
  type: 'DAILY_TRAINING_REMINDER' as const,
  title: 'تذكير',
  body: 'أكمل تدريبك',
  relatedEntity: null,
  relatedEntityId: null,
  readAt: null,
  createdAt: '2026-07-15T00:00:00.000Z',
};

describe('NotificationsScreen', () => {
  it('shows an empty state when there are no notifications', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([]);

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد إشعارات بعد')).toBeTruthy();
    });
  });

  it('renders a notification\'s title and body', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([unreadNotification]);

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تذكير')).toBeTruthy();
      expect(screen.getByText('أكمل تدريبك')).toBeTruthy();
    });
  });

  it('marks an unread notification as read on tap', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([unreadNotification]);
    (markNotificationRead as jest.Mock).mockResolvedValue({ ...unreadNotification, readAt: '2026-07-15T01:00:00.000Z' });

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    await waitFor(() => {
      expect(screen.getByText('تذكير')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('تذكير'));

    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith('n1');
    });
  });

  it('does not call markNotificationRead when tapping an already-read notification', async () => {
    (getMyNotifications as jest.Mock).mockResolvedValue([{ ...unreadNotification, readAt: '2026-07-15T01:00:00.000Z' }]);

    render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    await waitFor(() => {
      expect(screen.getByText('تذكير')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('تذكير'));

    await waitFor(() => {
      expect(markNotificationRead).not.toHaveBeenCalled();
    });
  });
});
