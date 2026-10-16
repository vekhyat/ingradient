import { Text, type TextProps } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { type, type ThemeColors, type TypeName } from '../theme/tokens';

type ColorToken = keyof ThemeColors;

export interface AppTextProps extends TextProps {
  variant?: TypeName;
  color?: ColorToken;
  /** Marks the text as a heading for screen readers. */
  heading?: boolean;
}

/**
 * Text in the app type scale. Font size follows the OS text-size setting;
 * nothing here caps scaling, so 200% text grows the layout instead of
 * clipping.
 */
export function AppText({
  variant = 'body',
  color = 'ink',
  heading = false,
  style,
  ...rest
}: AppTextProps) {
  const colors = useColors();
  return (
    <Text
      accessibilityRole={heading ? 'header' : rest.accessibilityRole}
      style={[type[variant], { color: colors[color] }, style]}
      {...rest}
    />
  );
}
