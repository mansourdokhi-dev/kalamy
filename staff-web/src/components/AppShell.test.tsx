import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { AppShell } from './AppShell';
import { AuthProvider } from '../auth/AuthProvider';
import { getMe } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('kalamy_staff_token', 'existing-token');
});

describe('AppShell', () => {
  it("shows the logged-in user's name and Arabic role label, and a Patients link", async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    render(
      <MantineProvider>
        <MemoryRouter>
          <AuthProvider>
            <AppShell>
              <div>page content</div>
            </AppShell>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Dr. Sara')).toBeTruthy();
      expect(screen.getByText('أخصائي')).toBeTruthy();
      expect(screen.getByText('المرضى')).toBeTruthy();
      expect(screen.getByText('page content')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('logs out when the logout button is pressed', async () => {
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    render(
      <MantineProvider>
        <MemoryRouter>
          <AuthProvider>
            <AppShell>
              <div>page content</div>
            </AppShell>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('تسجيل الخروج')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('تسجيل الخروج'));

    await waitFor(() => {
      expect(localStorage.getItem('kalamy_staff_token')).toBeNull();
    });
  });
});
