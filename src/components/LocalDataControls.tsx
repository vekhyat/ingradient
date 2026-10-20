import { View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { space } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Divider } from './Card';

export interface LocalDataControlsProps {
  slice: 'S1' | 'S2' | 'S3' | 'S4';
  savedCount: number | null;
  /** A count may be unknown while recovery is still available. */
  eraseDisabledReason?: string;
  operation: 'idle' | 'erasing' | 'failed' | 'erased';
  onErase: () => void;
  onOpenPrivacy: () => void;
  onOpenMethod: () => void;
}

/**
 * Component 19. What stays on the phone, what leaves it, and an erase
 * control for data that actually exists. S1 shows no profile editor and no
 * learning switch; it says those arrive later instead of showing them
 * disabled.
 */
export function LocalDataControls({
  slice,
  savedCount,
  eraseDisabledReason,
  operation,
  onErase,
  onOpenPrivacy,
  onOpenMethod,
}: LocalDataControlsProps) {
  return (
    <View style={{ gap: space.s5 }}>
      <View style={{ gap: space.s2 }}>
        <AppText variant="heading" heading>
          {enGB.you.localTitle}
        </AppText>
        <AppText color="ink2">{enGB.you.localBody}</AppText>
        {savedCount !== null ? (
          <AppText variant="data">{enGB.you.savedCount(savedCount)}</AppText>
        ) : null}
        {operation === 'failed' ? (
          <AppText color="alertInk" accessibilityRole="alert">
            {enGB.you.eraseFailed}
          </AppText>
        ) : null}
        {operation === 'erased' ? (
          <AppText accessibilityLiveRegion="polite">{enGB.you.erased}</AppText>
        ) : null}
        <Button
          label={operation === 'erasing' ? enGB.you.erasing : enGB.you.erase}
          variant="outline"
          icon="delete"
          busy={operation === 'erasing'}
          disabledReason={
            eraseDisabledReason ??
            (savedCount === 0 && operation !== 'failed'
              ? enGB.history.empty
              : undefined)
          }
          onPress={onErase}
        />
      </View>

      <Divider />

      <View style={{ gap: space.s2 }}>
        <AppText variant="heading" heading>
          {enGB.you.requestsTitle}
        </AppText>
        <AppText color="ink2">{enGB.you.requestsBody}</AppText>
        <Button
          label={enGB.you.privacy}
          variant="text"
          onPress={onOpenPrivacy}
        />
        <Button label={enGB.you.method} variant="text" onPress={onOpenMethod} />
      </View>

      {slice === 'S1' || slice === 'S2' ? (
        <AppText variant="bodySm" color="ink3">
          {enGB.you.profileLater}
        </AppText>
      ) : null}
    </View>
  );
}
