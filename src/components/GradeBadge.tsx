import { forwardRef, useImperativeHandle } from 'react';
import { PixelRatio, Text } from 'react-native';
import Animated from 'react-native-reanimated';

import { enGB } from '../copy/en-GB';
import { useReducedMotion } from '../motion/reduced-motion';
import type { RevealMotion } from '../motion/reveal';
import { useGradeReveal } from '../motion/useGradeReveal';
import { gradeColor } from '../theme/resolve-theme';
import { useColors } from '../theme/ThemeProvider';
import { size as sizes, type } from '../theme/tokens';
import type { Letter } from '../view-models/types';

export interface GradeBadgeProps {
  letter: Letter;
  role: 'scientific' | 'personal';
  size: 'lg' | 'md' | 'sm';
  motion: RevealMotion;
  /** Set false when the parent row already speaks "Product grade C". */
  speak?: boolean;
}

export interface GradeBadgeHandle {
  skip: () => void;
}

const GLYPH = {
  lg: type.gradeLetter,
  md: { ...type.gradeLetter, fontSize: 20, lineHeight: 24 },
  sm: { ...type.gradeLetter, fontSize: 14, lineHeight: 18 },
} as const;

const MIN = {
  lg: sizes.badgeLg,
  md: sizes.badgeMd,
  sm: sizes.badgeSm,
} as const;

/**
 * Component 07. A supported A–E letter on a fixed fill. The letter is always
 * painted, so colour is never the only signal. There is no "no letter"
 * variant: a parent with no supported letter does not mount this.
 */
export const GradeBadge = forwardRef<GradeBadgeHandle, GradeBadgeProps>(
  function GradeBadge({ letter, size, motion, speak = true }, ref) {
    const colors = useColors();
    const reducedMotion = useReducedMotion();
    const { style, skip } = useGradeReveal(motion, reducedMotion);
    useImperativeHandle(ref, () => ({ skip }), [skip]);

    // Grow with the OS text size so the letter never clips at 200%.
    const glyph = GLYPH[size];
    const scaled = Math.max(
      MIN[size],
      glyph.lineHeight * PixelRatio.getFontScale() + 12,
    );

    return (
      <Animated.View
        accessible={speak}
        accessibilityRole={speak ? 'image' : undefined}
        accessibilityLabel={speak ? enGB.grade.name(letter) : undefined}
        importantForAccessibility={speak ? 'yes' : 'no-hide-descendants'}
        accessibilityElementsHidden={!speak}
        style={[
          {
            width: scaled,
            height: scaled,
            borderRadius: scaled / 2,
            backgroundColor: gradeColor(colors, letter),
            borderWidth: sizes.badgeRing,
            borderColor: colors.badgeRing,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[glyph, { color: colors.onGrade, textAlign: 'center' }]}
        >
          {letter}
        </Text>
      </Animated.View>
    );
  },
);
