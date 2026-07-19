import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QuestionnairesPage } from './QuestionnairesPage';
import { AuthProvider } from '../auth/AuthProvider';
import { listTemplates, createTemplate, setTemplateActive } from '../api/questionnaires';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/questionnaires');
vi.mock('../api/auth');
vi.mock('../storage/session');

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });
  return render(
    <MantineProvider>
      <AuthProvider>
        <QuestionnairesPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QuestionnairesPage', () => {
  it('lists existing templates', async () => {
    (listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 't1', title: 'استبيان أسبوعي', description: null, isActive: true, questions: [{ id: 'q1', templateId: 't1', order: 0, text: 'x', type: 'TEXT', options: [], required: true }], createdAt: '2026-07-18T00:00:00.000Z' },
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('استبيان أسبوعي')).toBeTruthy();
      expect(screen.getByTestId('template-t1')).toBeTruthy();
    });
  });

  it('creates a template with a question', async () => {
    (listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (createTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't2', title: 'جديد', description: null, isActive: true, questions: [], createdAt: '2026-07-18T00:00:00.000Z' });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('template-title')).toBeTruthy());
    fireEvent.change(screen.getByTestId('template-title'), { target: { value: 'استبيان جديد' } });
    fireEvent.change(screen.getByTestId('question-text-0'), { target: { value: 'كيف حالك؟' } });
    fireEvent.click(screen.getByTestId('create-template'));

    await waitFor(() => {
      expect(createTemplate).toHaveBeenCalledWith({
        title: 'استبيان جديد',
        description: undefined,
        questions: [{ text: 'كيف حالك؟', type: 'TEXT', required: true, options: undefined }],
      });
    });
  });

  it('toggles a template active state', async () => {
    (listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 't1', title: 'استبيان', description: null, isActive: true, questions: [], createdAt: '2026-07-18T00:00:00.000Z' },
    ]);
    (setTemplateActive as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', isActive: false });
    renderPage();

    await waitFor(() => expect(screen.getByText('إلغاء التفعيل')).toBeTruthy());
    fireEvent.click(screen.getByText('إلغاء التفعيل'));

    await waitFor(() => {
      expect(setTemplateActive).toHaveBeenCalledWith('t1', false);
    });
  });

  it('shows an access error for a role without manage permission', async () => {
    (listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('SUPERVISOR');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByTestId('template-title')).toBeNull();
  });
});
