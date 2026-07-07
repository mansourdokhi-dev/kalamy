import { View, Text, TextInput, StyleSheet, KeyboardTypeOptions } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
}

export function TextField({ label, value, onChangeText, error, secureTextEntry, keyboardType, testID }: TextFieldProps) {
  const { tokens } = useTheme();

  return (
    <View style={{ marginBottom: tokens.spacing.md }}>
      <Text style={{ color: tokens.colors.text, marginBottom: 4, fontSize: 13 }}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        style={[
          styles.input,
          {
            borderColor: error ? tokens.colors.danger : tokens.colors.border,
            borderRadius: tokens.radius.sm,
            color: tokens.colors.text,
            backgroundColor: tokens.colors.surface,
          },
        ]}
      />
      {error ? <Text style={{ color: tokens.colors.danger, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlign: 'right' },
});
