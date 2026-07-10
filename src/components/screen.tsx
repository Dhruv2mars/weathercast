import type { ComponentProps } from 'react';
import { ScrollView, View } from 'react-native';

import { maxContentWidth, spacing, useAppTheme } from '@/constants/theme';

export function Screen({ children, ...props }: ComponentProps<typeof ScrollView>) {
  const theme = useAppTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, alignItems: 'center' }}
      {...props}
    >
      <View style={{ width: '100%', maxWidth: maxContentWidth, gap: spacing.lg }}>{children}</View>
    </ScrollView>
  );
}
