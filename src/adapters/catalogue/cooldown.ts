/**
 * Manages client-side rate limit cooldowns.
 *
 * Honours HTTP 429 Retry-After responses and enforces a strict client-side
 * pause without an automatic retry loop.
 */
export class CooldownManager {
  private cooldownUntilMs = 0;

  /**
   * Checks whether the client is currently in a cooldown period.
   *
   * @param nowMs - Current epoch milliseconds
   */
  public isThrottled(nowMs: number): boolean {
    return nowMs < this.cooldownUntilMs;
  }

  /**
   * Returns remaining cooldown duration in seconds, rounded up.
   *
   * @param nowMs - Current epoch milliseconds
   */
  public getRemainingSeconds(nowMs: number): number {
    if (!this.isThrottled(nowMs)) {
      return 0;
    }
    const diffMs = this.cooldownUntilMs - nowMs;
    return Math.max(1, Math.ceil(diffMs / 1000));
  }

  /**
   * Records a cooldown period ending at nowMs + seconds * 1000.
   *
   * @param seconds - Duration in seconds
   * @param nowMs - Current epoch milliseconds
   */
  public setCooldown(seconds: number, nowMs: number): void {
    const duration = Math.max(1, Math.ceil(seconds));
    this.cooldownUntilMs = Math.max(
      this.cooldownUntilMs,
      nowMs + duration * 1000,
    );
  }

  /**
   * Resets any active cooldown (useful in tests).
   */
  public reset(): void {
    this.cooldownUntilMs = 0;
  }

  /**
   * Parses the HTTP Retry-After header into a duration in seconds.
   * Supports integer seconds and RFC 7231 HTTP dates.
   *
   * @param headerValue - Value of the Retry-After response header
   * @param defaultSeconds - Fallback seconds if header is missing or unparseable
   * @param nowMs - Current epoch milliseconds
   */
  public static parseRetryAfter(
    headerValue: string | null | undefined,
    defaultSeconds: number,
    nowMs: number,
  ): number {
    if (!headerValue) {
      return defaultSeconds;
    }

    const trimmed = headerValue.trim();

    // Try parsing as integer seconds
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSeconds;
    }

    // Try parsing as HTTP-date
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const diffSeconds = Math.ceil((parsedDate - nowMs) / 1000);
      return diffSeconds > 0 ? diffSeconds : defaultSeconds;
    }

    return defaultSeconds;
  }
}
