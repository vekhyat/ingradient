import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { resolveTheme, type ResolvedTheme } from './resolve-theme';
import type { ColorScheme } from './tokens';

const ThemeContext = createContext<ResolvedTheme>(resolveTheme('light', null));

/**
 * Provides the resolved theme for the system light or dark setting. The
 * nutrition-panel direction uses fixed ink and turmeric, so no wallpaper
 * palette is read (this replaces the Material You behaviour of D48).
 * Changing theme only swaps colours: no screen remounts.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const scheme: ColorScheme = system === 'dark' ? 'dark' : 'light';
  const theme = useMemo(() => resolveTheme(scheme, null), [scheme]);
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
