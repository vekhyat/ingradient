import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { useEffect as mockUseEffect, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Button } from '../../components/Button';
import { OperationStatus } from '../../components/OperationStatus';
import { enGB } from '../../copy/en-GB';
import { getLocalScenario } from '../../fixtures/scenarios';
import { CaptureScreen } from './CaptureScreen';

const mockRouter = {
  push: jest.fn(),
  dismissAll: jest.fn(),
  canDismiss: () => false,
};
const mockLabel = {
  buildSnapshot: jest.fn(),
  discard: jest.fn(),
  getState: () => ({ reading: false }),
};
const mockScan = {
  analyseSnapshot:
    jest.fn<
      (snapshot: unknown, signal: AbortSignal) => Promise<string | null>
    >(),
};
const mockWarmUp = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void) => mockUseEffect(effect, [effect]),
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [null, jest.fn()],
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('../../theme/ThemeProvider', () => ({
  useColors: () => ({ bg: '#fff', camera: '#000' }),
}));
jest.mock('../app/services', () => ({
  useServices: () => ({
    scan: mockScan,
    label: mockLabel,
    warmUpBackend: mockWarmUp,
  }),
  useLabelState: () => ({
    session: {
      ingredients: { state: 'read', imageId: null },
      nutrition: { state: 'missing', imageId: null },
    },
    reading: false,
    lastOutcome: null,
  }),
}));
jest.mock('../../components/Button', () => ({ Button: () => null }));
jest.mock('../../components/AppText', () => ({ AppText: () => null }));
jest.mock('../../components/Card', () => ({
  Card: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../../components/CaptureViewfinder', () => ({
  CaptureViewfinder: () => null,
}));
jest.mock('../../components/OperationStatus', () => ({
  OperationStatus: () => null,
}));
jest.mock('../../components/Sheet', () => ({ Sheet: () => null }));
jest.mock('../../components/TextField', () => ({ TextField: () => null }));

describe('capture to result', () => {
  let screen: ReactTestRenderer;
  const snapshot = getLocalScenario('complete_graded').snapshot;
  const pressResults = () =>
    screen.root
      .findAllByType(Button)
      .find((b) => b.props.label === enGB.capture.seeResults)
      ?.props.onPress();
  beforeEach(() => {
    jest.clearAllMocks();
    mockLabel.buildSnapshot.mockReturnValue(snapshot);
    mockScan.analyseSnapshot.mockResolvedValue('result-1');
    act(() => {
      screen = create(<CaptureScreen labelOnly={false} />);
    });
  });
  afterEach(() => {
    act(() => screen.unmount());
  });

  it('opens the result with one action, without a mandatory review route', async () => {
    await act(async () => {
      pressResults();
    });
    expect(mockScan.analyseSnapshot).toHaveBeenCalledWith(
      snapshot,
      expect.any(AbortSignal),
    );
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/result/[key]',
      params: { key: 'result-1' },
    });
    expect(mockLabel.discard).toHaveBeenCalledTimes(1);
    expect(mockScan.analyseSnapshot.mock.calls[0]?.[1].aborted).toBe(false);
  });

  it('deduplicates taps and ignores a completion after cancellation', async () => {
    let finish: (key: string) => void = () => undefined;
    mockScan.analyseSnapshot.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    act(() => {
      pressResults();
      pressResults();
    });
    expect(mockScan.analyseSnapshot).toHaveBeenCalledTimes(1);
    act(() => screen.root.findByType(OperationStatus).props.onCancel());
    await act(async () => {
      finish('stale-result');
    });
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockLabel.discard).not.toHaveBeenCalled();
    expect(mockScan.analyseSnapshot.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it('retains label facts when analysis fails and lets the user retry', async () => {
    mockScan.analyseSnapshot.mockResolvedValueOnce(null);
    await act(async () => {
      pressResults();
    });
    expect(screen.root.findByType(OperationStatus).props.state).toBe('failed');
    expect(mockLabel.discard).not.toHaveBeenCalled();
    await act(async () => {
      screen.root.findByType(OperationStatus).props.onRetry();
    });
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/result/[key]',
      params: { key: 'result-1' },
    });
  });

  it('keeps corrections available as an optional action', () => {
    act(() =>
      screen.root
        .findAllByType(Button)
        .find((b) => b.props.label === enGB.review.title)
        ?.props.onPress(),
    );
    expect(mockRouter.push).toHaveBeenCalledWith('/review');
    expect(mockScan.analyseSnapshot).not.toHaveBeenCalled();
  });
});
