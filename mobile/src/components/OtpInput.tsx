import { View, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface OtpInputProps {
  length: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
}

export function OtpInput({ length, value, onChange, onComplete }: OtpInputProps) {
  const { tokens } = useTheme();
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function handleChangeDigit(index: number, digit: string) {
    const nextDigits = [...digits];
    nextDigits[index] = digit.slice(-1);
    const nextValue = nextDigits.join('');
    onChange(nextValue);
    if (nextValue.length === length && onComplete) {
      onComplete(nextValue);
    }
  }

  return (
    <View style={styles.row}>
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          testID={`otp-digit-${index}`}
          value={digit}
          onChangeText={(text) => handleChangeDigit(index, text)}
          keyboardType="number-pad"
          maxLength={1}
          style={[
            styles.digit,
            { borderColor: tokens.colors.border, borderRadius: tokens.radius.sm, color: tokens.colors.text },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  digit: { width: 40, height: 48, borderWidth: 1, textAlign: 'center', fontSize: 18 },
});
