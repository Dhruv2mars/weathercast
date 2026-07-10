import * as Haptics from 'expo-haptics';
import { type ReactNode } from 'react';
import { Platform, Pressable, Text, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/constants/theme';

type Props = {
  children: ReactNode;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  accessibilityHint?: string;
};

export function AppButton({ children, onPress, variant = 'primary', disabled = false, accessibilityHint }: Props) {
  const theme = useAppTheme();
  const backgroundColor = variant === 'primary' ? theme.accent : variant === 'danger' ? theme.destructive : theme.elevated;
  const color = variant === 'secondary' ? theme.text : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
      onPress={() => {
        if (Platform.OS === 'ios') Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }): ViewStyle => ({
        minHeight: Platform.OS === 'ios' ? 44 : 48,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 12,
        borderCurve: 'continuous',
        backgroundColor,
        opacity: disabled ? 0.45 : 1,
        transform: [{ scale: pressed && Platform.OS === 'ios' ? 0.98 : 1 }],
      })}
    >
      <Text style={{ color, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{children}</Text>
    </Pressable>
  );
}
