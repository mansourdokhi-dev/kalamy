import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { TextField } from '../TextField';

describe('TextField', () => {
  it('calls onChangeText when typing', async () => {
    const onChangeText = jest.fn();
    await render(
      <ThemeProvider>
        <TextField label="الجوال" value="" onChangeText={onChangeText} testID="mobile-input" />
      </ThemeProvider>,
    );
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('mobile-input'), '+966500000001');
    });
    expect(onChangeText).toHaveBeenCalledWith('+966500000001');
  });

  it('shows the error message when provided', async () => {
    await render(
      <ThemeProvider>
        <TextField label="الجوال" value="" onChangeText={() => {}} error="رقم غير صحيح" />
      </ThemeProvider>,
    );
    expect(screen.getByText('رقم غير صحيح')).toBeTruthy();
  });
});
