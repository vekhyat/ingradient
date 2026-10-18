import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { Modal } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import TabsLayout from '../../app/(tabs)/_layout';
import { NavBar } from '../../components/NavBar';
import { Touchable } from '../../components/Touchable';
import { enGB } from '../../copy/en-GB';
import { LabelFlow } from '../capture/label-flow';
import type { OcrOutcome } from '../capture/ocr-page';
import { DiscardLabelSheet } from './DiscardLabelSheet';

let mockNoticeAccepted: boolean | null = true;
let mockLabel: LabelFlow;
let mockTabIndex = 0;
const mockDeletePhoto = jest.fn<(uri: string) => void>();
const mockWarmUpBackend = jest.fn();
const mockAnalyse = jest.fn();
const mockNavigate = jest.fn<(name: string) => void>();
const mockEmit = jest.fn<
  (event: { type: string; target?: string; canPreventDefault: boolean }) => {
    defaultPrevented: boolean;
  }
>(() => ({ defaultPrevented: false }));
const mockRoutes = [
  { name: 'index', key: 'scan-key' },
  { name: 'history', key: 'history-key' },
  { name: 'you', key: 'you-key' },
];

jest.mock('expo-router', () => ({ Redirect: () => null }));
jest.mock('expo-router/js-tabs', () => ({
  Tabs: Object.assign(
    ({
      tabBar,
    }: {
      tabBar: (props: {
        state: { routes: typeof mockRoutes; index: number };
        navigation: { emit: typeof mockEmit; navigate: typeof mockNavigate };
      }) => ReactNode;
    }) =>
      tabBar({
        state: { routes: mockRoutes, index: mockTabIndex },
        navigation: { emit: mockEmit, navigate: mockNavigate },
      }),
    { Screen: () => null },
  ),
}));
jest.mock('../app/services', () => ({
  useServices: () => ({
    noticeAccepted: mockNoticeAccepted,
    label: mockLabel,
    warmUpBackend: mockWarmUpBackend,
    scan: { analyseSnapshot: mockAnalyse },
  }),
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

describe('actual tabs layout onboarding and leave-Scan guard', () => {
  let screen: ReactTestRenderer | undefined;
  let discard: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNoticeAccepted = true;
    mockTabIndex = 0;
    mockEmit.mockReturnValue({ defaultPrevented: false });
    let nextId = 0;
    mockLabel = new LabelFlow({
      adoptPhoto: async (uri) => `owned:${uri}`,
      deletePhoto: mockDeletePhoto,
      recognise: async (): Promise<OcrOutcome> => ({
        status: 'read',
        page: {
          blocks: [
            {
              text: 'Ingredients: rice, salt.',
              box: null,
              lines: [
                {
                  text: 'Ingredients: rice, salt.',
                  box: null,
                  languages: ['en'],
                },
              ],
            },
          ],
        },
      }),
      newId: () => `tab-label-${++nextId}`,
    });
    mockLabel.start(null);
    discard = jest.spyOn(mockLabel, 'discard');
  });

  afterEach(() => {
    act(() => screen?.unmount());
    screen = undefined;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function show() {
    act(() => {
      if (screen) screen.update(<TabsLayout />);
      else screen = create(<TabsLayout />);
    });
  }

  function action(label: string) {
    const target = screen?.root
      .findAllByType(Touchable)
      .find((item) => item.props.accessibilityLabel === label);
    if (!target) throw new Error(`Missing action: ${label}`);
    return target;
  }

  function press(label: string) {
    act(() => action(label).props.onPress());
  }

  function promptVisible() {
    return screen?.root.findByType(DiscardLabelSheet).props.visible;
  }

  async function dirty(kind: string) {
    if (kind === 'photo') await mockLabel.addPhoto('label-photo');
    else if (kind === 'nutrition correction') {
      mockLabel.correctNutrient('sugars', { kind: 'unreadable' });
    } else if (kind === 'ingredient correction') {
      mockLabel.correctIngredient('ingredient-1', {
        kind: 'text',
        text: 'salt',
      });
    } else {
      mockLabel.markAbsent('nutrition');
    }
    expect(mockLabel.isDirty()).toBe(true);
  }

  it('redirects unaccepted notice to onboarding before rendering tab controls', () => {
    mockNoticeAccepted = false;
    show();
    expect(screen?.root.findByType(Redirect).props.href).toBe('/onboarding');
    expect(screen?.root.findAllByType(NavBar)).toEqual([]);
    expect(screen?.root.findAllByType(DiscardLabelSheet)).toEqual([]);
    expect(mockWarmUpBackend).not.toHaveBeenCalled();
    expect(mockAnalyse).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the tab shell while notice storage is pending and makes no analysis call', () => {
    mockNoticeAccepted = null;
    show();
    expect(screen?.root.findAllByType(Redirect)).toEqual([]);
    expect(screen?.root.findByType(NavBar).props.current).toBe('scan');
    expect(mockWarmUpBackend).not.toHaveBeenCalled();
    expect(mockAnalyse).not.toHaveBeenCalled();
    mockNoticeAccepted = false;
    show();
    expect(screen?.root.findByType(Redirect).props.href).toBe('/onboarding');
    mockNoticeAccepted = true;
    show();
    expect(screen?.root.findByType(NavBar).props.current).toBe('scan');
  });

  it.each([
    [enGB.nav.history, 'history', 'history-key'],
    [enGB.nav.you, 'you', 'you-key'],
  ])('navigates a clean Scan to %s without discarding', (label, name, key) => {
    expect(mockLabel.isDirty()).toBe(false);
    const state = mockLabel.getState();
    show();
    press(label);
    expect(mockEmit.mock.calls).toEqual([
      [{ type: 'tabPress', target: key, canPreventDefault: true }],
    ]);
    expect(mockNavigate.mock.calls).toEqual([[name]]);
    expect(promptVisible()).toBe(false);
    expect(mockLabel.getState()).toBe(state);
    expect(discard).not.toHaveBeenCalled();
  });

  it.each([
    'photo',
    'nutrition correction',
    'ingredient correction',
    'marked absent',
  ])(
    'asks before leaving Scan with %s and Keep preserves every edit',
    async (kind) => {
      await dirty(kind);
      const state = mockLabel.getState();
      show();
      press(enGB.nav.history);
      expect(promptVisible()).toBe(true);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      press(enGB.sheet.keepReviewing);
      expect(promptVisible()).toBe(false);
      expect(mockLabel.getState()).toBe(state);
      expect(mockDeletePhoto).not.toHaveBeenCalled();
      expect(discard).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    },
  );

  it('Discard deletes photo and corrections then navigates once despite duplicate taps', async () => {
    await dirty('photo');
    mockLabel.correctNutrient('sugars', { kind: 'unreadable' });
    show();
    press(enGB.nav.history);
    const discardButton = action(enGB.sheet.discard);
    act(() => {
      discardButton.props.onPress();
      discardButton.props.onPress();
    });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(mockDeletePhoto.mock.calls).toEqual([['owned:label-photo']]);
    expect(mockLabel.getState()).toMatchObject({
      session: null,
      corrections: { ingredients: {}, nutrients: {} },
      reading: false,
    });
    expect(mockLabel.isDirty()).toBe(false);
    expect(promptVisible()).toBe(false);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls).toEqual([['history']]);
  });

  it('Keep clears the old destination before a later Discard goes to You', async () => {
    await dirty('photo');
    show();
    press(enGB.nav.history);
    press(enGB.sheet.keepReviewing);
    press(enGB.nav.you);
    expect(promptVisible()).toBe(true);
    press(enGB.sheet.discard);
    expect(mockNavigate.mock.calls).toEqual([['you']]);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('system dismissal keeps reviewing and preserves photos', async () => {
    await dirty('photo');
    const state = mockLabel.getState();
    show();
    press(enGB.nav.history);
    act(() => screen?.root.findByType(Modal).props.onRequestClose());
    expect(promptVisible()).toBe(false);
    expect(mockLabel.getState()).toBe(state);
    expect(mockDeletePhoto).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('reselecting Scan emits its normal event and preserves dirty work', async () => {
    await dirty('photo');
    const state = mockLabel.getState();
    show();
    press(enGB.nav.scan);
    expect(promptVisible()).toBe(false);
    expect(mockNavigate.mock.calls).toEqual([['index']]);
    expect(mockLabel.getState()).toBe(state);
    expect(discard).not.toHaveBeenCalled();
    expect(mockDeletePhoto).not.toHaveBeenCalled();
  });

  it('does not navigate when a tabPress listener prevents the clean transition', () => {
    mockEmit.mockReturnValue({ defaultPrevented: true });
    show();
    press(enGB.nav.history);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(promptVisible()).toBe(false);
    expect(discard).not.toHaveBeenCalled();
  });

  it('does not ask to leave History for You when label work exists elsewhere', async () => {
    await dirty('photo');
    mockTabIndex = 1;
    const state = mockLabel.getState();
    show();
    expect(screen?.root.findByType(NavBar).props.current).toBe('history');
    press(enGB.nav.you);
    expect(promptVisible()).toBe(false);
    expect(mockNavigate.mock.calls).toEqual([['you']]);
    expect(mockLabel.getState()).toBe(state);
    expect(discard).not.toHaveBeenCalled();
  });
});
