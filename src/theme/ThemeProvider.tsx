import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, useColorScheme } from 'react-native';

import { readDynamicRoles } from '../adapters/native/dynamic-colour';
import { resolveTheme, type ResolvedTheme } from './resolve-theme';
import type { ColorScheme } from './tokens';

const ThemeContext = createContext<ResolvedTheme>(resolveTheme('light', null));

/**
 * Provides the resolved theme. Re-reads wallpaper colours when the app comes
 * back to the foreground, because the user may have changed wallpaper or
 * dark mode in Settings. Changing theme only swaps colours: navigation state
 * and unsaved edits are untouched because no screen remounts.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const scheme: ColorScheme = system === 'dark' ? 'dark' : 'light';
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setRevision((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  const theme = useMemo(
    () => resolveTheme(scheme, readDynamicRoles(scheme)),
    // revision forces a fresh native read after returning to the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, revision],
  );

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}

export function useColors() {
  return useContext(ThemeContext).colors;
}
