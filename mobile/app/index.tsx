import { View, Text, StyleSheet } from 'react-native';
import { ar } from '../src/copy/ar';

export default function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{ar.welcome.title}</Text>
      <Text style={styles.subtitle}>{ar.welcome.subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', color: '#555' },
});
