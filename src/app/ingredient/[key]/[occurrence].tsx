import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { matchLine } from '../../../components/IngredientList';
import { enGB } from '../../../copy/en-GB';
import { ScreenFrame } from '../../../features/app/ScreenFrame';
import { useResult } from '../../../features/result/useResult';
import { space } from '../../../theme/tokens';

function Row({ label, value }: { label: string; value: string }) {
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
 * U10 Ingredient detail. What was printed, whether it matched a known
 * ingredient, and where the text came from. No function, health or
 * exposure claim is made without a source.
 */
export default function IngredientDetailScreen() {
  const router = useRouter();
  const { key, occurrence } = useLocalSearchParams<{
    key: string;
    occurrence: string;
  }>();
  const result = useResult(key);
  const item = result?.view.ingredients.find(
    (row) => row.occurrenceId === occurrence,
  );
  const parent = item?.nestedIn
    ? result?.view.ingredients.find((row) => row.occurrenceId === item.nestedIn)
    : undefined;
  const source = result?.stored.snapshot.ingredients
    .find((mention) => mention.id === occurrence)
    ?.sourceIds.map(
      (id) =>
        result.stored.snapshot.sourceRefs.find((ref) => ref.id === id)?.title ??
        id,
    )
    .join(', ');

  return (
    <ScreenFrame
      title={item?.printedText ?? enGB.ingredients.title}
      onBack={() => router.back()}
    >
      {item ? (
        <Card style={{ gap: space.s4 }}>
          <Row label={enGB.review.ingredientLabel} value={item.printedText} />
          <Row label={enGB.ingredients.matched} value={matchLine(item)} />
          {parent ? (
            <Row
              label={enGB.ingredients.title}
              value={enGB.ingredients.within(parent.printedText)}
            />
          ) : null}
          <Row
            label={enGB.identity.inspectSource}
            value={source ?? enGB.common.unavailable}
          />
          {item.kind.kind === 'corrected' ? (
            <AppText color="ink2">{enGB.provenance.corrected}</AppText>
          ) : null}
        </Card>
      ) : (
        <AppText color="ink2">{enGB.source.error}</AppText>
      )}
    </ScreenFrame>
  );
}
