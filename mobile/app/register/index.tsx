import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { Button } from '../../src/components/Button';

export default function RegisterChoiceScreen() {
  const router = useRouter();
  const { tokens } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.registerChoice.title}</Text>
      <View style={styles.actions}>
        <Button
          title={ar.registerChoice.forSelf}
          onPress={() => router.push({ pathname: '/register/form', params: { role: 'PATIENT' } })}
        />
        <View style={{ height: 12 }} />
        <Button
          title={ar.registerChoice.forChild}
          onPress={() => router.push({ pathname: '/register/form', params: { role: 'CAREGIVER' } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 32 },
  actions: { width: '100%', maxWidth: 320 },
});
