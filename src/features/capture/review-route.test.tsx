import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { useSyncExternalStore as mockUseSyncExternalStore } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ReviewScreen from '../../app/review';
import { Button } from '../../components/Button';
import { AppText } from '../../components/AppText';
import { PanelReview } from '../../components/PanelReview';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { Touchable } from '../../components/Touchable';
import { enGB } from '../../copy/en-GB';
import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { BASIS_LABELS, NUTRIENT_LABELS } from '../../view-models/map-result';
import { LabelFlow } from './label-flow';
import type { OcrOutcome } from './ocr-page';

let mockLabel: LabelFlow;
const mockAnalyse =
  jest.fn<
    (snapshot: ProductSnapshot, signal: AbortSignal) => Promise<string | null>
  >();
const mockRouter = {
  back: jest.fn(),
  dismissAll: jest.fn(),
  push: jest.fn(),
};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useFocusEffect: () => undefined,
  useRouter: () => mockRouter,
}));
jest.mock('../app/services', () => ({
  useServices: () => ({
    label: mockLabel,
    scan: { analyseSnapshot: mockAnalyse },
  }),
  useLabelState: () =>
    mockUseSyncExternalStore(mockLabel.subscribe, mockLabel.getState),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  const { useRef } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: { View },
    Easing: { bezier: () => (value: number) => value },
    cancelAnimation: () => undefined,
    interpolate: () => 1,
    withTiming: (value: number) => value,
    useAnimatedStyle: (style: () => unknown) => style(),
    useSharedValue: (initial: number) => {
      const reference = useRef(initial);
      return {
        get: () => reference.current,
        set: (value: number) => {
          reference.current = value;
        },
      };
    },
  };
});
jest.mock('../../motion/reduced-motion', () => ({
  useReducedMotion: () => true,
}));
jest.mock('../../motion/haptics', () => ({ haptics: { play: jest.fn() } }));
jest.mock('../../components/useInitialFocus', () => ({
  useInitialFocus: () => null,
}));

/** Holds analysis open so the test decides when it finishes. */
function pendingAnalysis() {
  let finish: (key: string | null) => void = () => undefined;
  let signal: AbortSignal | undefined;
  mockAnalyse.mockImplementation((_snapshot, abort) => {
    signal = abort;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  return {
    finish: (key: string | null) => finish(key),
    signal: () => signal,
  };
}

describe('Review cancels a pending analysis when the session goes away', () => {
  let screen: ReactTestRenderer | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    let nextId = 0;
    mockLabel = new LabelFlow({
      adoptPhoto: async (uri) => `owned:${uri}`,
      deletePhoto: () => undefined,
      recognise: async (): Promise<OcrOutcome> => ({
        status: 'read',
        page: {
          blocks: [
            {
              text: 'Ingredients: rice, salt.',
              box: null,
              lines: [
                { text: 'Ingredients: rice, salt.', box: null, languages: [] },
              ],
            },
          ],
        },
      }),
      newId: () => `label-${++nextId}`,
    });
    mockLabel.start(null);
    await mockLabel.addPhoto('photo');
    await act(async () => {
      screen = create(<ReviewScreen />);
    });
  });

  afterEach(() => {
    act(() => screen?.unmount());
    screen = undefined;
  });

  const press = (label: string) => {
    const buttons = screen?.root
      .findAllByType(Button)
      .filter((button) => button.props.label === label);
    const button = buttons?.[buttons.length - 1];
    if (!button) throw new Error(`No button ${label}`);
    act(() => button.props.onPress());
  };

  it('Discard aborts it and the finished analysis opens nothing', async () => {
    const analysis = pendingAnalysis();
    press(enGB.review.analyse);
    press(enGB.review.discard);
    press(enGB.sheet.discard);
    expect(analysis.signal()?.aborted).toBe(true);
    await act(async () => analysis.finish('result-1'));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('Retake aborts it', async () => {
    const analysis = pendingAnalysis();
    press(enGB.review.analyse);
    press(enGB.capture.retake(enGB.capture.panels.ingredients));
    expect(analysis.signal()?.aborted).toBe(true);
    await act(async () => analysis.finish('result-1'));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('leaving the screen aborts it', async () => {
    const analysis = pendingAnalysis();
    press(enGB.review.analyse);
    act(() => screen?.unmount());
    screen = undefined;
    expect(analysis.signal()?.aborted).toBe(true);
  });

  it('a finished analysis keeps its signal for the late server update', async () => {
    const analysis = pendingAnalysis();
    press(enGB.review.analyse);
    await act(async () => analysis.finish('result-1'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/result/[key]',
      params: { key: 'result-1' },
    });
    act(() => screen?.unmount());
    screen = undefined;
    expect(analysis.signal()?.aborted).toBe(false);
  });

  function correctionSheet() {
    return screen!.root.findAllByType(Sheet)[0]!;
  }

  function field() {
    return screen!.root.findByType(TextField);
  }

  function openNutrient(rowId: string) {
    act(() =>
      screen!.root
        .findByType(PanelReview)
        .props.onEditNutrient('sugars', rowId),
    );
  }

  async function twoColumns() {
    const base = mockLabel.buildSnapshot('2026-10-20T08:00:00Z')!;
    base.observations = [
      {
        field: 'sugars',
        kind: 'read',
        value: 12,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: [base.sourceRefs[0]!.id],
        issues: [],
      },
      {
        field: 'sugars',
        kind: 'read',
        value: 3,
        unit: 'g',
        basis: 'per_serving',
        sourceIds: [base.sourceRefs[0]!.id],
        issues: [],
      },
    ];
    await act(async () => mockLabel.start(base));
  }

  it('opens an unchanged nutrient sheet clean and marks clearing its value dirty', async () => {
    await twoColumns();
    openNutrient('1');
    expect(field().props.value).toBe('3');
    expect(correctionSheet().props.dirty).toBe(false);
    act(() => field().props.onChange(''));
    expect(correctionSheet().props.dirty).toBe(true);
    act(() => field().props.onChange('3'));
    expect(correctionSheet().props.dirty).toBe(false);
  });

  it.each(['unit', 'basis'] as const)(
    'marks a %s-only change dirty',
    async (change) => {
      await twoColumns();
      openNutrient('1');
      press(change === 'unit' ? 'kJ' : BASIS_LABELS.per_100_ml!);
      expect(correctionSheet().props.dirty).toBe(true);
    },
  );

  it('edits the second column value and basis independently, then marks only the first unreadable', async () => {
    await twoColumns();
    openNutrient('1');
    act(() => field().props.onChange('5'));
    press(BASIS_LABELS.per_100_ml!);
    act(() => correctionSheet().props.primaryAction.onPress());
    expect(mockLabel.getState().corrections.nutrients).toEqual({
      'sugars:1': { kind: 'value', value: 5, unit: 'g', basis: 'per_100_ml' },
    });
    openNutrient('0');
    act(() => correctionSheet().props.secondaryAction.onPress());
    const values = mockLabel.buildSnapshot(
      '2026-10-20T08:00:00Z',
    )!.observations;
    expect(values[0]).toMatchObject({ kind: 'missing', reason: 'unreadable' });
    expect(values[1]).toMatchObject({
      kind: 'corrected',
      value: 5,
      basis: 'per_100_ml',
    });
  });

  it('passes the original row id through the actual PanelReview edit control', async () => {
    await twoColumns();
    const edits = screen!.root
      .findAllByType(Touchable)
      .filter(
        (node) =>
          node.props.accessibilityLabel ===
          enGB.review.edit(NUTRIENT_LABELS.sugars!),
      );
    expect(edits).toHaveLength(2);
    act(() => edits[1]!.props.onPress());
    expect(field().props.value).toBe('3');
    act(() => field().props.onChange('8'));
    act(() => correctionSheet().props.primaryAction.onPress());
    expect(
      mockLabel.getState().corrections.nutrients['sugars:1'],
    ).toMatchObject({ value: 8 });
  });

  it('keeps an oversized ingredient correction inline without changing the snapshot', () => {
    const rice = mockLabel.buildSnapshot('2026-10-20T08:00:00Z')!
      .ingredients[0]!;
    act(() =>
      screen!.root.findByType(PanelReview).props.onEditIngredient(rice.id),
    );
    act(() => field().props.onChange('x'.repeat(2001)));
    act(() => correctionSheet().props.primaryAction.onPress());
    expect(correctionSheet().props.visible).toBe(true);
    expect(mockLabel.getState().corrections.ingredients).toEqual({});
    expect(
      screen!.root
        .findAllByType(AppText)
        .some(
          (node) =>
            node.props.accessibilityRole === 'alert' &&
            String(node.props.children).includes('2000'),
        ),
    ).toBe(true);
    act(() => field().props.onChange('oats'));
    act(() => correctionSheet().props.primaryAction.onPress());
    expect(
      mockLabel.buildSnapshot('2026-10-20T08:00:00Z')!.ingredients[0]?.text,
    ).toBe('oats');
  });
});
