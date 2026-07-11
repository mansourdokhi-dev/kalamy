import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { forgotPassword } from '../api/auth';

vi.mock('../api/auth');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('submits the mobile number and calls forgotPassword', async () => {
    (forgotPassword as ReturnType<typeof vi.fn>).mockResolvedValue({});

    render(
      <MantineProvider>
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      </MantineProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('استعادة كلمة المرور')).toBeTruthy();
    }, { timeout: 3000 });

    fireEvent.change(screen.getByLabelText('رقم الجوال'), { target: { value: '+966500000001' } });
    fireEvent.click(screen.getByText('إرسال رمز التحقق'));

    await waitFor(() => {
      expect(forgotPassword).toHaveBeenCalledWith({ mobile: '+966500000001' });
    });
  });
});
