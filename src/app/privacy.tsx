import { Text } from 'react-native';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { useAppTheme } from '@/constants/theme';

export default function PrivacyScreen() {
  const theme = useAppTheme();
  const bodyStyle = { color: theme.secondaryText, fontSize: 16, lineHeight: 24 } as const;
  return (
    <Screen>
      <Section title="Location">
        <Text selectable style={bodyStyle}>Weathercast uses a place you choose or foreground device location to request a rain nowcast. It does not request background location.</Text>
      </Section>
      <Section title="On-device data">
        <Text selectable style={bodyStyle}>Saved places, alert preferences, onboarding state, and the latest cached forecast are stored on this device. Delete local data from Settings or uninstall the app to remove them.</Text>
      </Section>
      <Section title="Weather providers">
        <Text selectable style={bodyStyle}>The app sends selected coordinates and standard network metadata to the configured Weathercast service and its weather-data providers only to fulfill forecast and radar requests.</Text>
      </Section>
      <Section title="No account or ads">
        <Text selectable style={bodyStyle}>Weathercast does not create an account, access contacts, use an advertising identifier, or sell personal data in this build.</Text>
      </Section>
      <Text selectable style={{ color: theme.secondaryText, fontSize: 13 }}>Effective 11 July 2026</Text>
    </Screen>
  );
}
