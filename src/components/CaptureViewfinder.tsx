import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { enGB } from '../copy/en-GB';
import { duration } from '../motion/durations';
import { useReducedMotion } from '../motion/reduced-motion';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import type { PanelPresence } from '../view-models/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface CaptureViewfinderProps {
  /** False while a label is being photographed, so a printed barcode cannot pull the user away. */
  scanningBarcodes: boolean;
  permission: 'unknown' | 'granted' | 'denied' | 'blocked';
  cameraState: 'starting' | 'ready' | 'interrupted' | 'unavailable';
  torch: 'unsupported' | 'off' | 'on';
  panels: readonly PanelPresence[];
  /** True between detecting a barcode and the lookup finishing. */
  locked?: boolean;
  /** Disables the shutter while a photo is being taken or read. */
  capturing?: boolean;
  /** The live camera surface, supplied by the screen. */
  preview?: ReactNode;
  /** Shows which label panels are present once a label photo exists. */
  showPanels: boolean;
  /** Camera height; the screen gives it most of the window. */
  minHeight?: number;
  /** Extra space inside the camera for the status bar and a floating nav bar. */
  contentInsets?: { top: number; bottom: number };
  /** Round the bottom corners (pushed capture screen) or run edge to edge (Scan tab). */
  rounded?: boolean;
  onCapture: () => void;
  onTorch: () => void;
  onManualBarcode: () => void;
  onAllow: () => void;
  onSettings: () => void;
  onFocusPoint?: (point: { x: number; y: number; request: number }) => void;
}

function Corner({
  position,
  locked,
}: {
  position: 'tl' | 'tr' | 'bl' | 'br';
  locked: boolean;
}) {
  const colors = useColors();
  const reducedMotion = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    borderColor: withTiming(locked ? colors.onCamera : colors.primary, {
      duration: reducedMotion ? 0 : duration.cameraLock,
    }),
  }));
  const top = position[0] === 't';
  const left = position[1] === 'l';
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: 40,
          height: 40,
          [top ? 'top' : 'bottom']: 0,
          [left ? 'left' : 'right']: 0,
          borderTopWidth: top ? 4 : 0,
          borderBottomWidth: top ? 0 : 4,
          borderLeftWidth: left ? 4 : 0,
          borderRightWidth: left ? 0 : 4,
          borderTopLeftRadius: top && left ? radius.md : 0,
          borderTopRightRadius: top && !left ? radius.md : 0,
          borderBottomLeftRadius: !top && left ? radius.md : 0,
          borderBottomRightRadius: !top && !left ? radius.md : 0,
        },
        style,
      ]}
    />
  );
}

const TEXT_SHADOW = {
  // Strong, tight shadow: readable over most packs without a box or gradient.
  textShadowColor: 'rgba(0,0,0,0.95)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 10,
} as const;

/**
 * Instruction under the frame (D136): plain centred text with a strong
 * shadow, no box. One main line and an optional quieter hint.
 */
function CameraPill({ text, hint }: { text: string; hint?: string }) {
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={hint ? `${text}. ${hint}` : text}
      style={{
        alignSelf: 'center',
        maxWidth: '90%',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <AppText
        variant="subhead"
        color="onCamera"
        style={[{ textAlign: 'center' }, TEXT_SHADOW]}
      >
        {text}
      </AppText>
      {hint ? (
        <AppText
          variant="bodySm"
          color="onCamera"
          style={[{ textAlign: 'center', opacity: 0.85 }, TEXT_SHADOW]}
        >
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

function PanelChips({ panels }: { panels: readonly PanelPresence[] }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: space.s2,
        justifyContent: 'center',
      }}
    >
      {panels.map((panel) => {
        const done = panel.state === 'read' || panel.state === 'uncertain';
        return (
          <View
            key={panel.panel}
            accessible
            accessibilityLabel={`${enGB.capture.panels[panel.panel]}: ${enGB.capture.panelState[panel.state]}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s1,
              backgroundColor: colors.camera,
              borderRadius: radius.full,
              paddingHorizontal: space.s3,
              paddingVertical: space.s1,
            }}
          >
            <Icon
              name={done ? 'check_circle' : 'radio_button_unchecked'}
              filled={done}
              size={18}
              color={done ? colors.primary : colors.onCamera}
            />
            <AppText variant="label" color="onCamera">
              {`${enGB.capture.panels[panel.panel]} · ${enGB.capture.panelState[panel.state]}`}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Component 15, unified capture (D116). One camera, no Barcode/Label switch:
 * it watches for a barcode while the shutter photographs a label. Controls
 * sit on fixed camera colours so text stays readable over any camera image.
 * Permission problems and an unavailable camera are explicit states with a
 * way forward (Allow, Settings, or type the barcode).
 */
export function CaptureViewfinder({
  scanningBarcodes,
  permission,
  cameraState,
  torch,
  panels,
  locked = false,
  capturing = false,
  preview,
  showPanels,
  minHeight = 460,
  contentInsets = { top: 0, bottom: 0 },
  rounded = true,
  onCapture,
  onTorch,
  onManualBarcode,
  onAllow,
  onSettings,
  onFocusPoint,
}: CaptureViewfinderProps) {
  const colors = useColors();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusRequest = useRef(0);
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );
  const requestFocus = (x: number, y: number) => {
    if (!bounds.width || !bounds.height) return;
    // Accessibility activation has no touch coordinates; focus the centre.
    const point = {
      x: x > 0 ? Math.min(x, bounds.width) : bounds.width / 2,
      y: y > 0 ? Math.min(y, bounds.height) : bounds.height / 2,
    };
    setFocusPoint(point);
    onFocusPoint?.({
      x: point.x / bounds.width,
      y: point.y / bounds.height,
      request: ++focusRequest.current,
    });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocusPoint(null), 1200);
  };

  const blocked = permission === 'denied' || permission === 'blocked';
  let notice: string | null = null;
  if (permission === 'unknown' || blocked) {
    notice = blocked ? enGB.scan.permissionBlocked : enGB.scan.permissionBody;
  } else if (cameraState === 'unavailable') {
    notice = enGB.scan.cameraUnavailable;
  } else if (cameraState === 'interrupted') {
    notice = enGB.scan.cameraInterrupted;
  }

  const statusText = locked
    ? enGB.scan.barcodeDetected
    : cameraState === 'starting'
      ? enGB.scan.cameraStarting
      : capturing
        ? enGB.status.reading.pending
        : scanningBarcodes
          ? enGB.scan.pointAtEither
          : enGB.capture.hint;
  const statusHint =
    !locked && !capturing && cameraState !== 'starting' && scanningBarcodes
      ? `${enGB.scan.tapToFocus} · ${enGB.scan.barcodeAuto}`
      : undefined;

  return (
    <View
      onLayout={(event) => setBounds(event.nativeEvent.layout)}
      style={{
        backgroundColor: colors.camera,
        borderBottomLeftRadius: rounded ? radius.lg : 0,
        borderBottomRightRadius: rounded ? radius.lg : 0,
        overflow: 'hidden',
        minHeight,
      }}
    >
      {permission === 'granted' && cameraState !== 'unavailable' ? (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          {preview}
        </View>
      ) : null}

      {onFocusPoint && permission === 'granted' && cameraState === 'ready' ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={enGB.scan.focusCamera}
          accessibilityHint={enGB.scan.focusHint}
          disabled={capturing || locked}
          onPress={(event) =>
            requestFocus(
              event.nativeEvent.locationX,
              event.nativeEvent.locationY,
            )
          }
          onAccessibilityTap={() => requestFocus(0, 0)}
        />
      ) : null}
      {focusPoint ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, Math.min(focusPoint.x - 28, bounds.width - 56)),
            top: Math.max(0, Math.min(focusPoint.y - 28, bounds.height - 56)),
            width: 56,
            height: 56,
            borderRadius: radius.sm,
            borderWidth: 2,
            borderColor: colors.onCamera,
          }}
        />
      ) : null}

      <View
        pointerEvents="box-none"
        style={{
          padding: space.s4,
          paddingTop: space.s4 + contentInsets.top,
          paddingBottom: space.s4 + contentInsets.bottom,
          gap: space.s4,
          flex: 1,
        }}
      >
        <View
          pointerEvents="box-none"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.s2,
          }}
        >
          <Touchable
            accessibilityRole="button"
            radius={radius.full}
            layerColor={colors.onCamera}
            onPress={onManualBarcode}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s2,
              paddingHorizontal: space.s4,
              borderRadius: radius.full,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          >
            <Icon name="keyboard" color={colors.onCamera} />
            <AppText variant="button" color="onCamera">
              {enGB.scan.typeBarcode}
            </AppText>
          </Touchable>
          {torch !== 'unsupported' && permission === 'granted' ? (
            <Touchable
              accessibilityRole="switch"
              accessibilityState={{ checked: torch === 'on' }}
              accessibilityLabel={
                torch === 'on' ? enGB.scan.torchOn : enGB.scan.torchOff
              }
              radius={radius.full}
              layerColor={colors.onCamera}
              onPress={onTorch}
              style={{
                width: size.targetMin,
                height: size.targetMin,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.full,
                backgroundColor: 'rgba(0,0,0,0.55)',
              }}
            >
              <Icon
                name={torch === 'on' ? 'flashlight_on' : 'flashlight_off'}
                color={colors.onCamera}
              />
            </Touchable>
          ) : null}
        </View>

        {notice ? (
          <View
            style={{
              backgroundColor: colors.camera,
              borderRadius: radius.md,
              padding: space.s4,
              gap: space.s3,
            }}
          >
            <AppText variant="heading" color="onCamera" heading>
              {enGB.scan.permissionTitle}
            </AppText>
            <AppText color="onCamera">{notice}</AppText>
            {permission === 'unknown' || permission === 'denied' ? (
              <Button
                label={enGB.scan.permissionAllow}
                variant="tonal"
                onPress={onAllow}
              />
            ) : null}
            {permission === 'blocked' ? (
              <Button
                label={enGB.scan.openSettings}
                variant="tonal"
                onPress={onSettings}
              />
            ) : null}
          </View>
        ) : (
          <>
            <View
              pointerEvents="none"
              style={{
                flex: 1,
                minHeight: 200,
                marginHorizontal: space.s4,
                justifyContent: 'center',
              }}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Corner position="tl" locked={locked} />
              <Corner position="tr" locked={locked} />
              <Corner position="bl" locked={locked} />
              <Corner position="br" locked={locked} />
            </View>
            {showPanels ? <PanelChips panels={panels} /> : null}
            <CameraPill text={statusText} hint={statusHint} />
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={enGB.capture.shutter}
              accessibilityState={{ busy: capturing, disabled: capturing }}
              disabled={capturing || locked || cameraState !== 'ready'}
              radius={radius.full}
              layerColor={colors.onPrimary}
              onPress={onCapture}
              style={{
                alignSelf: 'center',
                width: 72,
                height: 72,
                borderRadius: radius.full,
                // Theme colour (D132): the shutter follows the app palette.
                backgroundColor: colors.primary,
                borderWidth: 4,
                borderColor: colors.onCamera,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: capturing || locked ? 0.5 : 1,
              }}
            >
              <Icon name="photo_camera" color={colors.onPrimary} />
            </Touchable>
          </>
        )}
      </View>
    </View>
  );
}
