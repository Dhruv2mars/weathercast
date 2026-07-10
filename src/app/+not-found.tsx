import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { spacing, useAppTheme } from '@/constants/theme';

export default function NotFoundScreen() {
  const theme = useAppTheme();
  return (
    <Screen contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.md }}>
      <View style={{ gap: spacing.md }}>
        <Text selectable style={{ color: theme.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 }}>
          This forecast path does not exist.
        </Text>
        <Text selectable style={{ color: theme.secondaryText, fontSize: 17, lineHeight: 24 }}>
          Return to the current rain nowcast.
        </Text>
        <AppButton onPress={() => router.replace('/')}>Back to Now</AppButton>
      </View>
    </Screen>
  );
}
