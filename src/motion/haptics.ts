import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * The three haptic cues allowed by INTERACTIONS.md §1. Names describe what
 * happened, never a verdict: "result ready" is not "this food is safe".
 *
 * - selection: an explicit mode or tab choice.
 * - resultReady: a supported result first appears.
 * - hardWarning: the user newly enters a hard-warning state (S3).
 *
 * Each cue fires at most once per key, so re-renders and Back do not buzz
 * again. Haptics are never the only signal; failures are silent.
 */
export type HapticCue = 'selection' | 'resultReady' | 'hardWarning';

export interface HapticDriver {
  selection(): Promise<void>;
  resultReady(): Promise<void>;
  hardWarning(): Promise<void>;
}

export const expoHapticDriver: HapticDriver = {
  selection: () => Haptics.selectionAsync(),
  resultReady: () =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  hardWarning: () =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
};

export class HapticCues {
  private readonly fired = new Set<string>();

  constructor(private readonly driver: HapticDriver) {}

  /**
   * Plays a cue. `onceKey` makes the cue fire only the first time for that
   * key (for example one result). Selection cues pass no key.
   */
  play(cue: HapticCue, onceKey?: string): boolean {
    if (onceKey !== undefined) {
      const key = `${cue}:${onceKey}`;
      if (this.fired.has(key)) {
        return false;
      }
      this.fired.add(key);
    }
    this.driver[cue]().catch(() => undefined);
    return true;
  }
}

export const haptics = new HapticCues(expoHapticDriver);
