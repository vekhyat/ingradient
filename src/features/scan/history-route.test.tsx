import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  useEffect as mockUseEffect,
  useSyncExternalStore as mockUseSyncExternalStore,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import HistoryTab from '../../app/(tabs)/history';
import ResultScreen from '../../app/result/[key]';
import {
  createSnapshotStore,
  MemoryRecordTable,
} from '../../adapters/storage/snapshot-store';
import { AppText } from '../../components/AppText';
import { HistoryList, formatSavedDate } from '../../components/HistoryList';
import { enGB } from '../../copy/en-GB';
import { getLocalScenario } from '../../fixtures/scenarios';
import { useResult } from '../result/useResult';
import { methodNotInstalledAnalyser } from './analyser';
import { ScanSession } from './scan-session';

let mockScan: ScanSession;
let mockStore: ReturnType<typeof createSnapshotStore>;
let mockStoreStatus: {
  status: 'ready';
  store: ReturnType<typeof createSnapshotStore>;
};
let mockKey = '';
const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ key: mockKey }),
  useFocusEffect: (effect: () => void) => mockUseEffect(effect, [effect]),
}));
jest.mock('../app/services', () => ({
  useServices: () => ({
    scan: mockScan,
    store: mockStoreStatus,
    storeRevision: 0,
    bumpStore: jest.fn(),
    reopenStore: jest.fn(),
    label: { start: jest.fn() },
  }),
  useScanState: () =>
    mockUseSyncExternalStore(mockScan.subscribe, mockScan.getState),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: jest.requireActual<typeof import('react-native')>('react-native')
      .View,
  },
  Easing: { bezier: () => (value: number) => value },
  cancelAnimation: () => undefined,
  interpolate: () => 1,
  withTiming: (value: number) => value,
  useAnimatedStyle: (style: () => unknown) => style(),
  useSharedValue: (initial: number) => ({
    get: () => initial,
    set: () => undefined,
  }),
}));
jest.mock('../../motion/useResultReveal', () => ({
  useResultReveal: () => ({}),
  useRevealSection: () => ({}),
}));
jest.mock('../../motion/reduced-motion', () => ({
  useReducedMotion: () => true,
}));
jest.mock('../../motion/haptics', () => ({ haptics: { play: jest.fn() } }));
jest.mock('../../components/useInitialFocus', () => ({
  useInitialFocus: () => null,
}));

describe('History reopens distinct saved and analysis dates', () => {
  let screen: ReactTestRenderer | undefined;
  let viewedAnalysis: string | null | undefined;
  const savedAt = '2026-10-20T08:00:00Z';
  const scenario = getLocalScenario('complete_graded');
  function ResultProbe() {
    const result = useResult(mockKey);
    viewedAnalysis = result?.view.analysedAt;
    return <ResultScreen />;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockKey = '';
    mockStore = createSnapshotStore(new MemoryRecordTable());
    mockStoreStatus = { status: 'ready', store: mockStore };
    mockScan = new ScanSession(
      { lookupBarcode: async () => ({ state: 'absent', issues: [] }) },
      methodNotInstalledAnalyser,
    );
    screen = undefined;
  });
  afterEach(async () => {
    await act(() => screen?.unmount());
  });

  it.each(['2026-10-18T08:00:00Z', null])(
    'preserves analysis time %s while displaying the true saved date',
    async (analysedAt) => {
      await mockStore.save({
        schemaVersion: 1,
        id: 'saved-1',
        savedAt,
        kind: 'product',
        snapshot: scenario.snapshot,
        assessment: scenario.assessment,
        executor: 'phone',
        analysedAt,
      });
      await act(async () => {
        screen = create(<HistoryTab />);
      });
      await act(async () => {
        screen?.root.findByType(HistoryList).props.onOpen('saved-1');
      });
      mockKey = (
        mockRouter.push.mock.calls[0]?.[0] as { params: { key: string } }
      ).params.key;
      expect(mockScan.getResult(mockKey)).toMatchObject({
        savedId: 'saved-1',
        analysedAt,
        savedAt,
      });
      await act(async () => {
        screen?.update(<ResultProbe />);
      });
      expect(viewedAnalysis).toBe(analysedAt);
      const text = screen?.root
        .findAllByType(AppText)
        .map((node) => node.props.children)
        .flat()
        .join(' ');
      expect(text).toContain(enGB.result.savedOn(formatSavedDate(savedAt)));
      if (analysedAt)
        expect(text).not.toContain(
          enGB.result.savedOn(formatSavedDate(analysedAt)),
        );
    },
  );
});
