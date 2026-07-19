import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MessagesSection } from './MessagesSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listMessages, sendMessage } from '../api/messages';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/messages');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <MessagesSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessagesSection', () => {
  it('shows the empty state when there are no messages', async () => {
    (listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد رسائل بعد')).toBeTruthy();
    });
  });

  it('renders the thread and labels own vs patient messages', async () => {
    (listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', patientProfileId: 'patient-1', senderUserId: 'patient-user', body: 'سؤال المريض', readAt: null, createdAt: '2026-07-17T00:00:00.000Z' },
      { id: 'm2', patientProfileId: 'patient-1', senderUserId: 'staff-1', body: 'رد الأخصائي', readAt: '2026-07-18T00:00:00.000Z', createdAt: '2026-07-17T01:00:00.000Z' },
    ]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('سؤال المريض')).toBeTruthy();
      expect(screen.getByText('رد الأخصائي')).toBeTruthy();
      expect(screen.getByText('المريض')).toBeTruthy();
      expect(screen.getByText('أنا')).toBeTruthy();
      expect(screen.getByText('تم الاطلاع')).toBeTruthy();
    });
  });

  it('sends a message', async () => {
    (listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1', patientProfileId: 'patient-1', senderUserId: 'staff-1', body: 'مرحبا', readAt: null, createdAt: '2026-07-17T00:00:00.000Z' });
    renderSection();

    await waitFor(() => expect(screen.getByTestId('message-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('message-input'), { target: { value: 'مرحبا' } });
    fireEvent.click(screen.getByText('إرسال'));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('patient-1', 'مرحبا');
    });
  });

  it('does not render for a non-clinician staff role', async () => {
    (listMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection('SUPERVISOR');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByText('المحادثة مع المريض')).toBeNull();
    expect(listMessages).not.toHaveBeenCalled();
  });
});
