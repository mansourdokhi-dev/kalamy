import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ConsultationSection } from './ConsultationSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listConsultations, updateConsultation, listMySlots, createSlot } from '../api/consultations';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/consultations');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection() {
  (listMySlots as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role: 'CLINICIAN',
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <ConsultationSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConsultationSection', () => {
  it('shows the empty state when the patient has no consultation', async () => {
    (listConsultations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد طلبات استشارة')).toBeTruthy();
    });
  });

  it('renders a consultation and lets the clinician schedule it', async () => {
    (listConsultations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'c1',
        patientProfileId: 'patient-1',
        requestedByUserId: 'user-1',
        type: 'VOICE',
        status: 'REQUESTED',
        reasonNote: 'يحتاج مساعدة',
        scheduledAt: null,
        externalMeetingLink: null,
        specialistUserId: null,
        outcomeNotes: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
      },
    ]);
    (updateConsultation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c1', status: 'SCHEDULED' });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText('يحتاج مساعدة')).toBeTruthy();
    });

    // data-testid lands on the Select's own <input role="combobox"> — click it
    // directly to open the dropdown, then click the option (matches the proven
    // pattern in SampleReviewSection.test.tsx's transfer-target-select).
    fireEvent.click(screen.getByTestId('consultation-status-select'));
    fireEvent.click(await screen.findByText('مجدولة'));
    fireEvent.change(screen.getByTestId('consultation-link-input'), { target: { value: 'https://meet.example.com/x' } });
    fireEvent.click(screen.getByText('حفظ'));

    await waitFor(() => {
      expect(updateConsultation).toHaveBeenCalledWith('c1', { status: 'SCHEDULED', externalMeetingLink: 'https://meet.example.com/x' });
    });
  });

  it('does not render for a role without manage-consultation permission', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'staff-1',
      fullName: 'Staff Member',
      mobile: '+966500000000',
      role: 'ADMIN',
      mustChangePassword: false,
    });
    (listConsultations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد طلبات استشارة')).toBeTruthy();
    });
  });

  it('lets the clinician publish an availability slot', async () => {
    (listConsultations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (createSlot as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'slot-1', startsAt: '2026-08-01T10:00:00.000Z', durationMinutes: 30, status: 'AVAILABLE' });
    renderSection();

    await waitFor(() => expect(screen.getByTestId('new-slot-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('new-slot-input'), { target: { value: '2026-08-01T10:00' } });
    fireEvent.click(screen.getByTestId('publish-slot'));

    await waitFor(() => {
      expect(createSlot).toHaveBeenCalledWith(new Date('2026-08-01T10:00').toISOString());
    });
  });
});
