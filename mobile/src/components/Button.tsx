import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ title, onPress, disabled, loading }: ButtonProps) {
  const { tokens } = useTheme();
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.base,
        { backgroundColor: tokens.colors.primary, borderRadius: tokens.radius.md, opacity: isDisabled ? 0.6 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tokens.colors.onPrimary} />
      ) : (
        <Text style={[styles.text, { color: tokens.colors.onPrimary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 15, fontWeight: '600' },
});
