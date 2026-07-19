import { apiRequest } from '../client';
import { getMessages, sendMessage } from '../messages';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('messages API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMessages fetches the patient-scoped thread endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      { id: 'm1', patientProfileId: 'profile-1', senderUserId: 'user-1', body: 'hi', readAt: null, createdAt: '2026-07-17T00:00:00.000Z' },
    ]);

    const result = await getMessages('profile-1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/messages', { auth: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('sendMessage posts the body to the patient-scoped endpoint', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ id: 'm2', patientProfileId: 'profile-1', senderUserId: 'user-1', body: 'hello', readAt: null, createdAt: '2026-07-17T00:00:00.000Z' });

    const result = await sendMessage('profile-1', 'hello');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/profile-1/messages', { method: 'POST', body: { body: 'hello' }, auth: true });
    expect(result.id).toBe('m2');
  });
});
