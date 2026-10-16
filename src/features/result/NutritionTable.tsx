import { View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Card, Divider } from '../../components/Card';
import { formatAmount } from '../../components/PanelReview';
import { ProvenanceMark } from '../../components/ProvenanceMark';
import { enGB } from '../../copy/en-GB';
import { space } from '../../theme/tokens';
import type { AmountView } from '../../view-models/types';

/**
 * The evidence-input nutrition table for S1 (SCREENS.md §3): every value
 * with its unit, basis and origin. Unknown stays "Unknown", never 0.
 */
export function NutritionTable({
  rows,
  onCheck,
}: {
  rows: readonly AmountView[];
  onCheck: (field: string) => void;
}) {
  const known = rows.filter((row) => row.value !== null);
  return (
    <Card style={{ gap: space.s2 }}>
      <AppText variant="heading" heading>
        {enGB.nutrition.title}
      </AppText>
      {known.length === 0 ? (
        <AppText color="ink2">{enGB.nutrition.none}</AppText>
      ) : (
        rows.map((row, index) => (
          <View key={row.field}>
            {index > 0 ? <Divider /> : null}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: space.s2,
                paddingVertical: space.s3,
              }}
            >
              <AppText style={{ flexShrink: 1 }}>{row.label}</AppText>
              <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                {row.kind === null ? (
                  <AppText variant="data" color="ink2">
                    {row.missingReason ?? enGB.nutrition.unknown}
                  </AppText>
                ) : row.kind.kind === 'uncertain' ? (
                  <ProvenanceMark
                    fact={row.kind}
                    text={formatAmount(row)}
                    onCheck={() => onCheck(row.field)}
                  />
                ) : (
                  <ProvenanceMark fact={row.kind} text={formatAmount(row)} />
                )}
              </View>
            </View>
          </View>
        ))
      )}
    </Card>
  );
}
