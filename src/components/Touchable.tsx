import { useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { size } from '../theme/tokens';

export interface TouchableProps extends Omit<
  PressableProps,
  'style' | 'children'
> {
  style?: StyleProp<ViewStyle>;
  /** Corner radius used for the press layer and focus ring. */
  radius?: number;
  /** Colour of the press state layer; defaults to ink. */
  layerColor?: string;
  children: ReactNode;
}

/**
 * Pressable with the design's press feedback: a translucent state layer on
 * the next render (no scale), and a 2 px focus ring 2 px outside the control
 * for keyboard and switch access.
 */
export function Touchable({
  style,
  radius = 0,
  layerColor,
  children,
  disabled,
  onFocus,
  onBlur,
  ...rest
}: TouchableProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      disabled={disabled}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[{ minHeight: size.targetMin, borderRadius: radius }, style]}
      {...rest}
    >
      {({ pressed }) => (
        <>
          {children}
          {pressed && !disabled ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: radius,
                  backgroundColor: layerColor ?? colors.ink,
                  opacity: 0.1,
                },
              ]}
            />
          ) : null}
          {focused ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -(size.focusOffset + size.focusStroke),
                left: -(size.focusOffset + size.focusStroke),
                right: -(size.focusOffset + size.focusStroke),
                bottom: -(size.focusOffset + size.focusStroke),
                borderRadius: radius + size.focusOffset + size.focusStroke,
                borderWidth: size.focusStroke,
                borderColor: colors.focus,
              }}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}
