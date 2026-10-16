import { useCallback, useEffect } from 'react';
import {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { duration, easing } from './durations';
import type { RevealMotion } from './reveal';

/**
 * Result-screen reveal from the v18 prototype (D58 timing):
 * - product card rises 10 px from 45% opacity over the first half;
 * - the answer card settles from 16 px below at 50% opacity;
 * - later cards follow in a short cascade, each starting slightly later.
 *
 * Every section starts at least half visible, so the result is readable from
 * the first frame; motion only adds emphasis. 'still' (History, Back,
 * reduced motion) draws the final frame immediately.
 */

export interface ResultReveal {
  progress: SharedValue<number>;
  skip: () => void;
}

export function useResultReveal(
  motion: RevealMotion,
  reducedMotion: boolean,
): ResultReveal {
  const animate = motion !== 'still' && !reducedMotion;
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      cancelAnimation(progress);
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration:
          motion === 'first' ? duration.gradeFirst : duration.gradeRepeat,
        easing: easing.reveal,
      }),
    );
  }, [animate, motion, progress]);

  const skip = useCallback(() => {
    cancelAnimation(progress);
    progress.set(1);
  }, [progress]);

  return { progress, skip };
}

/**
 * Style for section `index` (0 = product card, 1 = answer, 2+ = cascade).
 * Each section animates over its own window of the shared progress.
 */
export function useRevealSection(progress: SharedValue<number>, index: number) {
  return useAnimatedStyle(() => {
    const start = index === 0 ? 0 : Math.min(0.08 * index, 0.4);
    const end = index === 0 ? 0.5 : Math.min(start + 0.8, 1);
    const local = interpolate(progress.get(), [start, end], [0, 1], 'clamp');
    const fromOpacity = index === 0 ? 0.45 : 0.5;
    const fromY = index === 0 ? 10 : 16;
    return {
      opacity: fromOpacity + (1 - fromOpacity) * local,
      transform: [{ translateY: fromY * (1 - local) }],
    };
  });
}
