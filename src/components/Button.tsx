import { useRef } from 'react';
import { View } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export type ButtonVariant = 'primary' | 'tonal' | 'outline' | 'text';

export interface ButtonProps {
  label: string;
  variant: ButtonVariant;
  icon?: string;
  busy?: boolean;
  /** Required when the button cannot run; shown beside it. */
  disabledReason?: string;
  onPress: () => void;
  /** Overrides the accessible name when the label alone is ambiguous. */
  accessibilityLabel?: string;
}

/**
 * Component 01. One labelled action, printed rather than pill-shaped: a
 * solid ink block, an outlined box, or underlined text. Busy shows a
 * turmeric bar along the bottom and ignores repeat presses; disabled always
 * says why. No danger colour and no press scale.
 */
export function Button({
  label,
  variant,
  icon,
  busy = false,
  disabledReason,
  onPress,
  accessibilityLabel,
}: ButtonProps) {
  const colors = useColors();
  const disabled = disabledReason !== undefined;
  // Guards a second press that lands before the parent re-renders busy.
  const pressedWhileBusy = useRef(false);

  const fill =
    variant === 'primary'
      ? colors.primary
      : variant === 'tonal'
        ? colors.primarySoft
        : 'transparent';
  const ink =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'tonal'
        ? colors.onPrimarySoft
        : colors.ink;
  const text = variant === 'text';

  return (
    <View style={{ gap: space.s1 }}>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ busy, disabled }}
        accessibilityHint={disabledReason}
        disabled={disabled}
        radius={radius.sm}
        layerColor={ink}
        onPress={() => {
          if (busy || pressedWhileBusy.current) {
            return;
          }
          pressedWhileBusy.current = true;
          // Released on the next tick; a parent that sets busy keeps it blocked.
          setTimeout(() => {
            pressedWhileBusy.current = false;
          }, 0);
          onPress();
        }}
        style={{
          minHeight:
            variant === 'primary' ? size.targetPrimary : size.targetMin,
          borderRadius: radius.sm,
          backgroundColor: fill,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: colors.hair2,
          paddingHorizontal: text ? space.s1 : space.s5,
          alignSelf: text ? 'flex-start' : undefined,
          overflow: 'hidden',
          paddingVertical: space.s3,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.s2,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {icon ? <Icon name={icon} color={ink} /> : null}
        <AppText
          variant="button"
          style={{
            color: ink,
            flexShrink: 1,
            textAlign: 'center',
            textDecorationLine: text ? 'underline' : 'none',
          }}
        >
          {label}
        </AppText>
        {busy ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              left: space.s5,
              right: space.s5,
              bottom: space.s3 - 2,
              height: 3,
              backgroundColor: colors.accent,
            }}
          />
        ) : null}
      </Touchable>
      {disabledReason ? (
        <AppText variant="bodySm" color="ink2">
          {disabledReason}
        </AppText>
      ) : null}
    </View>
  );
}
