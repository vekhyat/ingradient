import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { AppText } from '../components/AppText';
import { OperationStatus } from '../components/OperationStatus';
import { enGB } from '../copy/en-GB';
import { ScreenFrame } from '../features/app/ScreenFrame';
import { useScanState, useServices } from '../features/app/services';
import type { LookupFailure } from '../view-models/types';

function failureMessage(failure: LookupFailure): string {
  const copy = enGB.status.lookup;
  switch (failure.status) {
    case 'throttled':
      return copy.throttled(failure.retryAfterSeconds);
    default:
      return copy[failure.status];
  }
}

/**
 * U03 Lookup. Shows the real stage. A grade or a named gap that no photo
 * can fix opens Result by itself (U-AUTO-A); a fillable gap stays here and
 * offers a label photo. Leaving cancels the lookup.
 */
export default function LookupScreen() {
  const router = useRouter();
  const { scan, label } = useServices();
  const { lookup } = useScanState();

  useEffect(() => {
    if (lookup.status === 'opened') {
      scan.acknowledgeLookup(lookup.operationId);
      router.replace({
        pathname: '/result/[key]',
        params: { key: lookup.resultKey },
      });
    }
  }, [lookup, router, scan]);

  useEffect(() => () => scan.cancelLookup(), [scan]);

  const back = () => {
    scan.cancelLookup();
    router.back();
  };

  const photograph = (base: Parameters<typeof label.start>[0]) => {
    label.start(base);
    router.replace('/capture');
  };

  return (
    <ScreenFrame title={enGB.scan.findProduct} onBack={back}>
      {lookup.status === 'pending' || lookup.status === 'opened' ? (
        <OperationStatus
          stage={lookup.status === 'pending' ? lookup.stage : 'analysis'}
          analysisPath="phone_local_only"
          state="pending"
          message={enGB.status.lookup.pending}
          onCancel={back}
        />
      ) : null}
      {lookup.status === 'failed' ? (
        <OperationStatus
          stage="lookup"
          state="failed"
          message={failureMessage(lookup.failure)}
          retryAfterSeconds={
            lookup.failure.status === 'throttled'
              ? (lookup.failure.retryAfterSeconds ?? undefined)
              : undefined
          }
          onRetry={
            lookup.failure.status === 'invalid_code'
              ? undefined
              : () => void scan.lookup(lookup.barcode)
          }
          onCaptureLabel={() => photograph(null)}
        />
      ) : null}
      {lookup.status === 'incomplete' ? (
        <>
          <OperationStatus
            stage="lookup"
            state="empty"
            message={enGB.status.lookup.incomplete}
            onCaptureLabel={() => photograph(lookup.base)}
          />
          {lookup.gaps.map((gap) => (
            <AppText key={gap} color="ink2">
              {gap}
            </AppText>
          ))}
        </>
      ) : null}
      {lookup.status === 'idle' ? (
        <OperationStatus
          stage="lookup"
          state="cancelled"
          message={enGB.status.lookup.cancelled}
        />
      ) : null}
      {lookup.status !== 'idle' ? (
        <AppText variant="bodySm" color="ink3">
          {enGB.identity.barcode(lookup.barcode)}
        </AppText>
      ) : null}
    </ScreenFrame>
  );
}
