import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Pressable, Switch, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { forecastSourceInfo } from '@/lib/client-config';
import { requestNotificationPermission, syncScheduledAlert } from '@/services/notifications';
import { resetAppData } from '@/services/reset-app-data';
import type { AlertPreferences } from '@/types/weather';

const leadOptions: AlertPreferences['leadMinutes'][] = [5, 10, 15, 20, 30];

export default function SettingsScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = usePreferences();

  const setAlerts = async (enabled: boolean) => {
    if (enabled && !await requestNotificationPermission()) {
      Alert.alert('Notifications are off', 'Enable notifications in system settings when you want rain alerts.');
      return;
    }
    if (!enabled) {
      try {
        await syncScheduledAlert(null);
      } catch {
        Alert.alert('Could not disable alerts', 'Weathercast could not cancel the existing rain alert. Try again.');
        return;
      }
    }
    setPreferences({ ...preferences, alerts: { ...preferences.alerts, enabled } });
  };

  const deleteLocalData = async () => {
    try {
      await resetAppData(queryClient);
      router.replace('/onboarding');
    } catch {
      Alert.alert('Could not delete all data', 'Weathercast could not cancel the existing rain alert. Try again.');
    }
  };

  const confirmDeleteLocalData = () => {
    Alert.alert('Delete local data?', 'This removes saved places, preferences, alerts, and cached forecasts from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: deleteLocalData },
    ]);
  };

  return (
    <Screen>
      <Section title="Rain alerts">
        <Group>
          <SettingRow title="Alert me" body="Schedule an on-device alert from the latest forecast.">
            <Switch
              accessibilityLabel="Rain alerts"
              accessibilityHint="Schedules a local alert from the latest forecast"
              value={preferences.alerts.enabled}
              onValueChange={setAlerts}
            />
          </SettingRow>
          <Divider />
          <View style={{ padding: 16, gap: 10 }}>
            <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Lead time</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {leadOptions.map((minutes) => {
                const selected = preferences.alerts.leadMinutes === minutes;
                return (
                  <Pressable
                    key={minutes}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPreferences({ ...preferences, alerts: { ...preferences.alerts, leadMinutes: minutes } })}
                    style={{ minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: selected ? theme.accent : theme.elevated }}
                  >
                    <Text style={{ color: selected ? '#FFFFFF' : theme.text, fontWeight: '700' }}>{minutes}m</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Divider />
          <SettingRow title="Moderate rain or heavier" body="Skip trace and light-rain alerts.">
            <Switch
              accessibilityLabel="Moderate rain or heavier only"
              accessibilityHint="Skips trace and light-rain alerts"
              value={preferences.alerts.significantOnly}
              onValueChange={(significantOnly) => setPreferences({ ...preferences, alerts: { ...preferences.alerts, significantOnly } })}
            />
          </SettingRow>
        </Group>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 13, lineHeight: 19 }}>
          Alerts use the latest forecast fetched while Weathercast is open. If the app has not refreshed recently, an alert may be stale or unavailable.
        </Text>
      </Section>

      <Section title="Location & privacy">
        <Group>
          <Pressable accessibilityRole="button" onPress={() => router.push('/privacy')} style={{ minHeight: 56, padding: 16, justifyContent: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Privacy policy</Text>
            <Text style={{ color: theme.secondaryText }}>What stays on-device and what providers receive</Text>
          </Pressable>
          <Divider />
          <Pressable accessibilityRole="button" onPress={() => router.push('/terms')} style={{ minHeight: 56, padding: 16, justifyContent: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Terms of use</Text>
            <Text style={{ color: theme.secondaryText }}>Forecast limits, safety, and acceptable use</Text>
          </Pressable>
          <Divider />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/support')}
            style={{ minHeight: 56, padding: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Support</Text>
            <Text style={{ color: theme.secondaryText }}>Quick answers and problem reporting</Text>
          </Pressable>
          <Divider />
          <Pressable
            accessibilityRole="button"
            onPress={confirmDeleteLocalData}
            style={{ minHeight: 56, padding: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: theme.destructive, fontSize: 16, fontWeight: '700' }}>Delete local data</Text>
          </Pressable>
        </Group>
      </Section>

      <Section title="Data sources">
        <Group>
          <View style={{ padding: 16, gap: spacing.xs }}>
            <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{forecastSourceInfo.title}</Text>
            <Text selectable style={{ color: theme.secondaryText, lineHeight: 21 }}>{forecastSourceInfo.body}</Text>
          </View>
        </Group>
      </Section>

      <Text selectable style={{ color: theme.secondaryText, textAlign: 'center', fontSize: 13 }}>Weathercast 1.0.0 · Not for emergency or life-safety decisions</Text>
    </Screen>
  );
}

function SettingRow({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={{ minHeight: 64, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        <Text selectable style={{ color: theme.secondaryText, lineHeight: 20 }}>{body}</Text>
      </View>
      {children}
    </View>
  );
}
