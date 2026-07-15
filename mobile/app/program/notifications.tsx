import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import { getMyNotifications, markNotificationRead, AppNotification } from '../../src/api/notifications';

export default function NotificationsScreen() {
  const { tokens } = useTheme();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMyNotifications();
      setNotifications(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  async function handlePress(notification: AppNotification) {
    if (notification.readAt) return;
    try {
      const updated = await markNotificationRead(notification.id);
      setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.notifications.title}</Text>

      {notifications.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary }}>{ar.notifications.empty}</Text>
      ) : (
        notifications.map((notification) => {
          const isUnread = !notification.readAt;
          return (
            <Pressable key={notification.id} onPress={() => handlePress(notification)}>
              <View style={[styles.card, { borderColor: tokens.colors.border }]}>
                <View style={styles.titleRow}>
                  {isUnread ? <View style={[styles.dot, { backgroundColor: tokens.colors.primary }]} /> : null}
                  <Text style={{ color: tokens.colors.text, fontWeight: isUnread ? '700' : '400' }}>{notification.title}</Text>
                </View>
                <Text style={{ color: tokens.colors.textSecondary }}>{notification.body}</Text>
                <Text style={{ color: tokens.colors.textSecondary, fontSize: 12 }}>{notification.createdAt}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
