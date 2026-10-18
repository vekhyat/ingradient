import { describe, expect, it } from '@jest/globals';

import {
  hasUnsavedLabelWork,
  type LabelFlowState,
} from '../capture/label-flow';
import { createLabelSession } from '../capture/label-session';
import { NO_CORRECTIONS } from '../capture/label-snapshot';
import { leaveScanDecision } from './leave-guard';

function flowState(overrides: Partial<LabelFlowState> = {}): LabelFlowState {
  return {
    session: createLabelSession('label-1', null),
    base: null,
    corrections: NO_CORRECTIONS,
    retake: null,
    reading: false,
    lastOutcome: null,
    ...overrides,
  };
}

describe('hasUnsavedLabelWork', () => {
  it('is clean with no session or an untouched one', () => {
    expect(hasUnsavedLabelWork(flowState({ session: null }))).toBe(false);
    expect(hasUnsavedLabelWork(flowState())).toBe(false);
  });

  it('is clean when an earlier record supplied the panels', () => {
    const session = createLabelSession('label-1', '8901030000001', {
      ingredients: true,
    });
    expect(hasUnsavedLabelWork(flowState({ session }))).toBe(false);
  });

  it('is dirty once a photo is kept', () => {
    const session = {
      ...createLabelSession('label-1', null),
      photos: [{ imageId: 'img-1', uri: 'file:///photo.jpg' }],
    };
    expect(hasUnsavedLabelWork(flowState({ session }))).toBe(true);
  });

  it('is dirty when the user marked a panel as not on the pack', () => {
    const base = createLabelSession('label-1', null);
    const session = {
      ...base,
      nutrition: { ...base.nutrition, state: 'user_marked_absent' as const },
    };
    expect(hasUnsavedLabelWork(flowState({ session }))).toBe(true);
  });

  it('is dirty with any correction', () => {
    expect(
      hasUnsavedLabelWork(
        flowState({
          corrections: {
            ingredients: {},
            nutrients: { sugars: { kind: 'unreadable' } },
          },
        }),
      ),
    ).toBe(true);
    expect(
      hasUnsavedLabelWork(
        flowState({
          corrections: {
            ingredients: { 'ing-1': { kind: 'text', text: 'salt' } },
            nutrients: {},
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('leaveScanDecision', () => {
  it('asks only when leaving Scan with unsaved label work', () => {
    expect(leaveScanDecision('scan', 'history', true)).toBe('ask');
    expect(leaveScanDecision('scan', 'you', true)).toBe('ask');
  });

  it('goes for a clean Scan, a re-tap of Scan, or other tabs', () => {
    expect(leaveScanDecision('scan', 'history', false)).toBe('go');
    expect(leaveScanDecision('scan', 'scan', true)).toBe('go');
    expect(leaveScanDecision('history', 'you', true)).toBe('go');
    expect(leaveScanDecision('you', 'scan', true)).toBe('go');
  });
});
