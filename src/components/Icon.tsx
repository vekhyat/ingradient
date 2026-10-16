import { Text, type StyleProp, type TextStyle } from 'react-native';

import { fontFamily, size as sizes } from '../theme/tokens';

export interface IconProps {
  /** Material Symbols ligature name, for example "barcode_scanner". */
  name: string;
  filled?: boolean;
  size?: number;
  color: string;
  /** Give a label only when the icon has no visible text beside it. */
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Material Symbols Rounded, drawn from the bundled font by ligature name.
 * Decorative by default: the visible label beside it carries the meaning.
 */
export function Icon({
  name,
  filled = false,
  size = sizes.icon,
  color,
  accessibilityLabel,
  style,
}: IconProps) {
  const decorative = accessibilityLabel === undefined;
  return (
    <Text
      allowFontScaling={false}
      accessible={!decorative}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      style={[
        {
          fontFamily: filled ? fontFamily.iconFilled : fontFamily.icon,
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          color,
          textAlign: 'center',
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {name}
    </Text>
  );
}
