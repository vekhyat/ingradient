import { View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Card, Divider } from '../../components/Card';
import { ProvenanceMark } from '../../components/ProvenanceMark';
import { enGB } from '../../copy/en-GB';
import { space } from '../../theme/tokens';
import type { AmountView } from '../../view-models/types';

/**
 * Display rounding only; stored values keep full precision.
 * kJ → whole numbers; grams → 1 decimal at 10 g and above, else up to 2.
 */
export function displayNumber(value: number, unit: string): string {
  if (unit === 'kJ') {
    return String(Math.round(value));
  }
  const decimals = Math.abs(value) >= 10 ? 1 : 2;
  return String(Number(value.toFixed(decimals)));
}

/** FAO Food and Nutrition Paper 77: 1 kcal = 4.184 kJ (display only). */
function kcalFromKj(kj: number): number {
  return Math.round(kj / 4.184);
}

export function amountText(row: AmountView, withBasis: boolean): string {
  if (row.value === null) {
    return row.missingReason ?? enGB.nutrition.unknown;
  }
  let text = `${displayNumber(row.value, row.unit)} ${row.unit}`;
  if (row.unit === 'kJ') {
    text += ` (${enGB.nutrition.kcal(kcalFromKj(row.value))})`;
  }
  return withBasis ? `${text} ${row.basis}`.trim() : text;
}

/**
 * The evidence-input nutrition table for S1 (SCREENS.md §3): every value
 * with its unit and origin; the basis is in the header when all rows share
 * it. Unknown stays "Unknown", never 0.
 */
export function NutritionTable({
  rows,
  onCheck,
}: {
  rows: readonly AmountView[];
  onCheck: (field: string) => void;
}) {
  const known = rows.filter((row) => row.value !== null);
  const bases = new Set(known.map((row) => row.basis));
  const sharedBasis = bases.size === 1 ? [...bases][0] : null;
  const shown = rows.filter(
    (row) => row.value !== null || row.missingReason !== 'Not available',
  );

  return (
    <Card style={{ gap: space.s1 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: space.s2,
        }}
      >
        <AppText variant="heading" heading>
          {enGB.nutrition.title}
        </AppText>
        {sharedBasis ? (
          <AppText variant="bodySm" color="ink2">
            {sharedBasis}
          </AppText>
        ) : null}
      </View>
      {known.length === 0 ? (
        <AppText color="ink2">{enGB.nutrition.none}</AppText>
      ) : (
        shown.map((row, index) => {
          const text = amountText(row, sharedBasis === null);
          return (
            <View key={row.field}>
              {index > 0 ? <Divider /> : null}
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: space.s2,
                  paddingVertical: space.s2,
                }}
              >
                <AppText style={{ flexShrink: 1 }}>{row.label}</AppText>
                <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                  {row.kind === null ? (
                    <AppText variant="data" color="ink2">
                      {text}
                    </AppText>
                  ) : row.kind.kind === 'uncertain' ? (
                    <ProvenanceMark
                      fact={row.kind}
                      text={text}
                      onCheck={() => onCheck(row.field)}
                    />
                  ) : (
                    <ProvenanceMark fact={row.kind} text={text} />
                  )}
                </View>
              </View>
            </View>
          );
        })
      )}
    </Card>
  );
}
