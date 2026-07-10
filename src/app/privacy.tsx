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
        <Text selectable style={bodyStyle}>The default build sends selected coordinates and standard network metadata to Open-Meteo to fulfill forecast requests. A production deployment must publish the terms of every configured provider.</Text>
      </Section>
      <Section title="No account or ads">
        <Text selectable style={bodyStyle}>Weathercast does not create an account, access contacts, use an advertising identifier, or sell personal data in this build.</Text>
      </Section>
      <Text selectable style={{ color: theme.secondaryText, fontSize: 13 }}>Effective 10 July 2026 · Pre-release policy</Text>
    </Screen>
  );
}
