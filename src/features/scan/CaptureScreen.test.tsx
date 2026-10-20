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
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { CameraView } from 'expo-camera';

import { Button } from '../../components/Button';
import { OperationStatus } from '../../components/OperationStatus';
import { CaptureViewfinder } from '../../components/CaptureViewfinder';
import { Sheet } from '../../components/Sheet';
import { TextField } from '../../components/TextField';
import { enGB } from '../../copy/en-GB';
import { getLocalScenario } from '../../fixtures/scenarios';
import { CaptureScreen } from './CaptureScreen';
import { DiscardLabelSheet } from './DiscardLabelSheet';

const mockRouter = {
  push: jest.fn(),
  dismissAll: jest.fn(),
  canDismiss: () => false,
};
const mockLabel = {
  buildSnapshot: jest.fn(),
  discard: jest.fn(),
  isDirty: () => true,
  getState: () => ({ reading: false }),
};
const mockScan = {
  lookup: jest.fn(),
  analyseSnapshot:
    jest.fn<
      (snapshot: unknown, signal: AbortSignal) => Promise<string | null>
    >(),
};
const mockWarmUp = jest.fn();
let mockFocusCleanup: (() => void) | undefined;
let mockHasLabel = true;
let mockAppStateChange: (state: AppStateStatus) => void;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => () => void) =>
    mockUseEffect(() => {
      mockFocusCleanup = effect();
      return mockFocusCleanup;
    }, [effect]),
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
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
    session: mockHasLabel
      ? {
          ingredients: { state: 'read', imageId: null },
          nutrition: { state: 'missing', imageId: null },
        }
      : null,
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
  CaptureViewfinder: ({ preview }: { preview: ReactNode }) => preview,
}));
jest.mock('../../components/OperationStatus', () => ({
  OperationStatus: () => null,
}));
jest.mock('../../components/Sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => children,
}));
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
    AppState.currentState = 'active';
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        mockAppStateChange = listener;
        return { remove: jest.fn() };
      });
    mockHasLabel = true;
    mockLabel.buildSnapshot.mockReturnValue(snapshot);
    mockScan.analyseSnapshot.mockResolvedValue('result-1');
    act(() => {
      screen = create(<CaptureScreen labelOnly={false} />);
    });
  });
  afterEach(() => {
    act(() => screen.unmount());
    jest.restoreAllMocks();
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

  it('asks before Start over deletes label work, and Keep reviewing preserves it', () => {
    const startOver = () =>
      screen.root
        .findAllByType(Button)
        .find((button) => button.props.label === enGB.scan.startOver)
        ?.props.onPress();
    act(startOver);
    expect(mockLabel.discard).not.toHaveBeenCalled();
    expect(screen.root.findByType(DiscardLabelSheet).props.visible).toBe(true);
    act(() => screen.root.findByType(DiscardLabelSheet).props.onKeep());
    expect(mockLabel.discard).not.toHaveBeenCalled();
    expect(screen.root.findByType(DiscardLabelSheet).props.visible).toBe(false);
    act(startOver);
    act(() => screen.root.findByType(DiscardLabelSheet).props.onDiscard());
    expect(mockLabel.discard).toHaveBeenCalledTimes(1);
  });

  function idleScanner() {
    mockHasLabel = false;
    act(() => screen.update(<CaptureScreen labelOnly={false} />));
    return screen.root.findByType(CameraView).props.onBarcodeScanned;
  }

  it('expands every UPC-E callback before lookup and locks repeated frames', () => {
    const onBarcode = idleScanner();
    act(() => {
      onBarcode({ type: 'upc_e', data: '04252614' });
      onBarcode({ type: 'upc_e', data: '04252614' });
    });
    expect(mockScan.lookup).toHaveBeenCalledTimes(1);
    expect(mockScan.lookup).toHaveBeenCalledWith('042100005264');
    expect(mockRouter.push).toHaveBeenCalledWith('/lookup');
  });

  it('keeps EAN-8 scanner values unchanged', () => {
    const onBarcode = idleScanner();
    act(() => onBarcode({ type: 'ean8', data: '96385074' }));
    expect(mockScan.lookup).toHaveBeenCalledWith('96385074');
  });

  it('pauses queued scanner events while manual entry is open, and closes it before navigation', () => {
    const onBarcode = idleScanner();
    act(() =>
      screen.root
        .findAllByType(Button)
        .find((button) => button.props.label === enGB.scan.typeBarcode)
        ?.props.onPress(),
    );
    act(() => onBarcode({ type: 'ean13', data: '3017624010701' }));
    expect(mockScan.lookup).not.toHaveBeenCalled();
    expect(
      screen.root.findByType(CaptureViewfinder).props.scanningBarcodes,
    ).toBe(false);
    act(() =>
      screen.root.findByType(TextField).props.onChange('3017624010701'),
    );
    const manual = () =>
      screen.root
        .findAllByType(Sheet)
        .find((sheet) => sheet.props.title === enGB.scan.manualTitle);
    expect(manual()?.props.visible).toBe(true);
    act(() => manual()?.props.primaryAction.onPress());
    expect(manual()?.props.visible).toBe(false);
    expect(mockScan.lookup).toHaveBeenCalledWith('3017624010701');
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('ignores queued scanner events after focus leaves', () => {
    const onBarcode = idleScanner();
    act(() => mockFocusCleanup?.());
    act(() => onBarcode({ type: 'ean13', data: '3017624010701' }));
    expect(mockScan.lookup).not.toHaveBeenCalled();
  });

  it('ignores queued scanner events when the app backgrounds', () => {
    const onBarcode = idleScanner();
    act(() => mockAppStateChange('background'));
    act(() => onBarcode({ type: 'ean13', data: '3017624010701' }));
    expect(mockScan.lookup).not.toHaveBeenCalled();
  });
});
