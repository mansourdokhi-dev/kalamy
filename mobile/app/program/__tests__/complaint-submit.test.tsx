import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../src/theme/ThemeContext';
import ComplaintSubmitScreen from '../complaint-submit';
import { submitComplaint } from '../../../src/api/complaints';
import { ApiError } from '../../../src/api/client';

const mockBack = jest.fn();
jest.mock('../../../src/api/complaints');
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: mockBack }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ComplaintSubmitScreen', () => {
  it('does not submit until both subject and description are filled, then submits with the default COMPLAINT type', async () => {
    await render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    // See reports.test.tsx (commit 5241b81) and its several prior repeats for
    // why: under CPU-contended/cold-start conditions, RTL's default ~1s
    // waitFor timeout has been too tight even for mocked promises with no
    // real I/O — especially for the first test in a newly-added file.
    await waitFor(
      () => {
        expect(screen.getByText('إرسال')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    await fireEvent.press(screen.getByText('إرسال'));
    expect(submitComplaint).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('subject-input'), 'موضوع الشكوى');
    await fireEvent.press(screen.getByText('إرسال'));
    expect(submitComplaint).not.toHaveBeenCalled();

    (submitComplaint as jest.Mock).mockResolvedValue({
      id: 'complaint-1',
      type: 'COMPLAINT',
      subject: 'موضوع الشكوى',
      description: 'وصف الشكوى بالتفصيل',
      status: 'OPEN',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    await fireEvent.changeText(screen.getByTestId('description-input'), 'وصف الشكوى بالتفصيل');
    await fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(submitComplaint).toHaveBeenCalledWith({
        type: 'COMPLAINT',
        subject: 'موضوع الشكوى',
        description: 'وصف الشكوى بالتفصيل',
      });
    });
  });

  it('navigates back after a successful submission', async () => {
    (submitComplaint as jest.Mock).mockResolvedValue({
      id: 'complaint-1',
      type: 'COMPLAINT',
      subject: 'a',
      description: 'b',
      status: 'OPEN',
      createdAt: '2026-07-10T00:00:00.000Z',
    });

    await render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    await fireEvent.changeText(screen.getByTestId('subject-input'), 'a');
    await fireEvent.changeText(screen.getByTestId('description-input'), 'b');
    await fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
  });

  it('submits with type SUGGESTION when the suggestion option is selected first', async () => {
    (submitComplaint as jest.Mock).mockResolvedValue({
      id: 'complaint-1',
      type: 'SUGGESTION',
      subject: 'a',
      description: 'b',
      status: 'OPEN',
      createdAt: '2026-07-10T00:00:00.000Z',
    });

    await render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    await fireEvent.press(screen.getByTestId('type-suggestion'));
    await fireEvent.changeText(screen.getByTestId('subject-input'), 'a');
    await fireEvent.changeText(screen.getByTestId('description-input'), 'b');
    await fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(submitComplaint).toHaveBeenCalledWith({ type: 'SUGGESTION', subject: 'a', description: 'b' });
    });
  });

  it('shows an ErrorBanner and preserves entered values when submission fails', async () => {
    (submitComplaint as jest.Mock).mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'Something broke'));

    await render(<ThemeProvider><ComplaintSubmitScreen /></ThemeProvider>);

    await fireEvent.changeText(screen.getByTestId('subject-input'), 'a');
    await fireEvent.changeText(screen.getByTestId('description-input'), 'b');
    await fireEvent.press(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(screen.getByText('Something broke')).toBeTruthy();
    });
    expect(screen.getByTestId('subject-input').props.value).toBe('a');
    expect(screen.getByTestId('description-input').props.value).toBe('b');
  });
});
