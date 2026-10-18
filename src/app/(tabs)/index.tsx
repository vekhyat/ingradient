import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler } from 'react-native';

import { useServices } from '../../features/app/services';
import { CaptureScreen } from '../../features/scan/CaptureScreen';
import { DiscardLabelSheet } from '../../features/scan/DiscardLabelSheet';

/**
 * U01 Scan: barcode or label from the large camera. Android Back with a
 * label in progress asks first; a clean Scan leaves the app as usual.
 */
export default function ScanTab() {
  const { label } = useServices();
  const [confirm, setConfirm] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (!label.isDirty()) {
            return false;
          }
          setConfirm(true);
          return true;
        },
      );
      return () => subscription.remove();
    }, [label]),
  );

  return (
    <>
      <CaptureScreen labelOnly={false} />
      <DiscardLabelSheet
        visible={confirm}
        onKeep={() => setConfirm(false)}
        onDiscard={() => {
          setConfirm(false);
          label.discard();
        }}
      />
    </>
  );
}
