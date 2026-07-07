import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function ErrorBanner({ message }: { message: string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.danger + '1A', borderRadius: tokens.radius.sm }]}>
      <Text style={{ color: tokens.colors.danger, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 10, marginBottom: 12 },
});
