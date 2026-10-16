import { View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { FactKind } from '../view-models/types';
import { AppText } from './AppText';
import { Touchable } from './Touchable';

export type ProvenanceMarkProps =
  | {
      fact: Extract<FactKind, { kind: 'uncertain' }>;
      text: string;
      onCheck: () => void;
    }
  | {
      fact: Exclude<FactKind, { kind: 'uncertain' }>;
      text: string;
      onCheck?: never;
    };

/**
 * Component 08. Read, uncertain, corrected and estimated facts look different
 * in words. The dotted line and colour only support the words.
 */
export function ProvenanceMark(props: ProvenanceMarkProps) {
  const colors = useColors();
  const { fact, text } = props;

  if (fact.kind === 'read') {
    return <AppText variant="data">{text}</AppText>;
  }

  if (fact.kind === 'uncertain') {
    const onCheck = props.onCheck;
    return (
      <View style={{ gap: space.s1, alignItems: 'flex-start' }}>
        <AppText
          variant="data"
          style={{
            textDecorationLine: 'underline',
            textDecorationStyle: 'dotted',
            textDecorationColor: colors.ink2,
          }}
        >
          {text}
        </AppText>
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={`${enGB.provenance.check}: ${fact.cause}`}
          radius={radius.sm}
          onPress={onCheck}
          style={{ justifyContent: 'center', paddingVertical: space.s1 }}
        >
          <AppText variant="bodySm" color="primary">
            <AppText variant="label" color="primary">
              {enGB.provenance.check}
            </AppText>
            {` · ${fact.cause}`}
          </AppText>
        </Touchable>
      </View>
    );
  }

  if (fact.kind === 'corrected') {
    return (
      <View style={{ gap: space.s1 }}>
        <AppText variant="data">{text}</AppText>
        <AppText variant="bodySm" color="ink2">
          {enGB.provenance.corrected}
        </AppText>
      </View>
    );
  }

  return (
    <View style={{ gap: space.s1 }}>
      <AppText variant="data">{`≈ ${text}`}</AppText>
      <AppText variant="bodySm" color="ink2">
        {`${enGB.provenance.estimated} ${
          enGB.provenance.estimatedBy[fact.modelId] ??
          `· ${fact.modelId} ${fact.modelVersion}`
        }`}
      </AppText>
    </View>
  );
}
