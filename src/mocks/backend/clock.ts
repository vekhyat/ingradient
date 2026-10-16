import type { MockClock } from './types';

/**
 * SystemClock uses JavaScript's global timer functions.
 * When Jest fake timers (`jest.useFakeTimers()`) are active,
 * this clock operates synchronously under fake-timer control with zero real waiting.
 */
export class SystemClock implements MockClock {
  setTimeout(callback: () => void, ms: number): unknown {
    return globalThis.setTimeout(callback, ms);
  }

  clearTimeout(id: unknown): void {
    globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>);
  }

  now(): number {
    return Date.now();
  }
}

interface QueuedTimer {
  readonly id: number;
  readonly runAt: number;
  readonly callback: () => void;
  cancelled: boolean;
}

/**
 * ManualClock is an injected deterministic clock that allows tests
 * to advance time explicitly without relying on global timer overrides.
 */
export class ManualClock implements MockClock {
  private currentTime = 0;
  private nextTimerId = 1;
  private readonly timers: QueuedTimer[] = [];

  setTimeout(callback: () => void, ms: number): number {
    const id = this.nextTimerId++;
    this.timers.push({
      id,
      runAt: this.currentTime + Math.max(0, ms),
      callback,
      cancelled: false,
    });
    this.timers.sort((a, b) => a.runAt - b.runAt);
    return id;
  }

  clearTimeout(id: unknown): void {
    const timer = this.timers.find((t) => t.id === id);
    if (timer) {
      timer.cancelled = true;
    }
  }

  now(): number {
    return this.currentTime;
  }

  advanceBy(ms: number): void {
    if (ms < 0) {
      throw new Error('Cannot rewind manual clock');
    }
    const targetTime = this.currentTime + ms;
    while (this.timers.length > 0) {
      const next = this.timers[0];
      if (!next || next.runAt > targetTime) {
        break;
      }
      this.timers.shift();
      this.currentTime = next.runAt;
      if (!next.cancelled) {
        next.callback();
      }
    }
    this.currentTime = targetTime;
  }

  tick(): void {
    this.advanceBy(1);
  }
}
