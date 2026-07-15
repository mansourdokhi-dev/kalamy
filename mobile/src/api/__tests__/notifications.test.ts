import { apiRequest } from '../client';
import { getMyNotifications, markNotificationRead } from '../notifications';

jest.mock('../client', () => ({
  ...jest.requireActual('../client'),
  apiRequest: jest.fn(),
}));

describe('notifications API functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMyNotifications fetches the notifications list', async () => {
    (apiRequest as jest.Mock).mockResolvedValue([
      {
        id: 'n1',
        type: 'DAILY_TRAINING_REMINDER',
        title: 't',
        body: 'b',
        relatedEntity: null,
        relatedEntityId: null,
        readAt: null,
        createdAt: '2026-07-15T00:00:00.000Z',
      },
    ]);

    const result = await getMyNotifications();

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/notifications', { auth: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });

  it('markNotificationRead patches the read endpoint for the given id', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({
      id: 'n1',
      type: 'DAILY_TRAINING_REMINDER',
      title: 't',
      body: 'b',
      relatedEntity: null,
      relatedEntityId: null,
      readAt: '2026-07-15T01:00:00.000Z',
      createdAt: '2026-07-15T00:00:00.000Z',
    });

    const result = await markNotificationRead('n1');

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/notifications/n1/read', { method: 'PATCH', auth: true });
    expect(result.readAt).toBe('2026-07-15T01:00:00.000Z');
  });
});
