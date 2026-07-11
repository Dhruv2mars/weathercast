import { router } from 'expo-router';
import { Alert, Linking, Pressable, Switch, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';
import { usePreferences } from '@/hooks/use-preferences';
import { storage } from '@/lib/storage';
import { requestNotificationPermission, syncScheduledAlert } from '@/services/notifications';
import type { AlertPreferences } from '@/types/weather';

const leadOptions: AlertPreferences['leadMinutes'][] = [5, 10, 15, 20, 30];

export default function SettingsScreen() {
  const theme = useAppTheme();
  const [preferences, setPreferences] = usePreferences();

  const setAlerts = async (enabled: boolean) => {
    if (enabled && !await requestNotificationPermission()) {
      Alert.alert('Notifications are off', 'Enable notifications in system settings when you want rain alerts.');
      return;
    }
    if (!enabled) await syncScheduledAlert(null);
    setPreferences({ ...preferences, alerts: { ...preferences.alerts, enabled } });
  };

  return (
    <Screen>
      <Section title="Rain alerts">
        <Group>
          <SettingRow title="Alert me" body="Schedule an on-device alert from the latest forecast.">
            <Switch value={preferences.alerts.enabled} onValueChange={setAlerts} />
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
              value={preferences.alerts.significantOnly}
              onValueChange={(significantOnly) => setPreferences({ ...preferences, alerts: { ...preferences.alerts, significantOnly } })}
            />
          </SettingRow>
        </Group>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 13, lineHeight: 19 }}>
          Local alerts refresh when the app fetches a forecast. Reliable sleeping-device updates require the production push service described in the architecture docs.
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
            accessibilityRole="link"
            onPress={() => Linking.openURL(process.env.EXPO_PUBLIC_SUPPORT_URL ?? 'https://github.com/Dhruv2mars/weathercast/issues')}
            style={{ minHeight: 56, padding: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Support</Text>
            <Text style={{ color: theme.secondaryText }}>Get help or report a problem</Text>
          </Pressable>
          <Divider />
          <Pressable
            accessibilityRole="button"
            onPress={() => Alert.alert('Delete local data?', 'This removes saved places, preferences, alerts, and cached forecasts from this device.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => { storage.clearAll(); router.replace('/onboarding'); } },
            ])}
            style={{ minHeight: 56, padding: 16, justifyContent: 'center' }}
          >
            <Text style={{ color: theme.destructive, fontSize: 16, fontWeight: '700' }}>Delete local data</Text>
          </Pressable>
        </Group>
      </Section>

      <Section title="Data sources">
        <Group>
          <View style={{ padding: 16, gap: spacing.xs }}>
            <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Open-Meteo</Text>
            <Text selectable style={{ color: theme.secondaryText, lineHeight: 21 }}>Worldwide 15-minute numerical guidance in the default build. Weather data by Open-Meteo.com.</Text>
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
