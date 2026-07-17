import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ComplaintsScreen from '../complaints';
import { getMyComplaints } from '../../../src/api/complaints';
import { ApiError } from '../../../src/api/client';

const mockPush = jest.fn();
jest.mock('../../../src/api/complaints');
jest.mock('expo-router', () => {
  const actualReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => actualReact.useEffect(cb, []),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ComplaintsScreen', () => {
  it('renders the complaint history with type, subject, status, and date', async () => {
    (getMyComplaints as jest.Mock).mockResolvedValue([
      {
        id: 'complaint-1',
        type: 'COMPLAINT',
        subject: 'تأخر الرد من الأخصائي',
        description: 'لم يتم الرد خلال أسبوعين',
        status: 'OPEN',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ]);

    await render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    // See reports.test.tsx (commit 5241b81) and its several prior repeats for
    // why: under CPU-contended/cold-start conditions, RTL's default ~1s
    // waitFor timeout has been too tight even for mocked promises with no
    // real I/O — especially for the first test in a newly-added file.
    await waitFor(
      () => {
        expect(screen.getByText('شكاوى ومقترحاتي')).toBeTruthy();
        expect(screen.getByText('شكوى')).toBeTruthy();
        expect(screen.getByText('تأخر الرد من الأخصائي')).toBeTruthy();
        expect(screen.getByText('مفتوحة')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('shows the empty state when there are no complaints', async () => {
    (getMyComplaints as jest.Mock).mockResolvedValue([]);

    await render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('لا توجد شكاوى بعد')).toBeTruthy();
    });
  });

  it('shows an ErrorBanner when the fetch fails', async () => {
    (getMyComplaints as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    await render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
  });

  it('navigates to the submit screen when the "submit new complaint" link is pressed', async () => {
    (getMyComplaints as jest.Mock).mockResolvedValue([]);

    await render(<ThemeProvider><ComplaintsScreen /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('تقديم شكوى جديدة')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('تقديم شكوى جديدة'));

    expect(mockPush).toHaveBeenCalledWith('/program/complaint-submit');
  });
});
