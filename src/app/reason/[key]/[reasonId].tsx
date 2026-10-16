import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';

import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { EvidenceReason } from '../../../components/EvidenceReason';
import { Sheet } from '../../../components/Sheet';
import {
  SourceDetail,
  isOpenableSourceUrl,
} from '../../../components/SourceDetail';
import { enGB } from '../../../copy/en-GB';
import { ScreenFrame } from '../../../features/app/ScreenFrame';
import { useResult } from '../../../features/result/useResult';
import { space } from '../../../theme/tokens';

/**
 * U11 Reason and source. The reason, the inputs it used, and each cited
 * document's details (readable offline). The original opens in the browser
 * only after a tap, within two taps of the result.
 */
export default function ReasonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    key: string;
    reasonId: string;
    citationId?: string;
  }>();
  const result = useResult(params.key);
  const reason = result?.view.reasons.find(
    (item) => item.id === params.reasonId,
  );
  const [openCitation, setOpenCitation] = useState<string | null>(
    params.citationId ?? null,
  );
  const [openError, setOpenError] = useState(false);
  const citation = openCitation
    ? result?.view.citations[openCitation]
    : undefined;

  const titles: Record<string, string> = {};
  for (const item of Object.values(result?.view.citations ?? {})) {
    titles[item.id] = item.title;
  }

  return (
    <ScreenFrame title={enGB.reasons.title} onBack={() => router.back()}>
      {reason ? (
        <Card style={{ gap: space.s2 }}>
          <EvidenceReason
            id={reason.id}
            text={reason.text}
            citationIds={reason.citationIds}
            citationTitles={titles}
            inputText={reason.inputText}
            state="supported"
            onOpenSource={(id) => setOpenCitation(id)}
          />
        </Card>
      ) : (
        <AppText color="ink2">{enGB.reasons.unavailable}</AppText>
      )}
      {openError ? <AppText color="ink2">{enGB.source.offline}</AppText> : null}

      <Sheet
        visible={openCitation !== null}
        title={citation?.title ?? enGB.reasons.title}
        dirty={false}
        onClose={() => setOpenCitation(null)}
      >
        <SourceDetail
          title={citation?.title ?? ''}
          issuer={citation?.issuer ?? ''}
          edition={citation?.edition ?? ''}
          locator={citation?.locator ?? ''}
          claim={citation?.claim ?? ''}
          limitation=""
          url={citation?.url ?? null}
          state={citation ? 'metadata_only' : 'error'}
          onOpenExternal={() => {
            const url = citation?.url ?? null;
            if (!isOpenableSourceUrl(url)) {
              return;
            }
            WebBrowser.openBrowserAsync(url).catch(() => setOpenError(true));
          }}
          onClose={() => setOpenCitation(null)}
        />
      </Sheet>
    </ScreenFrame>
  );
}
