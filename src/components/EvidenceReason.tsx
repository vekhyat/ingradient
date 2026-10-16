import { View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface EvidenceReasonProps {
  id: string;
  text: string;
  citationIds: readonly string[];
  /** Title per citation, for the source buttons. */
  citationTitles: Readonly<Record<string, string>>;
  inputText: string;
  state: 'supported' | 'unavailable';
  onOpenSource: (citationId: string) => void;
}

/**
 * Component 13. One scientific reason, the inputs it used, and a source
 * button one tap away. A reason without its citation is shown as
 * unavailable, never with a generic homepage.
 */
export function EvidenceReason({
  text,
  citationIds,
  citationTitles,
  inputText,
  state,
  onOpenSource,
}: EvidenceReasonProps) {
  const colors = useColors();
  if (state === 'unavailable' || citationIds.length === 0) {
    return <AppText color="ink2">{enGB.reasons.unavailable}</AppText>;
  }
  return (
    <View style={{ gap: space.s2, paddingVertical: space.s2 }}>
      <View style={{ flexDirection: 'row', gap: space.s3 }}>
        <Icon name="info" color={colors.ink2} />
        <View style={{ flex: 1, gap: space.s1 }}>
          <AppText variant="subhead">{text}</AppText>
          {inputText ? (
            <AppText variant="bodySm" color="ink2">
              {enGB.reasons.inputs(inputText)}
            </AppText>
          ) : null}
        </View>
      </View>
      {citationIds.map((citationId) => {
        const title = citationTitles[citationId] ?? citationId;
        return (
          <Touchable
            key={citationId}
            accessibilityRole="button"
            accessibilityLabel={enGB.reasons.openSource(title)}
            radius={radius.sm}
            onPress={() => onOpenSource(citationId)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s2,
              paddingLeft: space.s6 + space.s1,
            }}
          >
            <AppText variant="bodySm" color="primary" style={{ flex: 1 }}>
              {enGB.reasons.openSource(title)}
            </AppText>
            <Icon name="chevron_right" color={colors.primary} />
          </Touchable>
        );
      })}
    </View>
  );
}
