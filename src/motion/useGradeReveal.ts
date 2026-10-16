import { useCallback, useEffect } from 'react';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { duration, easing } from './durations';
import type { RevealMotion } from './reveal';

/**
 * Animated style for a grade badge: scale 0.92→1 and fade 0→1.
 * 'still' renders the final frame at once. `skip()` jumps to the final frame
 * mid-animation. If reduced motion turns on while running, the animation is
 * cancelled onto its final frame.
 */
export function useGradeReveal(motion: RevealMotion, reducedMotion: boolean) {
  const animate = motion !== 'still' && !reducedMotion;
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      cancelAnimation(progress);
      progress.set(1);
      return;
    }
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

  const style = useAnimatedStyle(() => ({
    // v18 prototype values: never fully hidden, grows from 78%.
    opacity: 0.2 + 0.8 * progress.get(),
    transform: [{ scale: 0.78 + 0.22 * progress.get() }],
  }));

  return { style, skip };
}
