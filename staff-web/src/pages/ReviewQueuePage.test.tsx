import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { ReviewQueuePage } from './ReviewQueuePage';
import { AuthProvider } from '../auth/AuthProvider';
import { listAvailableSamples, reserveSample } from '../api/specialist-review';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/specialist-review');
vi.mock('../api/auth');
vi.mock('../storage/session');

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const queueRow = {
  id: 'cycle-1',
  patientProfileId: 'patient-1',
  levelId: 'level-1',
  status: 'WAITING_FOR_SPECIALIST',
  speechSample: { id: 'sample-1', submittedAt: '2026-07-14T00:00:00.000Z', escalatedAt: null },
  patientProfile: { id: 'patient-1', fullName: 'مريض تجريبي' },
};

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <MemoryRouter>
        <AuthProvider>
          <ReviewQueuePage />
        </AuthProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviewQueuePage', () => {
  it('shows the empty state when there are no available samples', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('لا توجد عينات بانتظار المراجعة')).toBeTruthy();
    });
  });

  it('lists an available sample with the patient name', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([queueRow]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('مريض تجريبي')).toBeTruthy();
    });
  });

  it('reserves a sample and navigates to the patient detail page', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([queueRow]);
    (reserveSample as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('queue-row-cycle-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('reserve-button-cycle-1'));

    await waitFor(() => {
      expect(reserveSample).toHaveBeenCalledWith('cycle-1');
      expect(mockNavigate).toHaveBeenCalledWith('/patients/patient-1');
    });
  });

  it('does not fetch or render the queue for a SUPERVISOR (lacks REVIEW_SAMPLE)', async () => {
    (listAvailableSamples as ReturnType<typeof vi.fn>).mockResolvedValue([queueRow]);
    renderPage('SUPERVISOR');

    // Give any stray effect a tick to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(listAvailableSamples).not.toHaveBeenCalled();
    expect(screen.queryByText('مريض تجريبي')).toBeNull();
  });
});
