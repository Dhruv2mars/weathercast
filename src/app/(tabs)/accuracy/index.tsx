import { Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';

export default function AccuracyScreen() {
  const theme = useAppTheme();
  return (
    <>
      <Stack.Screen options={{ title: 'Track record' }} />
      <Screen>
        <View style={{ gap: spacing.sm }}>
          <Text selectable accessibilityRole="header" style={{ color: theme.text, fontSize: 30, lineHeight: 36, fontWeight: '800' }}>Building this area’s track record</Text>
          <Text selectable style={{ color: theme.secondaryText, fontSize: 17, lineHeight: 25 }}>
            Weathercast will publish accuracy only after enough matched forecasts and observed rain events exist for a fair result.
          </Text>
        </View>

        <Section title="What we measure">
          <Group>
            <Metric title="Rain detected" body="How often verified rain events were forecast in advance." />
            <Divider />
            <Metric title="Start-time error" body="Typical difference between predicted and observed rain onset." />
            <Divider />
            <Metric title="False alerts" body="Alerts issued when verified rain did not reach the selected area." />
            <Divider />
            <Metric title="Confidence calibration" body="Whether events labeled high, medium, or low confidence occur at the expected rate." />
          </Group>
        </Section>

        <Section title="Comparison policy">
          <Text selectable style={{ color: theme.secondaryText, fontSize: 16, lineHeight: 24 }}>
            Competitor comparisons appear only when forecasts share the same location, issue time, horizon, and independent truth source. Weathercast will never display a “best” claim based on anecdotes, scraped screenshots, or unmatched samples.
          </Text>
        </Section>

        <Section title="Current coverage">
          <Group>
            <View style={{ padding: 16, gap: 5 }}>
              <Text selectable style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>Standard</Text>
              <Text selectable style={{ color: theme.secondaryText, lineHeight: 21 }}>Global numerical guidance. Licensed radar and local-observation calibration are not configured in this build.</Text>
            </View>
          </Group>
        </Section>
      </Screen>
    </>
  );
}

function Metric({ title, body }: { title: string; body: string }) {
  const theme = useAppTheme();
  return (
    <View style={{ padding: 16, gap: 4 }}>
      <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      <Text selectable style={{ color: theme.secondaryText, fontSize: 15, lineHeight: 21 }}>{body}</Text>
    </View>
  );
}
