import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, View } from 'react-native';

import { AppBar } from '../components/AppBar';
import { AppText } from '../components/AppText';
import { Sheet } from '../components/Sheet';
import { enGB } from '../copy/en-GB';
import { useServices } from '../features/app/services';
import { CaptureScreen } from '../features/scan/CaptureScreen';
import { useColors } from '../theme/ThemeProvider';

/**
 * U04 label capture, opened from a lookup gap. Back with photos taken asks
 * before the session (and its photos) is discarded.
 */
export default function CaptureRoute() {
  const router = useRouter();
  const colors = useColors();
  const { label } = useServices();
  const [confirm, setConfirm] = useState(false);

  const back = useCallback(() => {
    if (label.isDirty()) {
      setConfirm(true);
      return;
    }
    label.discard();
    router.back();
  }, [label, router]);

  // Android Back runs the same check as the arrow.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          back();
          return true;
        },
      );
      return () => subscription.remove();
    }, [back]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <AppBar title={enGB.capture.title} onBack={back} />
      <CaptureScreen labelOnly />
      <Sheet
        visible={confirm}
        title={enGB.capture.discardTitle}
        dirty={false}
        onClose={() => setConfirm(false)}
        secondaryAction={{
          label: enGB.sheet.keepReviewing,
          variant: 'tonal',
          onPress: () => setConfirm(false),
        }}
        primaryAction={{
          label: enGB.sheet.discard,
          variant: 'outline',
          onPress: () => {
            setConfirm(false);
            label.discard();
            router.back();
          },
        }}
      >
        <AppText>{enGB.capture.discardBody}</AppText>
      </Sheet>
    </View>
  );
}
