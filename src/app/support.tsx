import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Divider, Group, Section } from '@/components/section';
import { spacing, useAppTheme } from '@/constants/theme';

const issueUrl = 'https://github.com/Dhruv2mars/weathercast/issues/new/choose';

const questions = [
  {
    title: 'Why did the forecast change?',
    body: 'Nowcasts update as newer radar, station, and model inputs arrive. The latest issue replaces older guidance only when the service has fresher evidence.',
  },
  {
    title: 'Why is my coverage Standard?',
    body: 'Radar and observation density vary by region. Standard means model-based guidance is available, but the inputs do not support a hyperlocal Precision claim.',
  },
  {
    title: 'Why did an alert not arrive?',
    body: 'Device notification permission must be enabled. Local alerts refresh after a successful forecast fetch and can be delayed by operating-system power controls.',
  },
  {
    title: 'How do I remove my data?',
    body: 'Weathercast has no account in this release. Use Delete local data in Settings, or uninstall the app, to remove saved places, preferences, alerts, and cached forecasts.',
  },
];

export default function SupportScreen() {
  const theme = useAppTheme();
  const openIssue = async () => {
    try {
      await Linking.openURL(issueUrl);
    } catch {
      Alert.alert('Support unavailable', 'Open github.com/Dhruv2mars/weathercast/issues in a browser.');
    }
  };

  return (
    <Screen>
      <Section title="Quick answers">
        <Group>
          {questions.map((question, index) => (
            <View key={question.title}>
              {index > 0 ? <Divider /> : null}
              <View style={{ padding: spacing.md, gap: spacing.xs }}>
                <Text selectable style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{question.title}</Text>
                <Text selectable style={{ color: theme.secondaryText, fontSize: 15, lineHeight: 22 }}>{question.body}</Text>
              </View>
            </View>
          ))}
        </Group>
      </Section>

      <Section title="Still need help?">
        <Pressable
          accessibilityRole="link"
          accessibilityHint="Opens the Weathercast support form in your browser"
          onPress={openIssue}
          style={({ pressed }) => ({
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: 12,
            backgroundColor: theme.accent,
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Contact support</Text>
        </Pressable>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 13, lineHeight: 19 }}>
          Include the location, approximate time, coverage tier, and forecast ID when reporting an accuracy problem. Do not post private information.
        </Text>
      </Section>
    </Screen>
  );
}
