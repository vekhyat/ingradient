import { View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { space } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

export interface SourceDetailProps {
  title: string;
  issuer: string;
  edition: string;
  locator: string;
  claim: string;
  limitation: string;
  url: string | null;
  state: 'available' | 'metadata_only' | 'retired' | 'error';
  onOpenExternal: () => void;
  onClose: () => void;
}

/** Only http(s) links open; anything else is refused. */
export function isOpenableSourceUrl(url: string | null): url is string {
  if (url === null) {
    return false;
  }
  return /^https?:\/\/[^\s]+$/i.test(url);
}

function Row({ label, value }: { label: string; value: string }) {
  if (value.trim().length === 0) {
    return null;
  }
  return (
    <View style={{ gap: 2 }}>
      <AppText variant="label" color="ink2">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}

/**
 * Component 14. Which document supports which claim, and its limits. The
 * details stay readable offline; opening the original is an explicit tap
 * that leaves the app for the browser.
 */
export function SourceDetail({
  title,
  issuer,
  edition,
  locator,
  claim,
  limitation,
  url,
  state,
  onOpenExternal,
}: SourceDetailProps) {
  if (state === 'error') {
    return <AppText color="ink2">{enGB.source.error}</AppText>;
  }
  const openable = isOpenableSourceUrl(url);
  return (
    <View style={{ gap: space.s4 }}>
      <AppText variant="heading">{title}</AppText>
      <Row label={enGB.source.issuer} value={issuer} />
      <Row label={enGB.source.edition} value={edition} />
      <Row label={enGB.source.locator} value={locator} />
      <Row label={enGB.source.claim} value={claim} />
      <Row label={enGB.source.limitation} value={limitation} />
      {state === 'retired' ? (
        <AppText color="ink2">{enGB.source.retired}</AppText>
      ) : null}
      {state === 'metadata_only' ? (
        <AppText color="ink2">{enGB.source.metadataOnly}</AppText>
      ) : null}
      {url !== null && !openable ? (
        <AppText color="ink2">{enGB.source.badLink}</AppText>
      ) : null}
      {openable ? (
        <Button
          label={enGB.source.openOriginal}
          variant="outline"
          icon="open_in_new"
          onPress={onOpenExternal}
        />
      ) : null}
    </View>
  );
}
