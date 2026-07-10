import { View, Text, TextInput, StyleSheet, KeyboardTypeOptions } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  testID?: string;
}

export function TextField({ label, value, onChangeText, error, secureTextEntry, keyboardType, multiline, testID }: TextFieldProps) {
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
        multiline={multiline}
        style={[
          styles.input,
          multiline ? styles.multilineInput : null,
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
  multilineInput: { minHeight: 100, textAlignVertical: 'top' },
});
