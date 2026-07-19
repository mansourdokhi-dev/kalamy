import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QuestionnaireResponsesSection } from './QuestionnaireResponsesSection';
import { PatientDetailProvider } from './PatientDetailContext';
import { AuthProvider } from '../auth/AuthProvider';
import { getPatient } from '../api/patients';
import { listResponses } from '../api/questionnaires';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/patients');
vi.mock('../api/questionnaires');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderSection(role: 'CLINICIAN' | 'ADMIN' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  (getPatient as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'patient-1', fullName: 'مريض', clinicalInfo: null });

  return render(
    <MantineProvider>
      <AuthProvider>
        <PatientDetailProvider patientId="patient-1">
          <QuestionnaireResponsesSection />
        </PatientDetailProvider>
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuestionnaireResponsesSection', () => {
  it('shows the empty state when there are no responses', async () => {
    (listResponses as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('لا توجد إجابات بعد')).toBeTruthy();
    });
  });

  it('renders a response with question text and answers', async () => {
    (listResponses as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'r1',
        templateId: 't1',
        patientProfileId: 'patient-1',
        submittedByUserId: 'patient-user',
        submittedAt: '2026-07-18T00:00:00.000Z',
        answers: [{ id: 'a1', questionId: 'q1', value: '7' }],
        template: {
          id: 't1',
          title: 'استبيان أسبوعي',
          description: null,
          isActive: true,
          createdAt: '2026-07-17T00:00:00.000Z',
          questions: [{ id: 'q1', templateId: 't1', order: 0, text: 'كيف تقيّم طلاقتك؟', type: 'SCALE', options: [], required: true }],
        },
      },
    ]);
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('استبيان أسبوعي')).toBeTruthy();
      expect(screen.getByText('كيف تقيّم طلاقتك؟')).toBeTruthy();
      expect(screen.getByText('7')).toBeTruthy();
    });
  });
});
