import { useState, useEffect } from 'react';
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
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, (_, i) => value[i] ?? ''));

  useEffect(() => {
    if (value === '') {
      setDigits(Array.from({ length }, () => ''));
    }
  }, [value, length]);

  function handleChangeDigit(index: number, digit: string) {
    const nextDigits = [...digits];
    nextDigits[index] = digit.slice(-1);
    setDigits(nextDigits);
    const nextValue = nextDigits.join('');
    onChange(nextValue);
    if (nextDigits.every((d) => d !== '') && onComplete) {
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
