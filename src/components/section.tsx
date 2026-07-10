import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { spacing, useAppTheme } from '@/constants/theme';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>{title}</Text>
      {children}
    </View>
  );
}

export function Group({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden' }}>
      {children}
    </View>
  );
}

export function Divider() {
  const theme = useAppTheme();
  return <View style={{ height: 1, backgroundColor: theme.separator, marginLeft: 16 }} />;
}
