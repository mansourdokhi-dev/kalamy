import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDetailPage } from './pages/PatientDetailPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientsPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/patients/:id"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientDetailPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/review-queue"
            element={
              <RequireAuth>
                <AppShell>
                  <ReviewQueuePage />
                </AppShell>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
