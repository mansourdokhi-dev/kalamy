import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('redirects to the login route and renders it', () => {
    render(<App />);
    expect(screen.getByText('تسجيل الدخول')).toBeTruthy();
  });
});
