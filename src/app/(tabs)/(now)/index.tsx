import { useNetInfo } from '@react-native-community/netinfo';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { LoadingForecast } from '@/components/loading-forecast';
import { RainTimeline } from '@/components/rain-timeline';
import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';
import { getAlertPlan } from '@/domain/alerts';
import { useNowcast } from '@/hooks/use-nowcast';
import { usePreferences } from '@/hooks/use-preferences';
import { useSelectedPlace } from '@/hooks/use-selected-place';
import { formatRelativeUpdate, formatTime, intensityLabel } from '@/lib/format';
import { syncScheduledAlert } from '@/services/notifications';

export default function NowScreen() {
  const theme = useAppTheme();
  const network = useNetInfo();
  const [preferences] = usePreferences();
  const selected = useSelectedPlace();
  const nowcastQuery = useNowcast(selected.place);
  const nowcast = nowcastQuery.data;

  useEffect(() => {
    if (!nowcast) return;
    syncScheduledAlert(getAlertPlan(nowcast, preferences.alerts)).catch(() => undefined);
  }, [nowcast, preferences.alerts]);

  if (!preferences.onboardingComplete) return <Redirect href="/onboarding" />;

  return (
    <>
      <Stack.Screen options={{
        title: selected.place?.name ?? 'Now',
        headerRight: () => (
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} hitSlop={12}>
            <Text style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>Settings</Text>
          </Pressable>
        ),
      }} />
      <Screen refreshControl={<RefreshControl refreshing={nowcastQuery.isFetching && !nowcastQuery.isLoading} onRefresh={() => nowcastQuery.refetch()} tintColor={theme.accent} />}>
        {!network.isConnected && (
          <View accessibilityRole="alert" style={{ backgroundColor: theme.elevated, borderRadius: 12, padding: 12 }}>
            <Text selectable style={{ color: theme.text, fontWeight: '700' }}>Offline</Text>
            <Text selectable style={{ color: theme.secondaryText }}>Showing the last available forecast. Timing may be stale.</Text>
          </View>
        )}

        {selected.isLoading && <LoadingForecast />}

        {!selected.isLoading && !selected.place && (
          <View style={{ gap: spacing.md }}>
            <Text selectable accessibilityRole="header" style={{ color: theme.text, fontSize: 28, fontWeight: '800' }}>Location needed</Text>
            <Text selectable style={{ color: theme.secondaryText, fontSize: 17, lineHeight: 24 }}>
              Use your location while the app is open, or choose a place manually. Weathercast never requests background location.
            </Text>
            <AppButton onPress={() => router.push('/onboarding')}>Choose location</AppButton>
          </View>
        )}

        {selected.place && nowcastQuery.isLoading && <LoadingForecast />}

        {selected.place && nowcastQuery.isError && !nowcast && (
          <View accessibilityRole="alert" style={{ gap: spacing.md }}>
            <Text selectable style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Forecast unavailable</Text>
            <Text selectable style={{ color: theme.secondaryText, fontSize: 16, lineHeight: 23 }}>
              {nowcastQuery.error instanceof Error ? nowcastQuery.error.message : 'The weather service could not be reached.'}
            </Text>
            <AppButton onPress={() => nowcastQuery.refetch()}>Try again</AppButton>
          </View>
        )}

        {nowcast && (
          <>
            <View accessible accessibilityRole="summary" style={{ gap: spacing.sm }}>
              <Text selectable style={{ color: theme.secondaryText, fontSize: 15, fontWeight: '600' }}>
                Next 120 minutes
              </Text>
              <Text selectable accessibilityRole="header" style={{ color: theme.text, fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -0.8 }}>
                {nowcast.headline}
              </Text>
              <Text selectable style={{ color: theme.secondaryText, fontSize: 18, lineHeight: 26 }}>{nowcast.detail}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                <Text selectable style={{ color: theme.text, backgroundColor: theme.accentSoft, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontWeight: '700' }}>
                  {nowcast.confidence.label[0].toUpperCase()}{nowcast.confidence.label.slice(1)} confidence
                </Text>
                <Text selectable style={{ color: theme.text, backgroundColor: theme.elevated, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, fontWeight: '600' }}>
                  {nowcast.dataTier[0].toUpperCase()}{nowcast.dataTier.slice(1)} coverage
                </Text>
              </View>
            </View>

            <Section title="Rain timeline">
              <RainTimeline intervals={nowcast.intervals} />
              {nowcast.event && (
                <Text selectable style={{ color: theme.secondaryText, fontSize: 15, lineHeight: 22 }}>
                  {intensityLabel(nowcast.event.peakIntensity)} peak · {formatTime(nowcast.event.startTime)} to {formatTime(nowcast.event.endTime)}
                </Text>
              )}
            </Section>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <View style={{ flexGrow: 1 }}>
                <AppButton onPress={() => router.push('/settings')} variant={preferences.alerts.enabled ? 'secondary' : 'primary'}>
                  {preferences.alerts.enabled ? `Alert set · ${preferences.alerts.leadMinutes} min before` : 'Alert me'}
                </AppButton>
              </View>
            </View>

            <Section title="Why this answer">
              <Group>
                <View style={{ padding: 16, gap: 4 }}>
                  <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Confidence</Text>
                  <Text selectable style={{ color: theme.secondaryText, fontSize: 15, lineHeight: 21 }}>{nowcast.confidence.explanation}</Text>
                </View>
                <Divider />
                <View style={{ padding: 16, gap: 4 }}>
                  <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Freshness</Text>
                  <Text selectable style={{ color: theme.secondaryText, fontSize: 15 }}>
                    {formatRelativeUpdate(nowcast.generatedAt ?? nowcast.issuedAt)}
                  </Text>
                  {!nowcast.sourceDataTime && nowcast.forecastId && (
                    <Text selectable style={{ color: theme.secondaryText, fontSize: 13 }}>Provider source timestamp unavailable</Text>
                  )}
                </View>
                <Divider />
                <View style={{ padding: 16, gap: 4 }}>
                  <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>Source</Text>
                  <Text selectable style={{ color: theme.secondaryText, fontSize: 15, lineHeight: 21 }}>{nowcast.source}</Text>
                  <Text selectable style={{ color: theme.secondaryText, fontSize: 13, lineHeight: 19 }}>
                    {nowcast.coverage?.reason ?? 'Standard-tier guidance is model-based and not street-level radar. Weathercast shows this limitation instead of implying unsupported precision.'}
                  </Text>
                </View>
              </Group>
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
