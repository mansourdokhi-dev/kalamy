import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import App from './App';

describe('App', () => {
  it('redirects to the login route and renders it', async () => {
    render(
      <MantineProvider>
        <App />
      </MantineProvider>,
    );
    expect(await screen.findByText('تسجيل دخول الطاقم الطبي')).toBeTruthy();
  });
});
