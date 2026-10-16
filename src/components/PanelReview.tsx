import { View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type {
  AmountView,
  IngredientOccurrence,
  PanelPresence,
} from '../view-models/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card, Divider } from './Card';
import { Icon } from './Icon';
import { ProvenanceMark } from './ProvenanceMark';
import { Touchable } from './Touchable';

export interface PanelReviewProps {
  ingredients: readonly IngredientOccurrence[];
  nutrients: readonly AmountView[];
  panels: readonly PanelPresence[];
  pending: boolean;
  onEditIngredient: (occurrenceId: string) => void;
  onEditNutrient: (field: string) => void;
  onRetake: (panel: 'ingredients' | 'nutrition') => void;
  onAnalyseAvailable: () => void;
  onDiscard: () => void;
}

export function formatAmount(row: AmountView): string {
  if (row.value === null) {
    return row.missingReason ?? enGB.nutrition.unknown;
  }
  const value = Number.isInteger(row.value)
    ? String(row.value)
    : String(Number(row.value.toFixed(3)));
  return `${value} ${row.unit} ${row.basis}`.trim();
}

function EditRow({
  title,
  detail,
  onEdit,
  children,
}: {
  title: string;
  detail?: string;
  onEdit: () => void;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: space.s3,
        gap: space.s2,
      }}
    >
      <View style={{ flex: 1, gap: space.s1 }}>
        <AppText variant="subhead">{title}</AppText>
        {detail ? (
          <AppText variant="bodySm" color="ink2">
            {detail}
          </AppText>
        ) : null}
        {children}
      </View>
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={enGB.review.edit(title)}
        radius={radius.full}
        onPress={onEdit}
        style={{
          width: 48,
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="edit" color={colors.primary} />
      </Touchable>
    </View>
  );
}

/**
 * Component 16. Every extracted row with its unit, basis and provenance, not
 * only the unsure ones. Missing values stay missing. "Analyse available
 * information" can run with gaps; the result then names them.
 */
export function PanelReview({
  ingredients,
  nutrients,
  panels,
  pending,
  onEditIngredient,
  onEditNutrient,
  onRetake,
  onAnalyseAvailable,
  onDiscard,
}: PanelReviewProps) {
  const panelState = (panel: 'ingredients' | 'nutrition') =>
    panels.find((item) => item.panel === panel)?.state ?? 'missing';

  return (
    <View style={{ gap: space.s4 }}>
      <AppText color="ink2">{enGB.review.intro}</AppText>

      <Card style={{ gap: space.s2 }}>
        <AppText variant="heading" heading>
          {enGB.ingredients.title}
        </AppText>
        <AppText variant="bodySm" color="ink2">
          {enGB.capture.panelState[panelState('ingredients')]}
        </AppText>
        {ingredients.length === 0 ? (
          <AppText color="ink2">{enGB.review.noIngredients}</AppText>
        ) : (
          ingredients.map((item, index) => (
            <View key={item.occurrenceId}>
              {index > 0 ? <Divider /> : null}
              <View style={{ paddingLeft: item.depth * space.s4 }}>
                <EditRow
                  title={item.printedText}
                  detail={
                    item.kind.kind === 'corrected'
                      ? enGB.provenance.corrected
                      : undefined
                  }
                  onEdit={() => onEditIngredient(item.occurrenceId)}
                />
              </View>
            </View>
          ))
        )}
        <Button
          label={enGB.capture.retake(enGB.capture.panels.ingredients)}
          variant="text"
          icon="photo_camera"
          onPress={() => onRetake('ingredients')}
        />
      </Card>

      <Card style={{ gap: space.s2 }}>
        <AppText variant="heading" heading>
          {enGB.nutrition.title}
        </AppText>
        <AppText variant="bodySm" color="ink2">
          {enGB.capture.panelState[panelState('nutrition')]}
        </AppText>
        {nutrients.length === 0 ? (
          <AppText color="ink2">{enGB.review.noNutrients}</AppText>
        ) : (
          nutrients.map((row, index) => (
            <View key={row.field}>
              {index > 0 ? <Divider /> : null}
              <EditRow
                title={row.label}
                onEdit={() => onEditNutrient(row.field)}
              >
                {row.kind === null ? (
                  <AppText variant="data" color="ink2">
                    {formatAmount(row)}
                  </AppText>
                ) : row.kind.kind === 'uncertain' ? (
                  <ProvenanceMark
                    fact={row.kind}
                    text={formatAmount(row)}
                    onCheck={() => onEditNutrient(row.field)}
                  />
                ) : (
                  <ProvenanceMark fact={row.kind} text={formatAmount(row)} />
                )}
              </EditRow>
            </View>
          ))
        )}
        <Button
          label={enGB.capture.retake(enGB.capture.panels.nutrition)}
          variant="text"
          icon="photo_camera"
          onPress={() => onRetake('nutrition')}
        />
      </Card>

      <View style={{ gap: space.s3 }}>
        <Button
          label={enGB.review.analyse}
          variant="primary"
          busy={pending}
          onPress={onAnalyseAvailable}
        />
        <Button
          label={enGB.review.discard}
          variant="outline"
          onPress={onDiscard}
        />
      </View>
    </View>
  );
}
