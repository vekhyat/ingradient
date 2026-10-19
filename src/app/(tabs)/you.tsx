import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { LocalDataControls } from '../../components/LocalDataControls';
import { Sheet } from '../../components/Sheet';
import { enGB } from '../../copy/en-GB';
import { devToolsEnabled } from '../../dev/flags';
import { useServices } from '../../features/app/services';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

/**
 * U14 You (S1). What is stored on the phone, what leaves it, and erase.
 * No profile editor or learning controls until S3.
 */
export default function YouTab() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { store, storeRevision, bumpStore, resetStore } = useServices();
  const [count, setCount] = useState<number | null>(null);
  const [operation, setOperation] = useState<
    'idle' | 'erasing' | 'failed' | 'erased'
  >('idle');
  const [confirm, setConfirm] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (store.status !== 'ready') {
        setCount(null);
        return;
      }
      store.store
        .count()
        .then(setCount)
        .catch(() => setCount(null));
    }, [store, storeRevision]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const erase = async () => {
    setConfirm(false);
    setOperation('erasing');
    try {
      if (store.status === 'ready') {
        await store.store.eraseAll();
      } else {
        // The data cannot be opened (for example a lost key): remove the file.
        await resetStore();
      }
      setOperation('erased');
      bumpStore();
    } catch {
      setOperation('failed');
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.s4,
        paddingTop: insets.top + space.s4,
        paddingBottom: space.s6,
        gap: space.s4,
      }}
    >
      <AppText variant="display" heading>
        {enGB.you.title}
      </AppText>
      {store.status === 'error' ? (
        <AppText accessibilityRole="alert">{enGB.history.error}</AppText>
      ) : null}
      <LocalDataControls
        slice="S1"
        savedCount={store.status === 'error' ? 1 : count}
        operation={operation}
        onErase={() => setConfirm(true)}
        onOpenPrivacy={() => router.push('/privacy')}
        onOpenMethod={() => router.push('/about-method')}
      />
      {devToolsEnabled ? (
        <Button
          label="Developer playground"
          variant="text"
          icon="construction"
          onPress={() => router.push('/dev')}
        />
      ) : null}

      <Sheet
        visible={confirm}
        title={enGB.you.eraseTitle}
        dirty={false}
        onClose={() => setConfirm(false)}
        secondaryAction={{
          label: enGB.common.cancel,
          variant: 'tonal',
          onPress: () => setConfirm(false),
        }}
        primaryAction={{
          label: enGB.you.eraseConfirm,
          variant: 'outline',
          onPress: () => void erase(),
        }}
      >
        <AppText>{enGB.you.eraseBody}</AppText>
      </Sheet>
    </ScrollView>
  );
}
