import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuth } from '../src/auth/AuthProvider';
import { Button } from '../src/components/Button';

export default function HomeScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace('/');
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>وصلت إلى الصفحة الرئيسية</Text>
      <Text style={[styles.subtitle, { color: tokens.colors.textSecondary }]}>
        محتوى الملف الشخصي والتشخيص والعلاج يُبنى في الوحدات القادمة.
      </Text>
      <Button title="تسجيل الخروج" onPress={handleLogout} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
});
