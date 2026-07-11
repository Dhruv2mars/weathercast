import { Text } from 'react-native';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { useAppTheme } from '@/constants/theme';

export default function TermsScreen() {
  const theme = useAppTheme();
  const bodyStyle = { color: theme.secondaryText, fontSize: 16, lineHeight: 24 } as const;
  return (
    <Screen>
      <Section title="Forecast limitations">
        <Text selectable style={bodyStyle}>Rain nowcasts are probabilistic. They may be delayed, unavailable, or wrong. Coverage and confidence describe available evidence, not a guarantee.</Text>
      </Section>
      <Section title="Safety">
        <Text selectable style={bodyStyle}>Weathercast is not an emergency, aviation, maritime, medical, or public-warning service. Follow official local authority warnings and do not rely on Weathercast for life-safety decisions.</Text>
      </Section>
      <Section title="Acceptable use">
        <Text selectable style={bodyStyle}>Do not abuse, disrupt, scrape beyond published limits, reverse engineer protected services, or use Weathercast unlawfully. Data-source rights and availability vary by region.</Text>
      </Section>
      <Section title="Service changes">
        <Text selectable style={bodyStyle}>Features, sources, coverage, and access may change to protect reliability, comply with law, or respect provider agreements. Use of the app is subject to the published terms for your release region.</Text>
      </Section>
      <Text selectable style={{ color: theme.secondaryText, fontSize: 13 }}>Effective 11 July 2026</Text>
    </Screen>
  );
}
