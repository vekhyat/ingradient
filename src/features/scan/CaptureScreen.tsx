import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isValidGtin } from '../../adapters/catalogue/gtin';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { CaptureViewfinder } from '../../components/CaptureViewfinder';
import { OperationStatus } from '../../components/OperationStatus';
import { Sheet } from '../../components/Sheet';
import { TextField, type BarcodeFieldError } from '../../components/TextField';
import { enGB } from '../../copy/en-GB';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import type { PanelPresence } from '../../view-models/types';
import { useLabelState, useServices } from '../app/services';
import type { ReadOutcome } from '../capture/label-flow';
import {
  isReadyForReview,
  missingPanels,
  nutritionStillOptional,
} from '../capture/label-session';
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
  const { scan, label, warmUpBackend } = useServices();
  const labelState = useLabelState();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const window = useWindowDimensions();
  const [pictureSize, setPictureSize] = useState<string | undefined>();
  const [focusPoint, setFocusPoint] = useState<
    { x: number; y: number; request: number } | undefined
  >();
  // Height of the area above the nav bar; the camera fills it on the Scan tab.
  const [areaHeight, setAreaHeight] = useState(window.height);

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
  const [analysing, setAnalysing] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const analysis = useRef<AbortController | null>(null);
  const lockedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      warmUpBackend();
      setFocused(true);
      lockedRef.current = false;
      setLocked(false);
      return () => {
        analysis.current?.abort();
        analysis.current = null;
        setAnalysing(false);
        setFocused(false);
        setReady(false);
        setTorch(false);
      };
    }, [warmUpBackend]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') {
        analysis.current?.abort();
        analysis.current = null;
        setAnalysing(false);
        setTorch(false);
        setReady(false);
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
  useEffect(() => {
    if (!labelState.session && analysis.current) {
      analysis.current.abort();
      analysis.current = null;
      setAnalysing(false);
    }
  }, [labelState.session]);
  const anyPanel =
    session !== null &&
    (session.ingredients.state !== 'missing' ||
      session.nutrition.state !== 'missing');
  // While a label is being photographed, a barcode printed on the same pack
  // must not pull the user away to a lookup.
  const scanningBarcodes = !labelOnly && !anyPanel && !labelState.reading;

  /** Largest still size the camera offers, so OCR sees small print. */
  const pickLargestPictureSize = async () => {
    if (pictureSize || !camera.current) {
      return;
    }
    try {
      const sizes = await camera.current.getAvailablePictureSizesAsync();
      const pixels = (value: string) => {
        const [w, h] = value.split('x').map(Number);
        return (w ?? 0) * (h ?? 0);
      };
      const best = [...sizes].sort((a, b) => pixels(b) - pixels(a))[0];
      if (best) {
        setPictureSize(best);
      }
    } catch {
      // Keep the camera default.
    }
  };

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
    if (!camera.current || capturing || analysis.current) {
      return;
    }
    // Any photo is read as a label; the session starts on the first one.
    label.ensureStarted();
    setCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({
        // Full quality: small and badly printed text needs every pixel.
        quality: 1,
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

  const seeResults = async () => {
    if (analysis.current || capturing || label.getState().reading) {
      return;
    }
    const snapshot = label.buildSnapshot(new Date().toISOString());
    if (!snapshot) {
      return;
    }
    const abort = new AbortController();
    analysis.current = abort;
    setAnalysing(true);
    setAnalysisFailed(false);
    try {
      const key = await scan.analyseSnapshot(snapshot, abort.signal);
      if (abort.signal.aborted) {
        return;
      }
      if (!key) {
        setAnalysisFailed(true);
        return;
      }
      // Clear before navigation: the late-update offer must remain eligible.
      analysis.current = null;
      label.discard();
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: '/result/[key]', params: { key } });
    } catch {
      if (!abort.signal.aborted) {
        setAnalysisFailed(true);
      }
    } finally {
      if (analysis.current === abort) {
        analysis.current = null;
        setAnalysing(false);
      }
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
  // Scan tab with no label yet: the camera fills the screen and the page
  // only scrolls if a status card pushes it past its minimum height.
  const idle = !labelOnly && !anyPanel;
  const cameraState = mountError
    ? 'unavailable'
    : !foreground
      ? 'interrupted'
      : ready
        ? 'ready'
        : 'starting';
  const reading = capturing || labelState.reading;
  const canShoot =
    permissionState === 'granted' && cameraState !== 'unavailable';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      onLayout={(event) => setAreaHeight(event.nativeEvent.layout.height)}
      alwaysBounceVertical={false}
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: idle ? 0 : space.s3,
      }}
    >
      <View
        style={{
          flexGrow: idle ? 1 : 0,
          backgroundColor: colors.camera,
        }}
      >
        <CaptureViewfinder
          scanningBarcodes={scanningBarcodes}
          permission={permissionState}
          cameraState={cameraState}
          torch={torch ? 'on' : 'off'}
          panels={panels}
          locked={locked}
          capturing={capturing || labelState.reading || analysing}
          showPanels={labelOnly || anyPanel}
          rounded={false}
          contentInsets={{ top: labelOnly ? 0 : insets.top, bottom: 0 }}
          fill={idle}
          minHeight={Math.max(
            420,
            // Idle Scan tab: grows to the space above the docked nav bar.
            // With a label in progress, leave room for its actions.
            labelOnly
              ? window.height - insets.top - 64 - 220
              : anyPanel
                ? areaHeight - 300
                : 0,
          )}
          preview={
            cameraActive ? (
              <CameraView
                ref={camera}
                style={{ flex: 1 }}
                facing="back"
                autofocus="off"
                {...{ focusPoint }}
                active={cameraActive}
                enableTorch={torch}
                animateShutter={false}
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
                onBarcodeScanned={
                  scanningBarcodes && !locked
                    ? (result) => onBarcode(result.data)
                    : undefined
                }
                pictureSize={pictureSize}
                onCameraReady={() => {
                  setReady(true);
                  // Acquire the label in the centre, then return to continuous AF.
                  setFocusPoint((point) => ({
                    x: 0.5,
                    y: 0.5,
                    request: (point?.request ?? 0) + 1,
                  }));
                  void pickLargestPictureSize();
                }}
                onMountError={() => setMountError(true)}
              />
            ) : null
          }
          onFocusPoint={(point) =>
            setFocusPoint((previous) => ({
              ...point,
              request: (previous?.request ?? 0) + 1,
            }))
          }
          onTorch={() => setTorch((on) => !on)}
          onAllow={() => void requestPermission()}
          onSettings={() => void Linking.openSettings()}
        />
      </View>

      {/* The paper dock: the shutter as the screen's one ink button, as in
          the S1 prototype, with Type the barcode under it. */}
      <View
        style={{
          paddingHorizontal: space.s5 - space.s1,
          paddingVertical: space.s4,
          gap: space.s3,
        }}
      >
        {analysing || analysisFailed ? (
          <OperationStatus
            stage="analysis"
            state={analysing ? 'pending' : 'failed'}
            message={
              analysing
                ? enGB.status.analysis.server
                : enGB.status.analysis.failed
            }
            onRetry={() => void seeResults()}
            onCancel={() => {
              analysis.current?.abort();
              analysis.current = null;
              setAnalysing(false);
            }}
          />
        ) : null}
        {canShoot ? (
          <Button
            label={
              reading
                ? enGB.status.reading.pending
                : idle
                  ? enGB.scan.photograph
                  : enGB.capture.shutter
            }
            accessibilityLabel={enGB.capture.shutter}
            variant={readyForReview ? 'outline' : 'primary'}
            busy={reading || analysing}
            disabledReason={
              locked
                ? enGB.scan.barcodeDetected
                : cameraState === 'starting'
                  ? enGB.scan.cameraStarting
                  : cameraState === 'interrupted'
                    ? enGB.scan.cameraInterrupted
                    : undefined
            }
            onPress={() => void takePhoto()}
          />
        ) : null}
        {idle ? (
          <>
            {message ? (
              <AppText color="ink2" accessibilityLiveRegion="polite">
                {message}
              </AppText>
            ) : null}
            <View style={{ alignItems: 'center' }}>
              <Button
                label={enGB.scan.typeBarcode}
                variant="text"
                onPress={() => setManualOpen(true)}
              />
            </View>
          </>
        ) : (
          <>
            {labelState.reading ? (
              <AppText color="ink2" accessibilityLiveRegion="polite">
                {enGB.status.reading.pending}
              </AppText>
            ) : session && nutritionStillOptional(session) ? (
              <AppText color="ink2" accessibilityLiveRegion="polite">
                {enGB.capture.ingredientsRead}
              </AppText>
            ) : message ? (
              <AppText color="ink2" accessibilityLiveRegion="polite">
                {message}
              </AppText>
            ) : null}
            {session &&
            !readyForReview &&
            session.nutrition.state !== 'missing' &&
            session.ingredients.state === 'missing' ? (
              <Button
                label={enGB.capture.markAbsent(enGB.capture.panels.ingredients)}
                variant="outline"
                onPress={() => label.markAbsent('ingredients')}
              />
            ) : null}
            <Button
              label={enGB.capture.seeResults}
              variant={readyForReview ? 'primary' : 'outline'}
              busy={analysing}
              disabledReason={
                readyForReview && !capturing && !labelState.reading
                  ? undefined
                  : enGB.capture.needOther(missing[0] ?? '')
              }
              onPress={() => void seeResults()}
            />
            {readyForReview ? (
              <Button
                label={enGB.review.title}
                variant="text"
                disabledReason={
                  analysing ? enGB.status.analysis.server : undefined
                }
                onPress={() => router.push('/review')}
              />
            ) : null}
            {!labelOnly && anyPanel ? (
              <Button
                label={enGB.scan.startOver}
                variant="text"
                disabledReason={
                  analysing ? enGB.status.analysis.server : undefined
                }
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
          autoFocus
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
