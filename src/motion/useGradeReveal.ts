import { useCallback, useEffect, useRef } from 'react';
import {
  cancelAnimation,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { easing } from './durations';
import type { RevealMotion } from './reveal';

export interface RevealProgress {
  /** 0 → 1 over the reveal; 1 at once for 'still' or reduced motion. */
  progress: SharedValue<number>;
  /** Jumps to the final frame mid-animation. */
  skip: () => void;
}

/**
 * Shared progress for a grade reveal. 'still' renders the final frame at
 * once. If reduced motion turns on while running, the animation is
 * cancelled onto its final frame. `onEnd` runs once the final frame is
 * shown, whether the animation finished, was skipped or never ran.
 */
export function useRevealProgress(
  motion: RevealMotion,
  reducedMotion: boolean,
  timing: { first: number; repeat: number; delay?: number },
  onEnd?: () => void,
): RevealProgress {
  const animate = motion !== 'still' && !reducedMotion;
  const progress = useSharedValue(animate ? 0 : 1);
  const endRef = useRef(onEnd);
  useEffect(() => {
    endRef.current = onEnd;
  }, [onEnd]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const end = useCallback(() => {
    clear();
    endRef.current?.();
  }, [clear]);
  const ms = motion === 'first' ? timing.first : timing.repeat;
  const delay = timing.delay ?? 0;

  useEffect(() => {
    if (!animate) {
      cancelAnimation(progress);
      progress.set(1);
      end();
      return;
    }
    progress.set(0);
    const run = () => {
      progress.set(withTiming(1, { duration: ms, easing: easing.reveal }));
      // A JS timer of the same length, so no worklet callback is needed.
      timer.current = setTimeout(end, ms);
    };
    // A delay lets a route finish sliding in, so the reveal is seen.
    if (delay > 0) {
      timer.current = setTimeout(run, delay);
    } else {
      run();
    }
    return clear;
  }, [animate, ms, delay, progress, end, clear]);

  const skip = useCallback(() => {
    cancelAnimation(progress);
    progress.set(1);
    end();
  }, [progress, end]);

  return { progress, skip };
}
