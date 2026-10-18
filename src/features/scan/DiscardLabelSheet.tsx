import { AppText } from '../../components/AppText';
import { Sheet } from '../../components/Sheet';
import { enGB } from '../../copy/en-GB';

/**
 * "Discard this label?" Keep reviewing is the safe choice; Discard removes
 * the session photos and text. The parent decides where Discard leads.
 */
export function DiscardLabelSheet({
  visible,
  onKeep,
  onDiscard,
}: {
  visible: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title={enGB.capture.discardTitle}
      dirty={false}
      onClose={onKeep}
      secondaryAction={{
        label: enGB.sheet.keepReviewing,
        variant: 'tonal',
        onPress: onKeep,
      }}
      primaryAction={{
        label: enGB.sheet.discard,
        variant: 'outline',
        onPress: onDiscard,
      }}
    >
      <AppText>{enGB.capture.discardBody}</AppText>
    </Sheet>
  );
}
