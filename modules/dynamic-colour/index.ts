import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface SystemColours {
  method: 'roles' | 'palettes';
  apiLevel: number;
  light: Record<string, string>;
  dark: Record<string, string>;
}

interface DynamicColourNative {
  getSystemColours(): SystemColours | null;
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<DynamicColourNative>('DynamicColour')
    : null;

/**
 * Wallpaper colours from Android 12+, or null on iOS, older Android, or a
 * build without the native module. Never throws.
 */
export function getSystemColours(): SystemColours | null {
  if (!native) {
    return null;
  }
  try {
    return native.getSystemColours();
  } catch {
    return null;
  }
}
