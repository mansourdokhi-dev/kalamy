import { apiRequest } from '../client';
import { getActiveQuestionnaires, submitQuestionnaire } from '../questionnaires';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('questionnaires API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getActiveQuestionnaires fetches the templates endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      { id: 't1', title: 'x', description: null, isActive: true, questions: [], createdAt: '2026-07-18T00:00:00.000Z' },
    ]);

    const result = await getActiveQuestionnaires();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/questionnaire-templates', { auth: true });
    expect(result).toHaveLength(1);
  });

  it('submitQuestionnaire posts the answers to the patient-scoped endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'r1' });

    const result = await submitQuestionnaire('profile-1', 't1', [{ questionId: 'q1', value: '7' }]);

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/questionnaire-responses', {
      method: 'POST',
      body: { templateId: 't1', answers: [{ questionId: 'q1', value: '7' }] },
      auth: true,
    });
    expect(result.id).toBe('r1');
  });
});
