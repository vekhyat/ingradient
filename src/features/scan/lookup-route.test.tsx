import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  useSyncExternalStore as mockUseSyncExternalStore,
  type ReactNode,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import LookupScreen from '../../app/lookup';
import { getLocalScenario } from '../../fixtures/scenarios';
import {
  methodNotInstalledAnalyser,
  type AnalysisUpdate,
  type ProductAnalyser,
} from './analyser';
import { ScanSession } from './scan-session';

let mockScan: ScanSession;
const mockRouter = { replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../app/services', () => ({
  useServices: () => ({ scan: mockScan, label: { start: jest.fn() } }),
  useScanState: () =>
    mockUseSyncExternalStore(mockScan.subscribe, mockScan.getState),
}));
jest.mock('../app/ScreenFrame', () => ({
  ScreenFrame: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../components/OperationStatus', () => ({
  OperationStatus: () => null,
}));
jest.mock('../../components/AppText', () => ({ AppText: () => null }));

describe('actual Lookup route lifecycle', () => {
  let screen: ReactTestRenderer | undefined;
  let signal: AbortSignal;
  let offer: (update: AnalysisUpdate) => void;
  const scenario = getLocalScenario('complete_graded');

  beforeEach(() => {
    jest.clearAllMocks();
    screen = undefined;
    const analyser: ProductAnalyser = {
      async analyse(snapshot, abort) {
        signal = abort;
        const local = await methodNotInstalledAnalyser.analyse(snapshot, abort);
        return {
          ...local,
          lateUpdate: new Promise<AnalysisUpdate>((resolve) => {
            offer = resolve;
          }),
        };
      },
    };
    mockScan = new ScanSession(
      {
        lookupBarcode: async () => ({
          state: 'found',
          snapshot: scenario.snapshot,
        }),
      },
      analyser,
    );
  });

  afterEach(async () => {
    await act(() => screen?.unmount());
  });

  async function openAndUnmount() {
    act(() => {
      screen = create(<LookupScreen />);
    });
    await act(async () => {
      await mockScan.lookup('3017624010701');
    });
    const destination = mockRouter.replace.mock.calls[0]?.[0] as {
      params: { key: string };
    };
    expect(destination).toMatchObject({ pathname: '/result/[key]' });
    expect(mockScan.getState().lookup.status).toBe('idle');
    act(() => {
      screen?.unmount();
      screen = undefined;
    });
    return destination.params.key;
  }

  it('keeps a late backend offer eligible after acknowledge, replace, and actual route unmount', async () => {
    const key = await openAndUnmount();
    expect(signal.aborted).toBe(false);
    await act(async () => {
      offer({
        assessment: scenario.assessment,
        executor: 'backend',
        introducesHardFinding: false,
      });
    });
    expect(mockScan.getResult(key)?.pendingUpdate?.executor).toBe('backend');
    expect(mockScan.getResult(key)?.executor).toBe('phone');
  });

  it.each(['superseded', 'backgrounded'] as const)(
    'still drops an update when %s after successful handoff',
    async (reason) => {
      const key = await openAndUnmount();
      const oldOffer = offer;
      await act(async () => {
        if (reason === 'superseded') await mockScan.lookup('96385074');
        else mockScan.dropPendingUpdates();
        oldOffer({
          assessment: scenario.assessment,
          executor: 'backend',
          introducesHardFinding: false,
        });
      });
      expect(mockScan.getResult(key)?.pendingUpdate).toBeNull();
    },
  );

  it('aborts a pending lookup when the actual route unmounts without handing off', async () => {
    let resolve: (value: {
      state: 'found';
      snapshot: typeof scenario.snapshot;
    }) => void = () => undefined;
    mockScan = new ScanSession(
      {
        lookupBarcode: (_code, options) => {
          signal = options.signal;
          return new Promise((finish) => {
            resolve = finish;
          });
        },
      },
      methodNotInstalledAnalyser,
    );
    act(() => {
      screen = create(<LookupScreen />);
    });
    let pending: ReturnType<ScanSession['lookup']>;
    act(() => {
      pending = mockScan.lookup('3017624010701');
    });
    act(() => {
      screen?.unmount();
      screen = undefined;
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve({ state: 'found', snapshot: scenario.snapshot });
      await pending;
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockScan.getState().results).toEqual({});
  });
});
