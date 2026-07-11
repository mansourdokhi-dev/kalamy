import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from './RequireAuth';
import { AuthProvider } from './AuthProvider';
import { getMe } from '../api/auth';

vi.mock('../api/auth');

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/change-password" element={<div>change password page</div>} />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <div>patients page</div>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('RequireAuth', () => {
  it('redirects to /login when there is no logged-in user', async () => {
    renderAt('/patients');

    await waitFor(() => {
      expect(screen.getByText('login page')).toBeTruthy();
    });
  });

  it('redirects to /change-password when the user must change their password', async () => {
    localStorage.setItem('kalamy_staff_token', 'existing-token');
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: true });

    renderAt('/patients');

    await waitFor(() => {
      expect(screen.getByText('change password page')).toBeTruthy();
    });
  });

  it('renders the protected content when logged in and mustChangePassword is false', async () => {
    localStorage.setItem('kalamy_staff_token', 'existing-token');
    (getMe as ReturnType<typeof vi.fn>).mockResolvedValue({ id: '1', fullName: 'Dr. Sara', mobile: '+966500000001', role: 'CLINICIAN', mustChangePassword: false });

    renderAt('/patients');

    await waitFor(() => {
      expect(screen.getByText('patients page')).toBeTruthy();
    });
  });
});
