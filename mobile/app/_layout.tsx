import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { AuthProvider } from '../src/auth/AuthProvider';
import { PatientProfileProvider } from '../src/patient/PatientProfileProvider';

export default function RootLayout() {
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <PatientProfileProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </PatientProfileProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
