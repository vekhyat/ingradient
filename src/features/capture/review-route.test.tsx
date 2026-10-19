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
import { enGB } from '../../copy/en-GB';
import type { ProductSnapshot } from '../../domain/contracts/generated/local';
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
});
