import { apiRequest } from '../client';
import { getMyConsultations, requestConsultation } from '../consultations';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('consultations API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMyConsultations fetches the patient-scoped list endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      {
        id: 'c1',
        patientProfileId: 'profile-1',
        requestedByUserId: 'user-1',
        type: 'VOICE',
        status: 'REQUESTED',
        reasonNote: 'x',
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

    const result = await getMyConsultations('profile-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/consultations', { auth: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('requestConsultation POSTs the type and reasonNote', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'c2', status: 'REQUESTED' });

    const result = await requestConsultation('profile-1', { type: 'VIDEO', reasonNote: 'Need guidance' });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/consultations', {
      method: 'POST',
      body: { type: 'VIDEO', reasonNote: 'Need guidance' },
      auth: true,
    });
    expect(result.id).toBe('c2');
  });
});
