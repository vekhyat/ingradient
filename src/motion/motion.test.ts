import { describe, expect, it, jest } from '@jest/globals';

import { HapticCues, type HapticDriver } from './haptics';
import { RevealSession } from './reveal';

describe('RevealSession (D58)', () => {
  it('plays 600 ms first, then 300 ms for later new results', () => {
    const session = new RevealSession();
    expect(session.motionFor('a', 'new', false)).toBe('first');
    expect(session.motionFor('b', 'new', false)).toBe('repeat');
    expect(session.motionFor('c', 'new', false)).toBe('repeat');
  });

  it('never replays a result on Back or re-render', () => {
    const session = new RevealSession();
    expect(session.motionFor('a', 'new', false)).toBe('first');
    expect(session.motionFor('a', 'new', false)).toBe('still');
    expect(session.hasShown('a')).toBe(true);
  });

  it('opens History results without motion', () => {
    const session = new RevealSession();
    expect(session.motionFor('saved', 'history', false)).toBe('still');
    // A History open does not use up the session's first reveal.
    expect(session.motionFor('a', 'new', false)).toBe('first');
  });

  it('is instant under reduced motion and still counts the reveal', () => {
    const session = new RevealSession();
    expect(session.motionFor('a', 'new', true)).toBe('still');
    expect(session.motionFor('b', 'new', false)).toBe('repeat');
  });
});

function fakeDriver() {
  const calls: string[] = [];
  const driver: HapticDriver = {
    selection: jest.fn(async () => {
      calls.push('selection');
    }),
    resultReady: jest.fn(async () => {
      calls.push('resultReady');
    }),
    hardWarning: jest.fn(async () => {
      calls.push('hardWarning');
    }),
  };
  return { driver, calls };
}

describe('HapticCues', () => {
  it('fires a keyed cue once per key', () => {
    const { driver, calls } = fakeDriver();
    const cues = new HapticCues(driver);
    expect(cues.play('resultReady', 'r1')).toBe(true);
    expect(cues.play('resultReady', 'r1')).toBe(false);
    expect(cues.play('resultReady', 'r2')).toBe(true);
    expect(calls).toEqual(['resultReady', 'resultReady']);
  });

  it('keeps informational and hard-warning cues distinct', () => {
    const { driver, calls } = fakeDriver();
    const cues = new HapticCues(driver);
    cues.play('resultReady', 'r1');
    cues.play('hardWarning', 'r1');
    expect(calls).toEqual(['resultReady', 'hardWarning']);
  });

  it('does not throw when the hardware rejects', async () => {
    const driver: HapticDriver = {
      selection: () => Promise.reject(new Error('no vibrator')),
      resultReady: () => Promise.reject(new Error('no vibrator')),
      hardWarning: () => Promise.reject(new Error('no vibrator')),
    };
    const cues = new HapticCues(driver);
    expect(() => cues.play('selection')).not.toThrow();
    await Promise.resolve();
  });
});
