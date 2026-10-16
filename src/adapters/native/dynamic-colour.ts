import { getSystemColours } from '../../../modules/dynamic-colour';
import type { ColorScheme } from '../../theme/tokens';

/**
 * Thin adapter over the native wallpaper-colour module (DESIGN-LANGUAGE §2).
 * Returns the raw role map for one scheme, unchecked. The theme resolver
 * decides whether it is safe to use.
 */
export function readDynamicRoles(scheme: ColorScheme): unknown {
  const colours = getSystemColours();
  if (!colours) {
    return null;
  }
  return scheme === 'dark' ? colours.dark : colours.light;
}

export function dynamicColourMethod(): string | null {
  const colours = getSystemColours();
  return colours ? `${colours.method} (API ${colours.apiLevel})` : null;
}
