import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Last known OS setting, read once at startup so screens opened later know
 * it on their first render. Until the OS answers, and if the query fails,
 * motion is treated as reduced (INTERACTIONS.md §1).
 */
let cached: boolean | null = null;

AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    cached = value;
  })
  .catch(() => {
    cached = true;
  });

AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  cached = value;
});

/**
 * True when the OS asks for reduced motion. Subscribes to changes, so
 * turning the setting on mid-animation stops it at the next render.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(cached ?? true);

  useEffect(() => {
    let active = true;
    if (cached === null) {
      AccessibilityInfo.isReduceMotionEnabled()
        .then((value) => {
          if (active) {
            setReduced(value);
          }
        })
        .catch(() => undefined);
    }
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => setReduced(value),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
