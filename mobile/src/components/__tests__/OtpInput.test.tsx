import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { OtpInput } from '../OtpInput';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('OtpInput', () => {
  it('renders one input per digit', async () => {
    await renderWithTheme(<OtpInput length={6} value="" onChange={() => {}} />);
    expect(screen.getAllByTestId(/otp-digit-/)).toHaveLength(6);
  });

  it('calls onComplete once all digits are entered', async () => {
    const onComplete = jest.fn();
    const onChange = jest.fn();
    await renderWithTheme(
      <OtpInput length={6} value="12345" onChange={onChange} onComplete={onComplete} />,
    );
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-digit-5'), '6');
    });
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('clearing a middle digit does not shift later digits', async () => {
    const onChange = jest.fn();
    await renderWithTheme(<OtpInput length={4} value="1234" onChange={onChange} />);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('otp-digit-1'), '');
    });
    expect(screen.getByTestId('otp-digit-2').props.value).toBe('3');
    expect(screen.getByTestId('otp-digit-3').props.value).toBe('4');
  });
});
