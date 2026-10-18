import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { MaterialSymbolsRounded_400Regular } from '@expo-google-fonts/material-symbols-rounded/400Regular';
import { MaterialSymbolsRounded_400Regular_Filled } from '@expo-google-fonts/material-symbols-rounded/400Regular_Filled';
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_700Bold,
  WorkSans_900Black,
} from '@expo-google-fonts/work-sans';
import { useFonts } from 'expo-font';

/**
 * Fonts are bundled into the app, not downloaded at runtime, so text looks
 * the same offline. Work Sans for words, IBM Plex Mono for figures and
 * codes (the S1 nutrition-panel prototype). Devanagari text uses the phone's
 * own Noto fallback: React Native cannot chain a second custom font per glyph.
 */
export function useAppFonts(): { loaded: boolean; error: Error | null } {
  const [loaded, error] = useFonts({
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_700Bold,
    WorkSans_900Black,
    IBMPlexMono_500Medium,
    MaterialSymbolsRounded_400Regular,
    MaterialSymbolsRounded_400Regular_Filled,
  });
  return { loaded, error };
}
