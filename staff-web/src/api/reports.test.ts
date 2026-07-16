import { apiRequest } from './client';
import {
  getAssessmentResultsReport,
  getMedicalReport,
  getOperationalStatusReport,
  getRegisteredUsersReport,
  getServiceModificationsReport,
  getStaffPerformanceReport,
  getComplaintsReport,
} from './reports';

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return { ...actual, apiRequest: vi.fn() };
});

describe('reports API functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('getAssessmentResultsReport fetches the patient-scoped endpoint', async () => {
    await getAssessmentResultsReport('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/patients/patient-1/assessment-results', { auth: true });
  });

  it('getMedicalReport fetches the patient-scoped endpoint', async () => {
    await getMedicalReport('patient-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/patients/patient-1/medical', { auth: true });
  });

  it('getOperationalStatusReport fetches with no params', async () => {
    await getOperationalStatusReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/operational-status', { auth: true });
  });

  it('getRegisteredUsersReport fetches with no params', async () => {
    await getRegisteredUsersReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/registered-users', { auth: true });
  });

  it('getServiceModificationsReport fetches with no query when filter is empty', async () => {
    await getServiceModificationsReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/service-modifications', { auth: true });
  });

  it('getServiceModificationsReport appends from/to as query params', async () => {
    await getServiceModificationsReport({ from: '2026-01-01', to: '2026-02-01' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/service-modifications?from=2026-01-01&to=2026-02-01', { auth: true });
  });

  it('getStaffPerformanceReport fetches with no params', async () => {
    await getStaffPerformanceReport();
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/staff-performance', { auth: true });
  });

  it('getComplaintsReport appends status and relatedClinicianUserId as query params', async () => {
    await getComplaintsReport({ status: 'OPEN', relatedClinicianUserId: 'clinician-1' });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/reports/complaints?status=OPEN&relatedClinicianUserId=clinician-1', { auth: true });
  });
});
