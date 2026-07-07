import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';

export default function RootLayout() {
  useEffect(() => {
    if (!I18nManager.isRTL) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(true);
    }
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
