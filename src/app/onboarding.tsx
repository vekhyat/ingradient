import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { enGB } from '../copy/en-GB';
import { useServices } from '../features/app/services';
import { NoticeBody } from '../features/onboarding/NoticeBody';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

/**
 * ONB-01. Shown once before the first analysis. Continue stores the accepted
 * notice version on the phone; a later notice version asks again.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { acceptNotice } = useServices();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Back leaves the app rather than skipping the notice.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          BackHandler.exitApp();
          return true;
        },
      );
      return () => subscription.remove();
    }, []),
  );

  const accept = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await acceptNotice();
      router.replace('/');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.s4,
          paddingTop: insets.top + space.s6,
          gap: space.s5,
        }}
      >
        <AppText variant="display" heading>
          {enGB.onboarding.title}
        </AppText>
        <NoticeBody />
        {failed ? (
          <AppText color="alertInk" accessibilityRole="alert">
            {enGB.onboarding.failed}
          </AppText>
        ) : null}
      </ScrollView>
      <View
        style={{
          padding: space.s4,
          paddingBottom: insets.bottom + space.s4,
          borderTopWidth: 1,
          borderTopColor: colors.hair,
        }}
      >
        <Button
          label={enGB.onboarding.accept}
          variant="primary"
          busy={busy}
          onPress={() => void accept()}
        />
      </View>
    </View>
  );
}
