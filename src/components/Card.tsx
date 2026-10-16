import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

/**
 * One flat grouping level: no shadow, no card inside a card
 * (DESIGN-LANGUAGE §1).
 */
export function Card({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.md,
          padding: padded ? space.s4 : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Hairline between rows inside a card. Decorative only. */
export function Divider() {
  const colors = useColors();
  return (
    <View
      style={{ height: 1, backgroundColor: colors.hair }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
