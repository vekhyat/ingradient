import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isValidGtin } from '../../adapters/catalogue/gtin';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CaptureViewfinder } from '../../components/CaptureViewfinder';
import { Sheet } from '../../components/Sheet';
import { TextField, type BarcodeFieldError } from '../../components/TextField';
import { enGB } from '../../copy/en-GB';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { PanelPresence } from '../../view-models/types';
import { useLabelState, useServices } from '../app/services';
import type { ReadOutcome } from '../capture/label-flow';
import { isReadyForReview, missingPanels } from '../capture/label-session';
import { checkTypedBarcode } from './barcode-input';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

function outcomeMessage(
  outcome: ReadOutcome | null,
  missing: string[],
): string | null {
  if (outcome === null) {
    return null;
  }
  switch (outcome.kind) {
    case 'filled':
      return missing[0] ? enGB.capture.needOther(missing[0]) : null;
    case 'neither':
      return enGB.capture.neither;
    case 'already_present':
      return missing[0] ? enGB.capture.needOther(missing[0]) : null;
    case 'no_text':
      return enGB.status.reading.noText;
    case 'unsupported_language':
      return enGB.status.reading.unsupportedLanguage;
    case 'engine_error':
      return enGB.status.reading.engineError;
    case 'capture_failed':
      return enGB.status.capture.failed;
  }
}

/**
 * U01/U02/U04. The large camera surface for barcodes and label photos.
 * `labelOnly` is the pushed capture screen used to fill a lookup gap.
 */
export function CaptureScreen({ labelOnly }: { labelOnly: boolean }) {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scan, label } = useServices();
  const labelState = useLabelState();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [focused, setFocused] = useState(true);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState(false);
  const [torch, setTorch] = useState(false);
  const [locked, setLocked] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<
    BarcodeFieldError | undefined
  >();
  const [capturing, setCapturing] = useState(false);
  const lockedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      lockedRef.current = false;
      setLocked(false);
      return () => {
        setFocused(false);
        setTorch(false);
      };
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') {
        setTorch(false);
      }
    });
    return () => subscription.remove();
  }, []);

  const permissionState: 'unknown' | 'granted' | 'denied' | 'blocked' =
    permission === null
      ? 'unknown'
      : permission.granted
        ? 'granted'
        : permission.status === 'undetermined'
          ? 'unknown'
          : permission.canAskAgain
            ? 'denied'
            : 'blocked';

  const cameraActive = focused && foreground && permissionState === 'granted';

  const session = labelState.session;
  const anyPanel =
    session !== null &&
    (session.ingredients.state !== 'missing' ||
      session.nutrition.state !== 'missing');
  // While a label is being photographed, a barcode printed on the same pack
  // must not pull the user away to a lookup.
  const scanningBarcodes = !labelOnly && !anyPanel && !labelState.reading;

  const startLookup = (code: string) => {
    void scan.lookup(code);
    router.push('/lookup');
  };

  const onBarcode = (data: string) => {
    if (lockedRef.current || !scanningBarcodes) {
      return;
    }
    const code = data.trim();
    if (!isValidGtin(code)) {
      return;
    }
    // Freeze this code: repeated frames cannot start a second lookup.
    lockedRef.current = true;
    setLocked(true);
    startLookup(code);
  };

  const submitManual = () => {
    const checked = checkTypedBarcode(manualValue);
    if (!checked.ok) {
      setManualError(checked.error);
      return;
    }
    setManualOpen(false);
    setManualError(undefined);
    setManualValue('');
    startLookup(checked.code);
  };

  const takePhoto = async () => {
    if (!camera.current || capturing) {
      return;
    }
    // Any photo is read as a label; the session starts on the first one.
    label.ensureStarted();
    setCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        shutterSound: false,
      });
      await label.addPhoto(picture.uri);
    } catch {
      // The flow reports capture failures through lastOutcome.
    } finally {
      setCapturing(false);
    }
  };

  const panels: PanelPresence[] = session
    ? [
        {
          panel: 'ingredients',
          state: session.ingredients.state,
          imageId: session.ingredients.imageId,
        },
        {
          panel: 'nutrition',
          state: session.nutrition.state,
          imageId: session.nutrition.imageId,
        },
      ]
    : [
        { panel: 'ingredients', state: 'missing', imageId: null },
        { panel: 'nutrition', state: 'missing', imageId: null },
      ];
  const missing = session
    ? missingPanels(session).map((panel) => enGB.capture.panels[panel])
    : [];
  const message = labelState.reading
    ? enGB.status.reading.pending
    : outcomeMessage(labelState.lastOutcome, missing);
  const readyForReview = session ? isReadyForReview(session) : false;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: space.s5 }}
    >
      <View
        style={{
          paddingTop: labelOnly ? 0 : insets.top,
          backgroundColor: colors.camera,
        }}
      >
        <CaptureViewfinder
          scanningBarcodes={scanningBarcodes}
          permission={permissionState}
          cameraState={
            mountError
              ? 'unavailable'
              : !foreground
                ? 'interrupted'
                : ready
                  ? 'ready'
                  : 'starting'
          }
          torch={torch ? 'on' : 'off'}
          panels={panels}
          locked={locked}
          capturing={capturing || labelState.reading}
          showPanels={labelOnly || anyPanel}
          preview={
            cameraActive ? (
              <CameraView
                ref={camera}
                style={{ flex: 1 }}
                facing="back"
                active={cameraActive}
                enableTorch={torch}
                animateShutter={false}
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                onBarcodeScanned={
                  scanningBarcodes && !locked
                    ? (result) => onBarcode(result.data)
                    : undefined
                }
                onCameraReady={() => setReady(true)}
                onMountError={() => setMountError(true)}
              />
            ) : null
          }
          onCapture={() => void takePhoto()}
          onTorch={() => setTorch((on) => !on)}
          onManualBarcode={() => setManualOpen(true)}
          onAllow={() => void requestPermission()}
          onSettings={() => void Linking.openSettings()}
        />
      </View>

      <View style={{ padding: space.s4, gap: space.s4 }}>
        {!anyPanel && !labelOnly ? (
          <>
            <AppText variant="heading" heading>
              {enGB.scan.noBarcodeTitle}
            </AppText>
            <AppText color="ink2">{enGB.scan.noBarcodeBody}</AppText>
            {message ? (
              <Card>
                <AppText accessibilityLiveRegion="polite">{message}</AppText>
              </Card>
            ) : null}
          </>
        ) : (
          <>
            {message ? (
              <Card>
                <AppText accessibilityLiveRegion="polite">{message}</AppText>
              </Card>
            ) : null}
            {anyPanel && !readyForReview && session
              ? missingPanels(session).map((panel) => (
                  <Button
                    key={panel}
                    label={enGB.capture.markAbsent(enGB.capture.panels[panel])}
                    variant="outline"
                    onPress={() => label.markAbsent(panel)}
                  />
                ))
              : null}
            <Button
              label={enGB.capture.continue}
              variant="primary"
              disabledReason={
                readyForReview
                  ? undefined
                  : enGB.capture.needOther(missing[0] ?? '')
              }
              onPress={() => router.push('/review')}
            />
            {!labelOnly && anyPanel ? (
              <Button
                label={enGB.scan.startOver}
                variant="text"
                onPress={() => label.discard()}
              />
            ) : null}
          </>
        )}
      </View>

      <Sheet
        visible={manualOpen}
        title={enGB.scan.manualTitle}
        dirty={false}
        onClose={() => {
          setManualOpen(false);
          setManualError(undefined);
        }}
        primaryAction={{
          label: enGB.scan.lookUp,
          variant: 'primary',
          onPress: submitManual,
        }}
      >
        <TextField
          purpose="barcode"
          label={enGB.scan.manualTitle}
          value={manualValue}
          error={manualError}
          onChange={(next) => {
            setManualValue(next);
            setManualError(undefined);
          }}
          onSubmit={submitManual}
        />
      </Sheet>
    </ScrollView>
  );
}
