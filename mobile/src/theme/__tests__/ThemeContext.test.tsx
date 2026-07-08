import { render, screen, act, fireEvent } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { ThemeProvider, useTheme } from '../ThemeContext';

function Probe() {
  const { ageGroup, tokens, setAgeGroup } = useTheme();
  return (
    <>
      <Text testID="ageGroup">{ageGroup}</Text>
      <Text testID="primary">{tokens.colors.primary}</Text>
      <Pressable testID="toChild" onPress={() => setAgeGroup('child')} />
    </>
  );
}

describe('ThemeContext', () => {
  it('defaults to adult theme', async () => {
    await render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('ageGroup').props.children).toBe('adult');
  });

  it('switches tokens when setAgeGroup is called', async () => {
    await render(<ThemeProvider><Probe /></ThemeProvider>);
    const adultPrimary = screen.getByTestId('primary').props.children;
    await act(async () => {
      fireEvent.press(screen.getByTestId('toChild'));
    });
    const childPrimary = screen.getByTestId('primary').props.children;
    expect(childPrimary).not.toBe(adultPrimary);
    expect(screen.getByTestId('ageGroup').props.children).toBe('child');
  });
});
