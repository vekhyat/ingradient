/**
 * Which reveal a result badge plays (D58, INTERACTIONS.md §3).
 *
 * - The first new result in a session: 600 ms.
 * - A later new result in the same session: 300 ms.
 * - Reduced motion: instant.
 * - Opening from History, pressing Back, or returning to a result that was
 *   already shown: instant, never a replay.
 *
 * A "session" is one app process. This is plain state, not timing, so it is
 * unit-tested here and the animation just reads the answer.
 */

export type RevealMotion = 'first' | 'repeat' | 'still';

export type ResultOrigin = 'new' | 'history';

export class RevealSession {
  private readonly revealed = new Set<string>();
  private anyRevealed = false;

  /**
   * Decide the motion for one result. Calling it marks the result as shown,
   * so a second call for the same key (Back, re-render) returns 'still'.
   */
  motionFor(
    resultKey: string,
    origin: ResultOrigin,
    reducedMotion: boolean,
  ): RevealMotion {
    if (this.revealed.has(resultKey)) {
      return 'still';
    }
    this.revealed.add(resultKey);
    if (origin === 'history') {
      return 'still';
    }
    const motion: RevealMotion = this.anyRevealed ? 'repeat' : 'first';
    this.anyRevealed = true;
    return reducedMotion ? 'still' : motion;
  }

  /** True once this key has been decided; used to skip haptics on return. */
  hasShown(resultKey: string): boolean {
    return this.revealed.has(resultKey);
  }
}

/** One per app process. */
export const revealSession = new RevealSession();
