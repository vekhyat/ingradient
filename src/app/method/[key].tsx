import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { formatSavedDate } from '../../components/HistoryList';
import { isOpenableSourceUrl } from '../../components/SourceDetail';
import { enGB } from '../../copy/en-GB';
import { ScreenFrame } from '../../features/app/ScreenFrame';
import { useResult } from '../../features/result/useResult';
import { space } from '../../theme/tokens';

/**
 * U12 Method. Which method produced this result (or why none did), what was
 * missing, where each fact came from, and that this is the app's own
 * assessment, not an official Indian grade.
 */
export default function MethodScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const result = useResult(key);
  const view = result?.view;
  const snapshot = result?.stored.snapshot;

  const gaps =
    view && view.science.status !== 'supported'
      ? view.science.status === 'unsupported'
        ? [view.science.detail]
        : view.science.gaps
      : [];

  return (
    <ScreenFrame title={enGB.method.title} onBack={() => router.back()}>
      <Card style={{ gap: space.s3 }}>
        <AppText variant="heading" heading>
          {enGB.assessment.methodLabel}
        </AppText>
        {view?.method ? (
          <AppText>{enGB.method.edition(view.method.edition)}</AppText>
        ) : (
          <AppText color="ink2">{enGB.method.noMethod}</AppText>
        )}
        <AppText color="ink2">{enGB.method.notOfficial}</AppText>
        {view?.analysedAt ? (
          <AppText variant="bodySm" color="ink3">
            {`${
              view.executor === 'backend'
                ? enGB.result.analysedOnServer
                : enGB.result.analysedOnPhone
            } · ${formatSavedDate(view.analysedAt)}`}
          </AppText>
        ) : null}
      </Card>

      {gaps.length > 0 ? (
        <Card style={{ gap: space.s2 }}>
          <AppText variant="heading" heading>
            {enGB.method.gaps}
          </AppText>
          {gaps.map((gap) => (
            <AppText key={gap} color="ink2">
              {gap}
            </AppText>
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: space.s3 }}>
        <AppText variant="heading" heading>
          {enGB.identity.inspectSource}
        </AppText>
        {(snapshot?.sourceRefs ?? [])
          .filter((ref) => ref.kind !== 'label' || !ref.locator)
          .map((ref) => (
            <View key={ref.id} style={{ gap: space.s1 }}>
              <AppText variant="subhead">{ref.title}</AppText>
              {ref.edition ? (
                <AppText variant="bodySm" color="ink2">
                  {enGB.method.edition(ref.edition)}
                </AppText>
              ) : null}
              {ref.kind === 'off' ? (
                <AppText variant="bodySm" color="ink3">
                  {enGB.identity.offCredit}
                </AppText>
              ) : null}
              {isOpenableSourceUrl(ref.url ?? null) ? (
                <Button
                  label={enGB.source.openOriginal}
                  variant="text"
                  icon="open_in_new"
                  onPress={() =>
                    void WebBrowser.openBrowserAsync(ref.url ?? '')
                  }
                />
              ) : null}
            </View>
          ))}
        {snapshot?.sourceRefs.some((ref) => ref.kind === 'label') ? (
          <AppText variant="bodySm" color="ink2">
            {enGB.identity.fromLabel}
          </AppText>
        ) : null}
      </Card>
    </ScreenFrame>
  );
}
