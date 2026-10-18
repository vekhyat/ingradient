import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import {
  createHybridAnalyser,
  type HybridAnalyser,
} from '../../adapters/backend/hybrid-analyser';
import { createCatalogueAdapter } from '../../adapters/catalogue';
import { recogniseLabel } from '../../adapters/native/text-recognition';
import { StorageError } from '../../adapters/storage/records';
import {
  adoptSessionPhoto,
  clearSessionPhotos,
  deleteSessionPhoto,
} from '../../adapters/storage/session-photos';
import {
  createSnapshotStore,
  type SnapshotStore,
} from '../../adapters/storage/snapshot-store';
import {
  destroyEncryptedDatabase,
  openEncryptedDatabase,
  sqlRecordTable,
} from '../../adapters/storage/sqlcipher-table';
import { installedResources } from '../../domain/hybrid/resources';
import { LabelFlow } from '../capture/label-flow';
import {
  methodNotInstalledAnalyser,
  type AnalyserContext,
  type ProductAnalyser,
} from '../scan/analyser';
import { ScanSession, newOperationId } from '../scan/scan-session';

/** Open Food Facts asks every app to identify itself and give a contact. */
const USER_AGENT = `Ingradient - ${Platform.OS === 'ios' ? 'iOS' : 'Android'} - Version 0.1.0 - https://github.com/vekhyat/ingradient`;

/** ONB-01: the notice version the user must accept before analysis. */
export const NOTICE_VERSION = '1-draft';
const NOTICE_KEY = 'ingradient.notice.accepted';

/**
 * The analysis server. Unset means phone-only: no backend is deployed yet
 * (BE-14 waits on the owner's accounts). For a local FastAPI run on the
 * Android emulator, EXPO_PUBLIC_ANALYSIS_URL=http://10.0.2.2:8000.
 */
const ANALYSIS_URL = process.env.EXPO_PUBLIC_ANALYSIS_URL ?? '';

/**
 * The analyser the app runs: the backend first with the phone as fallback
 * (D66), or the phone alone. SCI-01 replaces the phone stand-in here. The
 * context carries the accepted notice version, so nothing is sent before
 * onboarding (APP-01 case 7, HYB-01 case 6).
 */
function createAnalysis(context: AnalyserContext): {
  analyser: ProductAnalyser;
  hybrid: HybridAnalyser | null;
} {
  const local = methodNotInstalledAnalyser;
  if (ANALYSIS_URL.length === 0) {
    return { analyser: local, hybrid: null };
  }
  const hybrid = createHybridAnalyser({
    baseUrl: ANALYSIS_URL,
    fetch: (input, init) => fetch(input, init),
    local,
    context,
    resources: installedResources(),
  });
  return { analyser: hybrid, hybrid };
}

/** The accepted notice version, read by analysers at call time. */
class AcceptedNotice {
  private version: string | null = null;
  get = (): string | null => this.version;
  set(version: string | null): void {
    this.version = version;
  }
}

export type StoreStatus =
  | { status: 'opening' }
  | { status: 'ready'; store: SnapshotStore }
  | { status: 'error'; code: StorageError['code']; message: string };

interface Services {
  scan: ScanSession;
  label: LabelFlow;
  store: StoreStatus;
  reopenStore: () => void;
  resetStore: () => Promise<void>;
  /** Bumped after every save/delete so lists refresh. */
  storeRevision: number;
  bumpStore: () => void;
  noticeAccepted: boolean | null;
  acceptNotice: () => Promise<void>;
  /** HYB-01: wake the backend on Scan entry (rate-limited by the client). */
  warmUpBackend: () => void;
}

const ServicesContext = createContext<Services | null>(null);

export function AppServicesProvider({ children }: { children: ReactNode }) {
  // Read at analysis time, so acceptance applies without rebuilding services.
  const [acceptedNotice] = useState(() => new AcceptedNotice());
  const [analysis] = useState(() =>
    createAnalysis({ acceptedNoticeVersion: acceptedNotice.get }),
  );
  const [scan] = useState(
    () =>
      new ScanSession(
        createCatalogueAdapter({ userAgent: USER_AGENT }),
        analysis.analyser,
      ),
  );
  const [label] = useState(
    () =>
      new LabelFlow({
        recognise: recogniseLabel,
        adoptPhoto: adoptSessionPhoto,
        deletePhoto: deleteSessionPhoto,
        newId: () => newOperationId('label'),
      }),
  );

  const [store, setStore] = useState<StoreStatus>({ status: 'opening' });
  const [storeRevision, setStoreRevision] = useState(0);
  const [noticeAccepted, setNoticeAccepted] = useState<boolean | null>(null);

  const loadStore = useCallback(() => {
    openEncryptedDatabase()
      .then((db) =>
        setStore({
          status: 'ready',
          store: createSnapshotStore(sqlRecordTable(db)),
        }),
      )
      .catch((error: unknown) => {
        const code = error instanceof StorageError ? error.code : 'unavailable';
        if (__DEV__) {
          // Storage errors carry no product or personal data.
          console.warn(
            `Saved-results store failed: ${code}: ${(error as Error).message}`,
          );
        }
        setStore({
          status: 'error',
          code,
          message: (error as Error).message,
        });
      });
  }, []);

  const openStore = useCallback(() => {
    setStore({ status: 'opening' });
    loadStore();
  }, [loadStore]);

  useEffect(() => {
    // Session photos never survive an app restart (STO-01 case 3).
    clearSessionPhotos();
    loadStore();
    SecureStore.getItemAsync(NOTICE_KEY)
      .then((value) => {
        const accepted = value === NOTICE_VERSION;
        acceptedNotice.set(accepted ? NOTICE_VERSION : null);
        setNoticeAccepted(accepted);
      })
      .catch(() => setNoticeAccepted(false));
  }, [loadStore, acceptedNotice]);

  useEffect(() => {
    // D70 / HYB-01 case 5: no update offer survives leaving the app.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        analysis.hybrid?.cancelAll();
        scan.dropPendingUpdates();
      }
    });
    return () => subscription.remove();
  }, [scan, analysis]);

  const value = useMemo<Services>(
    () => ({
      scan,
      label,
      store,
      reopenStore: openStore,
      resetStore: async () => {
        await destroyEncryptedDatabase();
        openStore();
      },
      storeRevision,
      bumpStore: () => setStoreRevision((n) => n + 1),
      noticeAccepted,
      acceptNotice: async () => {
        await SecureStore.setItemAsync(NOTICE_KEY, NOTICE_VERSION);
        const stored = await SecureStore.getItemAsync(NOTICE_KEY);
        if (stored !== NOTICE_VERSION) {
          throw new Error('Notice acceptance was not stored.');
        }
        acceptedNotice.set(NOTICE_VERSION);
        setNoticeAccepted(true);
      },
      warmUpBackend: () => analysis.hybrid?.warmUp(),
    }),
    [
      scan,
      label,
      store,
      openStore,
      storeRevision,
      noticeAccepted,
      acceptedNotice,
      analysis,
    ],
  );

  return (
    <ServicesContext.Provider value={value}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('useServices must be used inside AppServicesProvider');
  }
  return services;
}

export function useScanState() {
  const { scan } = useServices();
  return useSyncExternalStore(scan.subscribe, scan.getState);
}

export function useLabelState() {
  const { label } = useServices();
  return useSyncExternalStore(label.subscribe, label.getState);
}
