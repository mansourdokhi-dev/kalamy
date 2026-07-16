import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ComplaintsPage } from './ComplaintsPage';
import { AuthProvider } from '../auth/AuthProvider';
import { listComplaints, listMyComplaints, updateComplaintStatus } from '../api/complaints';
import { getMe } from '../api/auth';
import { getToken } from '../storage/session';

vi.mock('../api/complaints');
vi.mock('../api/auth');
vi.mock('../storage/session');

const complaintRow = {
  id: 'complaint-1',
  submittedByUserId: 'patient-user-1',
  relatedClinicianUserId: null,
  type: 'COMPLAINT' as const,
  subject: 'تأخر الموعد',
  description: 'تأخرت الجلسة عن موعدها المحدد',
  status: 'OPEN' as const,
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

function renderPage(role: 'CLINICIAN' | 'SUPERVISOR' | 'ADMIN' = 'CLINICIAN') {
  (getToken as ReturnType<typeof vi.fn>).mockReturnValue('token-123');
  (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'staff-1',
    fullName: 'Staff Member',
    mobile: '+966500000000',
    role,
    mustChangePassword: false,
  });

  return render(
    <MantineProvider>
      <AuthProvider>
        <ComplaintsPage />
      </AuthProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ComplaintsPage', () => {
  it('CLINICIAN sees only their own complaints via listMyComplaints, with no status control', async () => {
    (listMyComplaints as ReturnType<typeof vi.fn>).mockResolvedValue([complaintRow]);
    renderPage('CLINICIAN');

    await waitFor(() => expect(screen.getByTestId('complaint-row-complaint-1')).toBeTruthy());
    expect(listMyComplaints).toHaveBeenCalled();
    expect(listComplaints).not.toHaveBeenCalled();
    expect(screen.queryByTestId('complaint-status-select-complaint-1')).toBeNull();
    expect(screen.queryByTestId('status-filter-select')).toBeNull();
  });

  it('SUPERVISOR sees the full list via listComplaints, with a status control', async () => {
    (listComplaints as ReturnType<typeof vi.fn>).mockResolvedValue([complaintRow]);
    renderPage('SUPERVISOR');

    await waitFor(() => expect(screen.getByTestId('complaint-row-complaint-1')).toBeTruthy());
    expect(listComplaints).toHaveBeenCalledWith({});
    expect(screen.getByTestId('complaint-status-select-complaint-1')).toBeTruthy();
    expect(screen.getByTestId('status-filter-select')).toBeTruthy();
  });

  it('shows the empty state when there are no complaints', async () => {
    (listMyComplaints as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage('CLINICIAN');
    await waitFor(() => {
      expect(screen.getByText('لا توجد شكاوى')).toBeTruthy();
    });
  });

  it('updates status and refetches the list on success', async () => {
    (listComplaints as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([complaintRow])
      .mockResolvedValue([{ ...complaintRow, status: 'RESOLVED' }]);
    (updateComplaintStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...complaintRow, status: 'RESOLVED' });
    renderPage('ADMIN');

    await waitFor(() => expect(screen.getByTestId('complaint-status-select-complaint-1')).toBeTruthy());

    // Mantine Select's input is a read-only combobox — fireEvent.change on it
    // is silently ignored (same lesson already documented in
    // TreatmentPlanSection.test.tsx). Open it and click the option instead.
    // The data-testid is on the Select's input itself (which already has
    // role="combobox"), so click it directly rather than querying within it.
    fireEvent.click(screen.getByTestId('complaint-status-select-complaint-1'));
    // ADMIN also renders the status-filter Select, whose options include the
    // same "تم حلها" (RESOLVED) label, so two matches exist in the DOM at
    // once (Mantine keeps both dropdowns' option lists mounted; under jsdom's
    // Floating-UI positioning neither ever reports as "visible", per the
    // TreatmentPlanSection.test.tsx note above). Disambiguate by listbox:
    // the filter Select has a `label` prop, so its listbox carries
    // aria-labelledby; the per-row status Select has no label, so its
    // listbox doesn't.
    const resolvedOptions = await screen.findAllByText('تم حلها');
    const rowResolvedOption = resolvedOptions.find(
      (el) => !el.closest('[role="listbox"]')?.hasAttribute('aria-labelledby'),
    );
    fireEvent.click(rowResolvedOption!);

    await waitFor(() => {
      expect(updateComplaintStatus).toHaveBeenCalledWith('complaint-1', 'RESOLVED');
      expect(listComplaints).toHaveBeenCalledTimes(2);
    });
  });
});
