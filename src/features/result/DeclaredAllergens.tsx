import { View } from 'react-native';

import { AppText } from '../../components/AppText';
import { enGB } from '../../copy/en-GB';
import { space } from '../../theme/tokens';

export interface DeclaredAllergensProps {
  contains: string[];
  mayContain: string[];
}

/**
 * The allergens the pack itself declares, under "From the label". Neutral
 * styling: these are label facts, not a personal allergy warning (ADR 002).
 * Renders nothing when the pack declares none.
 */
export function DeclaredAllergens({
  contains,
  mayContain,
}: DeclaredAllergensProps) {
  const rows = [
    { label: enGB.facts.contains, items: contains },
    { label: enGB.facts.mayContain, items: mayContain },
  ].filter((row) => row.items.length > 0);
  if (rows.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: space.s2 }}>
      <AppText variant="label" color="ink3" heading>
        {enGB.facts.fromLabel}
      </AppText>
      {rows.map((row) => (
        <View
          key={row.label}
          accessible
          accessibilityLabel={`${row.label}: ${row.items.join(', ')}`}
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: space.s3,
          }}
        >
          <AppText variant="subhead" style={{ minWidth: 112 }}>
            {row.label}
          </AppText>
          <AppText color="ink2" style={{ flexShrink: 1 }}>
            {row.items.join(', ')}
          </AppText>
        </View>
      ))}
    </View>
  );
}
