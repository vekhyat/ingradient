import { useCallback, useEffect, useRef } from 'react';
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
 * cancelled onto its final frame. `onEnd` runs once the final frame is shown,
 * whether the animation finished, was skipped or never ran.
 */
export function useGradeReveal(
  motion: RevealMotion,
  reducedMotion: boolean,
  onEnd?: () => void,
) {
  const animate = motion !== 'still' && !reducedMotion;
  const progress = useSharedValue(animate ? 0 : 1);
  const endRef = useRef(onEnd);
  useEffect(() => {
    endRef.current = onEnd;
  }, [onEnd]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const end = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    endRef.current?.();
  }, []);

  useEffect(() => {
    if (!animate) {
      cancelAnimation(progress);
      progress.set(1);
      end();
      return;
    }
    const ms = motion === 'first' ? duration.gradeFirst : duration.gradeRepeat;
    progress.set(withTiming(1, { duration: ms, easing: easing.reveal }));
    // A JS timer of the same length, so no worklet callback is needed.
    timer.current = setTimeout(end, ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [animate, motion, progress, end]);

  const skip = useCallback(() => {
    cancelAnimation(progress);
    progress.set(1);
    end();
  }, [progress, end]);

  const style = useAnimatedStyle(() => ({
    // v18 prototype values: never fully hidden, grows from 78%.
    opacity: 0.2 + 0.8 * progress.get(),
    transform: [{ scale: 0.78 + 0.22 * progress.get() }],
  }));

  return { style, skip };
}
