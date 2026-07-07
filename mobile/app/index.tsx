import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../src/copy/ar';
import { useTheme } from '../src/theme/ThemeContext';
import { Button } from '../src/components/Button';

export default function WelcomeScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.welcome.title}</Text>
      <Text style={[styles.subtitle, { color: tokens.colors.textSecondary }]}>{ar.welcome.subtitle}</Text>
      <View style={styles.actions}>
        <Button title={ar.welcome.registerCta} onPress={() => router.push('/register')} />
        <View style={{ height: 12 }} />
        <Button title={ar.welcome.loginCta} onPress={() => router.push('/login')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 32 },
  actions: { width: '100%', maxWidth: 320 },
});
