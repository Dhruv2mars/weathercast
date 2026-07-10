import { Text, View } from 'react-native';

import { intensityForAmount } from '@/domain/nowcast';
import { formatTime, intensityLabel } from '@/lib/format';
import { spacing, useAppTheme } from '@/constants/theme';
import type { ForecastInterval } from '@/types/weather';

export function RainTimeline({ intervals }: { intervals: ForecastInterval[] }) {
  const theme = useAppTheme();
  const shown = intervals.slice(0, 9);
  return (
    <View accessibilityRole="summary" accessibilityLabel={shown.map((interval) => {
      const intensity = intensityForAmount(interval.precipitationMm);
      return `${formatTime(interval.time)}, ${intensityLabel(intensity)}, ${interval.probability} percent chance`;
    }).join('. ')} style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 88, gap: 5 }}>
        {shown.map((interval) => {
          const intensity = intensityForAmount(interval.precipitationMm);
          const height = intensity === 'none' ? 6 : intensity === 'trace' ? 16 : intensity === 'light' ? 30 : intensity === 'moderate' ? 48 : intensity === 'heavy' ? 66 : 82;
          const backgroundColor = intensity === 'none' ? theme.separator : ['heavy', 'extreme'].includes(intensity) ? theme.heavyRain : theme.rain;
          return <View key={interval.time} style={{ flex: 1, height, minWidth: 8, borderRadius: 4, backgroundColor }} />;
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 12 }}>Now</Text>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 12 }}>+30</Text>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 12 }}>+60</Text>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 12 }}>+90</Text>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 12 }}>+120</Text>
      </View>
    </View>
  );
}
