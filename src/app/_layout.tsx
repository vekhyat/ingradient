import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText } from '../components/AppText';
import { AppServicesProvider } from '../features/app/services';
import { useAppFonts } from '../theme/fonts';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

export { ErrorBoundary } from 'expo-router';

function Shell() {
  const theme = useTheme();
  const { loaded, error } = useAppFonts();
  if (!loaded && !error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {error ? (
        <AppText variant="bodySm" color="ink2">
          {error.message}
        </AppText>
      ) : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppServicesProvider>
          <Shell />
        </AppServicesProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
