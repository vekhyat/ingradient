import { ActivityIndicator, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';

export type OperationStage =
  'lookup' | 'capture' | 'reading' | 'matching' | 'analysis' | 'saving';

export interface OperationStatusProps {
  stage: OperationStage;
  /** Only for the analysis stage (D66, D69). */
  analysisPath?: 'server' | 'phone_fallback' | 'phone_local_only';
  state: 'pending' | 'empty' | 'failed' | 'cancelled' | 'complete';
  message: string;
  retryAfterSeconds?: number;
  onCancel?: () => void;
  onRetry?: () => void;
  onCaptureLabel?: () => void;
}

export function analysisPathText(
  path: NonNullable<OperationStatusProps['analysisPath']>,
): string {
  return path === 'server'
    ? enGB.status.analysis.server
    : enGB.status.analysis.phone;
}

/**
 * Component 17. The real stage of the running operation and the next step.
 * No percent bar and no countdown: unknown durations are shown as text.
 * Pending always offers Cancel; Retry is always an explicit tap.
 */
export function OperationStatus({
  stage,
  analysisPath,
  state,
  message,
  onCancel,
  onRetry,
  onCaptureLabel,
}: OperationStatusProps) {
  const colors = useColors();
  const text =
    stage === 'analysis' && analysisPath && state === 'pending'
      ? analysisPathText(analysisPath)
      : message;
  const icon =
    state === 'failed'
      ? 'error'
      : state === 'cancelled'
        ? 'block'
        : state === 'complete'
          ? 'check_circle'
          : 'info';

  return (
    <Card style={{ gap: space.s4 }}>
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole={state === 'failed' ? 'alert' : 'text'}
        style={{
          flexDirection: 'row',
          gap: space.s3,
          alignItems: 'flex-start',
        }}
      >
        {state === 'pending' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Icon name={icon} color={colors.ink2} />
        )}
        <AppText style={{ flex: 1 }}>{text}</AppText>
      </View>
      <View style={{ gap: space.s3 }}>
        {state === 'pending' && onCancel ? (
          <Button
            label={enGB.common.cancel}
            variant="outline"
            onPress={onCancel}
          />
        ) : null}
        {onCaptureLabel && state !== 'pending' ? (
          <Button
            label={enGB.status.photographLabel}
            variant="primary"
            icon="photo_camera"
            onPress={onCaptureLabel}
          />
        ) : null}
        {onRetry && state !== 'pending' ? (
          <Button label={enGB.common.retry} variant="tonal" onPress={onRetry} />
        ) : null}
      </View>
    </Card>
  );
}
