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

import vectors from '../../../resources/vectors/nutriscore-vectors.json';
import ResultScreen from '../../app/result/[key]';
import {
  createSnapshotStore,
  MemoryRecordTable,
} from '../../adapters/storage/snapshot-store';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { GradeBadge } from '../../components/GradeBadge';
import { Touchable } from '../../components/Touchable';
import { enGB } from '../../copy/en-GB';
import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { localValidators } from '../../domain/contracts/generated/validate-local';
import { installedResources } from '../../domain/hybrid/resources';
import { phoneAnalyser } from '../../domain/pipeline/phone-analyser';
import { getLocalScenario } from '../../fixtures/scenarios';
import type { StoreStatus } from '../app/services';
import type { AnalysisUpdate, ProductAnalyser } from '../scan/analyser';
import { ScanSession } from '../scan/scan-session';

let mockScan: ScanSession;
let mockStore: StoreStatus;
let mockRouteKey = '';
const mockBumpStore = jest.fn();
const mockLabelStart = jest.fn();
const mockRouter = { push: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ key: mockRouteKey }),
}));
jest.mock('../app/services', () => ({
  useServices: () => ({
    scan: mockScan,
    store: mockStore,
    bumpStore: mockBumpStore,
    label: { start: mockLabelStart },
  }),
  useScanState: () =>
    mockUseSyncExternalStore(mockScan.subscribe, mockScan.getState),
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

/** Canonical measured inputs; the real engine produces every assessment. */
function supportedSnapshot(): ProductSnapshot {
  const source = getLocalScenario('complete_graded').snapshot;
  const vector = vectors.vectors[0];
  if (!vector) throw new Error('Missing canonical input');
  const sourceId = source.sourceRefs[0]?.id;
  if (!sourceId) throw new Error('Missing fixture label source');
  const candidate: unknown = {
    ...source,
    id: 'route-supported-input',
    taxonomyVersion: installedResources().taxonomyVersion,
    evidenceVersion: installedResources().evidenceVersion,
    category: 'general',
    ingredients: [],
    scoringFacts: {
      categorySourceIds: [sourceId],
      cheese: { state: 'absent', sourceIds: [sourceId] },
      redMeat: { state: 'absent', sourceIds: [sourceId] },
      plainWater: { state: 'absent', sourceIds: [sourceId] },
      nonNutritiveSweetener: { state: 'absent', sourceIds: [sourceId] },
    },
    observations: vector.inputs.observations.map((observation) => ({
      ...observation,
      kind: 'read' as const,
      sourceIds: [sourceId],
      issues: [],
    })),
  };
  if (!localValidators.ProductSnapshot(candidate)) {
    throw new Error(
      'The route fixture must satisfy the local snapshot contract',
    );
  }
  return candidate as ProductSnapshot;
}

describe('actual result route with real phone analysis and session', () => {
  let screen: ReactTestRenderer | undefined;
  let table: MemoryRecordTable;

  beforeEach(() => {
    jest.clearAllMocks();
    screen = undefined;
    table = new MemoryRecordTable();
    mockStore = { status: 'ready', store: createSnapshotStore(table) };
    mockScan = new ScanSession(
      { lookupBarcode: async () => ({ state: 'absent', issues: [] }) },
      phoneAnalyser,
    );
    mockRouteKey = '';
  });

  afterEach(() => {
    act(() => screen?.unmount());
  });

  async function analyse(
    input = supportedSnapshot(),
    analyser: ProductAnalyser = phoneAnalyser,
  ) {
    mockScan = new ScanSession(
      { lookupBarcode: async () => ({ state: 'found', snapshot: input }) },
      analyser,
    );
    const key = await mockScan.analyseSnapshot(
      input,
      new AbortController().signal,
    );
    if (!key) throw new Error('Expected an analysed result');
    return key;
  }

  async function show(key: string) {
    mockRouteKey = key;
    await act(async () => {
      if (screen) screen.update(<ResultScreen key={key} />);
      else screen = create(<ResultScreen key={key} />);
    });
  }

  function text() {
    return screen?.root
      .findAllByType(AppText)
      .map((node) => node.props.children)
      .flat()
      .join(' ');
  }

  async function press(label: string) {
    const button = screen?.root
      .findAllByType(Touchable)
      .find(
        (node) =>
          node.props.accessibilityLabel === label ||
          node
            .findAllByType(AppText)
            .some((child) => child.props.children === label),
      );
    if (!button) throw new Error(`Missing action: ${label}`);
    await act(async () => {
      button.props.onPress();
    });
    // Button's same-tick duplicate guard releases before a subsequent action.
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  it('renders the installed scientific reference grade and never saves automatically', async () => {
    const key = await analyse();
    await show(key);
    expect(screen?.root.findByType(GradeBadge).props.letter).toBe('A');
    expect(
      screen?.root
        .findAllByType(Touchable)
        .some((node) => node.props.accessibilityLabel === enGB.grade.name('A')),
    ).toBe(true);
    expect(text()).toContain(enGB.result.analysedOnPhone);
    expect(
      screen?.root
        .findAllByType(Button)
        .some((button) => button.props.label === enGB.result.save),
    ).toBe(true);
    expect(table.rows.size).toBe(0);
    expect(mockScan.getResult(key)?.savedId).toBeNull();
  });

  it('renders a named refusal without a grade and offers adding the missing nutrition panel', async () => {
    const input = supportedSnapshot();
    input.observations = [];
    const key = await analyse(input);
    await show(key);
    expect(screen?.root.findAllByType(GradeBadge)).toHaveLength(0);
    expect(text()).toContain(enGB.assessment.insufficientTitle);
    await press(enGB.addNutrition.action);
    expect(mockLabelStart).toHaveBeenCalledWith(input);
    expect(mockRouter.push).toHaveBeenCalledWith('/capture');
    expect(table.rows.size).toBe(0);
  });

  it('shows the concrete fallback explanation from the analysed session result', async () => {
    const analyser: ProductAnalyser = {
      async analyse(input, signal) {
        return {
          ...(await phoneAnalyser.analyse(input, signal)),
          fallbackIssue: {
            code: 'backend_offline',
            stage: 'method',
            message:
              'The analysis server could not be reached, so this phone analysed the product.',
            action: 'none',
          },
        };
      },
    };
    const key = await analyse(supportedSnapshot(), analyser);
    await show(key);
    expect(text()).toContain(mockScan.getResult(key)?.fallbackIssue?.message);
    expect(screen?.root.findByType(GradeBadge).props.letter).toBe('A');
  });

  it('expands reviewed reasons and routes their cited source with the current result key', async () => {
    const key = await analyse();
    await show(key);
    const assessment = mockScan.getResult(key)?.assessment;
    const reason = assessment?.scientific.reasons[0];
    const citation = assessment?.citations.find(
      (item) => item.id === reason?.citationIds[0],
    );
    if (!reason || !citation)
      throw new Error('Canonical grade must have a reviewed cited reason');
    expect(text()).not.toContain(citation.title);
    await press(enGB.common.show);
    expect(text()).toContain(reason.text);
    await press(enGB.reasons.openSource(citation.title));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/reason/[key]/[reasonId]',
      params: { key, reasonId: reason.id, citationId: citation.id },
    });
    expect(table.rows.size).toBe(0);
  });

  it('keeps a late result as an explicit offer, opens a separate route, and preserves the original on Back', async () => {
    let offer: (update: AnalysisUpdate) => void = () => undefined;
    const analyser: ProductAnalyser = {
      async analyse(input, signal) {
        return {
          ...(await phoneAnalyser.analyse(input, signal)),
          lateUpdate: new Promise<AnalysisUpdate>((resolve) => {
            offer = resolve;
          }),
        };
      },
    };
    const key = await analyse(supportedSnapshot(), analyser);
    const original = mockScan.getResult(key);
    if (!original) throw new Error('Missing original phone result');
    await show(key);
    expect(text()).not.toContain(enGB.assessment.updateAvailable);
    await act(async () => {
      offer({
        assessment: original.assessment,
        executor: 'backend',
        introducesHardFinding: false,
      });
    });
    expect(text()).toContain(enGB.assessment.updateAvailable);
    expect(text()).toContain(enGB.assessment.updateSame);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockScan.getResult(key)?.executor).toBe('phone');
    await press(enGB.assessment.updateOpen);
    const destination = mockRouter.push.mock.calls[0]?.[0] as {
      pathname: string;
      params: { key: string };
    };
    expect(destination.pathname).toBe('/result/[key]');
    expect(destination.params.key).not.toBe(key);
    expect(mockScan.getResult(destination.params.key)?.updateOf).toBe(key);
    await show(destination.params.key);
    expect(text()).toContain(enGB.result.analysedOnServer);
    await press(enGB.common.back);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    await show(key);
    expect(mockScan.getResult(key)?.assessment).toBe(original?.assessment);
    expect(text()).toContain(enGB.result.analysedOnPhone);
    expect(text()).not.toContain(enGB.assessment.updateAvailable);
    expect(table.rows.size).toBe(0);
  });

  it('reports a failed explicit save, retries, and confirms only the persisted result', async () => {
    const key = await analyse();
    await show(key);
    table.failNextWrite = 'disk unavailable';
    await press(enGB.result.save);
    expect(text()).toContain(enGB.status.saving.failed);
    expect(table.rows.size).toBe(0);
    expect(mockScan.getResult(key)?.savedId).toBeNull();
    expect(mockBumpStore).not.toHaveBeenCalled();
    await press(enGB.result.save);
    expect(text()).toContain(enGB.result.saved);
    expect(text()).not.toContain(enGB.status.saving.failed);
    const savedId = mockScan.getResult(key)?.savedId;
    expect(savedId).toBe(`saved-${key}`);
    if (mockStore.status !== 'ready' || !savedId)
      throw new Error('Save was not confirmed');
    const saved = await mockStore.store.get(savedId);
    expect(saved.assessment).toEqual(mockScan.getResult(key)?.assessment);
    expect(saved.executor).toBe('phone');
    expect(mockBumpStore).toHaveBeenCalledTimes(1);
  });

  it('cannot publish or save a cancelled analysis and renders a stale key as unavailable', async () => {
    const controller = new AbortController();
    const pending = mockScan.analyseSnapshot(
      supportedSnapshot(),
      controller.signal,
    );
    controller.abort();
    expect(await pending).toBeNull();
    expect(Object.keys(mockScan.getState().results)).toHaveLength(0);
    await show('cancelled-result');
    expect(text()).toContain(enGB.source.error);
    expect(screen?.root.findAllByType(GradeBadge)).toHaveLength(0);
    expect(screen?.root.findAllByType(Button)).toHaveLength(0);
    expect(table.rows.size).toBe(0);
  });
});
