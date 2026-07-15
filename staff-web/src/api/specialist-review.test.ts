import { apiRequest } from './client';
import { listAvailableSamples, reserveSample, reviewSample, requestIntervention, completeIntervention } from './specialist-review';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('specialist-review API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listAvailableSamples fetches the queue', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listAvailableSamples();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/available-samples', { auth: true });
  });

  it('reserveSample posts to the reserve endpoint for a cycle', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    await reserveSample('cycle-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/reserve', { method: 'POST', auth: true });
  });

  it('reviewSample posts a TRANSITION decision', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1', decision: 'TRANSITION' });
    await reviewSample('patient-1', { decision: 'TRANSITION', clinicianOpinionScore: 7, reviewNotes: 'good' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/patients/patient-1/cycles/current/review', {
      method: 'POST',
      auth: true,
      body: { decision: 'TRANSITION', clinicianOpinionScore: 7, reviewNotes: 'good' },
    });
  });

  it('requestIntervention posts type and reason', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    await requestIntervention('cycle-1', { interventionType: 'VIDEO_MEETING', reasonNote: 'needs direct observation' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/intervention', {
      method: 'POST',
      auth: true,
      body: { interventionType: 'VIDEO_MEETING', reasonNote: 'needs direct observation' },
    });
  });

  it('completeIntervention posts outcome notes', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sample-1' });
    await completeIntervention('cycle-1', { outcomeNotes: 'observed session, improving' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/specialist-review/cycles/cycle-1/intervention/complete', {
      method: 'POST',
      auth: true,
      body: { outcomeNotes: 'observed session, improving' },
    });
  });
});
