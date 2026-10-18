import { useEffect, useRef } from 'react';
import { AccessibilityInfo, type Text } from 'react-native';

/**
 * SCREENS.md §4 and component 04: a screen's title (or an opened sheet's
 * title) takes screen-reader focus once on entry. Does nothing without a
 * screen reader, so sighted focus and the keyboard are untouched.
 */
export function useInitialFocus(active = true) {
  const target = useRef<Text>(null);
  useEffect(() => {
    if (!active) {
      return;
    }
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((screenReader) => {
        if (mounted && screenReader && target.current) {
          AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [active]);
  return target;
}
