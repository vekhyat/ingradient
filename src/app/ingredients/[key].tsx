import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { IngredientList } from '../../components/IngredientList';
import { enGB } from '../../copy/en-GB';
import { ScreenFrame } from '../../features/app/ScreenFrame';
import { useResult } from '../../features/result/useResult';
import { space } from '../../theme/tokens';

/** U09 All ingredients, in pack order, including nested and unresolved terms. */
export default function AllIngredientsScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const result = useResult(key);
  const items = result?.view.ingredients ?? [];

  return (
    <ScreenFrame
      title={result?.view.product.name ?? enGB.ingredients.title}
      onBack={() => router.back()}
    >
      <AppText variant="heading" heading>
        {enGB.ingredients.title}
      </AppText>
      {items.length > 0 ? (
        <AppText color="ink2">
          {enGB.ingredients.countInOrder(items.length)}
        </AppText>
      ) : null}
      <Card style={{ gap: space.s2 }}>
        <IngredientList
          items={items}
          state={items.length > 0 ? 'ready' : 'missing'}
          onOpen={(occurrence) =>
            router.push({
              pathname: '/ingredient/[key]/[occurrence]',
              params: { key: key ?? '', occurrence },
            })
          }
          onRetry={() => undefined}
        />
      </Card>
    </ScreenFrame>
  );
}
