import { forwardRef, useImperativeHandle } from 'react';
import { PixelRatio, Text } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { enGB } from '../copy/en-GB';
import { duration } from '../motion/durations';
import { useReducedMotion } from '../motion/reduced-motion';
import type { RevealMotion } from '../motion/reveal';
import { useRevealProgress } from '../motion/useGradeReveal';
import { gradeColor } from '../theme/resolve-theme';
import { useColors } from '../theme/ThemeProvider';
import { size as sizes, type } from '../theme/tokens';
import type { Letter } from '../view-models/types';

export interface GradeBadgeProps {
  letter: Letter;
  role: 'scientific' | 'personal';
  size: 'xl' | 'lg' | 'md' | 'sm';
  motion: RevealMotion;
  /** Set false when the parent row already speaks "Scientific product grade C". */
  speak?: boolean;
  /** A slight inked-stamp tilt; used for the headline grade on Result. */
  tilt?: boolean;
  /** Wait before landing, so a route can finish sliding in first. */
  delay?: number;
}

export interface GradeBadgeHandle {
  skip: () => void;
}

const GLYPH = {
  xl: { ...type.gradeLetter, fontSize: 38, lineHeight: 42 },
  lg: { ...type.gradeLetter, fontSize: 34, lineHeight: 38 },
  md: { ...type.gradeLetter, fontSize: 24, lineHeight: 28 },
  sm: { ...type.gradeLetter, fontSize: 16, lineHeight: 20 },
} as const;

const MIN = {
  xl: sizes.badgeXl,
  lg: sizes.badgeLg,
  md: sizes.badgeMd,
  sm: sizes.badgeSm,
} as const;

const TILT = -6;

/**
 * Component 07. A supported A–E letter as a square ink-bordered stamp on a
 * fixed fill. The letter is always printed, so colour is never the only
 * signal. The reveal stamps it down: it drops in large and turned, lands a
 * little small, then settles. There is no "no letter" variant: a parent
 * with no supported letter does not mount this.
 */
export const GradeBadge = forwardRef<GradeBadgeHandle, GradeBadgeProps>(
  function GradeBadge(
    { letter, size, motion, speak = true, tilt = false, delay = 0 },
    ref,
  ) {
    const colors = useColors();
    const reducedMotion = useReducedMotion();
    const { progress, skip } = useRevealProgress(motion, reducedMotion, {
      first: duration.stampFirst,
      repeat: duration.stampRepeat,
      delay,
    });
    useImperativeHandle(ref, () => ({ skip }), [skip]);

    const rest = tilt ? TILT : 0;
    const style = useAnimatedStyle(() => {
      const p = progress.get();
      return {
        opacity: interpolate(p, [0, 0.35], [0, 1], 'clamp'),
        transform: [
          { scale: interpolate(p, [0, 0.6, 1], [2.2, 0.92, 1], 'clamp') },
          {
            rotate: `${interpolate(p, [0, 0.6, 1], [rest - 8, rest, rest], 'clamp')}deg`,
          },
        ],
      };
    });

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
