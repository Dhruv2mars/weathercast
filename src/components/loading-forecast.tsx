import { View } from 'react-native';

import { spacing, useAppTheme } from '@/constants/theme';

export function LoadingForecast() {
  const theme = useAppTheme();
  return (
    <View accessibilityLabel="Loading rain nowcast" style={{ gap: spacing.md }}>
      <View style={{ height: 20, width: '34%', borderRadius: 6, backgroundColor: theme.elevated }} />
      <View style={{ height: 44, width: '90%', borderRadius: 10, backgroundColor: theme.elevated }} />
      <View style={{ height: 18, width: '68%', borderRadius: 6, backgroundColor: theme.elevated }} />
      <View style={{ height: 88, width: '100%', borderRadius: 12, backgroundColor: theme.elevated }} />
    </View>
  );
}
