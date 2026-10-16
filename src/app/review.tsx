import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';

import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { OperationStatus } from '../components/OperationStatus';
import { PanelReview } from '../components/PanelReview';
import { Sheet } from '../components/Sheet';
import {
  TextField,
  type TranscriptionFieldError,
} from '../components/TextField';
import { enGB } from '../copy/en-GB';
import { ScreenFrame } from '../features/app/ScreenFrame';
import { useLabelState, useServices } from '../features/app/services';
import { space } from '../theme/tokens';
import {
  BASIS_LABELS,
  NUTRIENT_LABELS,
  toIngredientOccurrences,
  toNutrientViews,
  toPanelPresence,
} from '../view-models/map-result';

type Editing =
  | { kind: 'ingredient'; id: string; printed: string }
  | {
      kind: 'nutrient';
      field: string;
      printed: string;
      unit: string;
      basis: string;
    };

const UNITS = ['g', 'kJ', 'percent'] as const;
const BASES = ['per_100_g', 'per_100_ml', 'per_serving'] as const;

/**
 * U06 Review and U07 Correction. Every read row is shown with its origin.
 * A correction changes the transcription and is labelled as yours; "Can't
 * read" keeps the value missing. Analyse runs with whatever is present.
 */
export default function ReviewScreen() {
  const router = useRouter();
  const { label, scan } = useServices();
  const labelState = useLabelState();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('g');
  const [basis, setBasis] = useState<(typeof BASES)[number]>('per_100_g');
  const [draftError, setDraftError] = useState<
    TranscriptionFieldError | undefined
  >();
  const [analysing, setAnalysing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const snapshot = useMemo(
    () => label.buildSnapshot(new Date().toISOString()),
    // Rebuild whenever corrections or panels change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [label, labelState.session, labelState.corrections],
  );

  const back = useCallback(() => {
    controller.current?.abort();
    router.back();
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          back();
          return true;
        },
      );
      return () => subscription.remove();
    }, [back]),
  );

  if (!snapshot) {
    return (
      <ScreenFrame title={enGB.review.title} onBack={back}>
        <AppText color="ink2">{enGB.review.noIngredients}</AppText>
      </ScreenFrame>
    );
  }

  const ingredients = toIngredientOccurrences(snapshot);
  const nutrients = toNutrientViews(snapshot);
  const panels = toPanelPresence(snapshot);

  const openIngredient = (id: string) => {
    const row = ingredients.find((item) => item.occurrenceId === id);
    if (!row) {
      return;
    }
    setEditing({ kind: 'ingredient', id, printed: row.printedText });
    setDraft(row.printedText);
    setDraftError(undefined);
  };

  const openNutrient = (field: string) => {
    const row = nutrients.find((item) => item.field === field);
    const observation = snapshot.observations.find(
      (item) => item.field === field,
    );
    const printed =
      observation && observation.kind !== 'missing'
        ? String(observation.value)
        : '';
    setEditing({
      kind: 'nutrient',
      field,
      printed: row?.value === null ? (row?.missingReason ?? '') : printed,
      unit:
        observation && observation.kind !== 'missing' ? observation.unit : 'g',
      basis:
        observation && observation.kind !== 'missing'
          ? observation.basis
          : 'per_100_g',
    });
    setDraft(printed);
    setUnit(
      observation && observation.kind !== 'missing'
        ? observation.unit
        : field === 'energy'
          ? 'kJ'
          : 'g',
    );
    setBasis(
      observation && observation.kind !== 'missing'
        ? observation.basis
        : 'per_100_g',
    );
    setDraftError(undefined);
  };

  const apply = () => {
    if (!editing) {
      return;
    }
    if (editing.kind === 'ingredient') {
      if (draft.trim().length === 0) {
        setDraftError('empty');
        return;
      }
      label.correctIngredient(editing.id, { kind: 'text', text: draft });
    } else {
      const value = Number(draft.replace(',', '.'));
      if (draft.trim().length === 0 || !Number.isFinite(value) || value < 0) {
        setDraftError('empty');
        return;
      }
      label.correctNutrient(editing.field, {
        kind: 'value',
        value,
        unit,
        basis,
      });
    }
    setEditing(null);
  };

  const cantRead = () => {
    if (editing?.kind === 'nutrient') {
      label.correctNutrient(editing.field, { kind: 'unreadable' });
    } else if (editing?.kind === 'ingredient') {
      label.correctIngredient(editing.id, { kind: 'unreadable' });
    }
    setEditing(null);
  };

  const retake = (panel: 'ingredients' | 'nutrition') => {
    label.setRetake(panel);
    router.back();
  };

  const analyse = async () => {
    if (analysing) {
      return;
    }
    setAnalysing(true);
    setFailed(false);
    const abort = new AbortController();
    controller.current = abort;
    const finalSnapshot = label.buildSnapshot(new Date().toISOString());
    const key = finalSnapshot
      ? await scan.analyseSnapshot(finalSnapshot, abort.signal)
      : null;
    if (abort.signal.aborted) {
      return;
    }
    setAnalysing(false);
    if (key === null) {
      setFailed(true);
      return;
    }
    // Photos are not needed once the facts are extracted (D67).
    label.discard();
    router.dismissAll();
    router.push({ pathname: '/result/[key]', params: { key } });
  };

  const editingTitle =
    editing?.kind === 'nutrient'
      ? (NUTRIENT_LABELS[editing.field] ?? editing.field)
      : enGB.review.ingredientLabel;
  const dirty =
    editing !== null &&
    draft !== (editing.kind === 'ingredient' ? editing.printed : '') &&
    draft.length > 0;

  return (
    <ScreenFrame title={enGB.review.title} onBack={back}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      {failed ? (
        <OperationStatus
          stage="analysis"
          state="failed"
          message={enGB.status.analysis.failed}
          onRetry={() => void analyse()}
        />
      ) : null}
      {analysing ? (
        <OperationStatus
          stage="analysis"
          analysisPath="phone_local_only"
          state="pending"
          message={enGB.status.analysis.phone}
          onCancel={() => {
            controller.current?.abort();
            setAnalysing(false);
          }}
        />
      ) : null}
      <PanelReview
        ingredients={ingredients}
        nutrients={nutrients}
        panels={panels}
        pending={analysing}
        onEditIngredient={openIngredient}
        onEditNutrient={openNutrient}
        onRetake={retake}
        onAnalyseAvailable={() => void analyse()}
        onDiscard={() => setConfirmDiscard(true)}
      />

      <Sheet
        visible={editing !== null}
        title={enGB.review.correctionTitle(editingTitle)}
        dirty={dirty}
        onClose={() => setEditing(null)}
        secondaryAction={{
          label: enGB.review.cantRead,
          variant: 'outline',
          onPress: cantRead,
        }}
        primaryAction={{
          label: enGB.review.apply,
          variant: 'primary',
          onPress: apply,
        }}
      >
        {editing ? (
          <View style={{ gap: space.s4 }}>
            <TextField
              purpose="transcription"
              label={
                editing.kind === 'nutrient'
                  ? enGB.review.valueLabel
                  : enGB.review.ingredientLabel
              }
              value={draft}
              originalPrinted={editing.printed || enGB.nutrition.unknown}
              unit={
                editing.kind === 'nutrient'
                  ? unit === 'percent'
                    ? '%'
                    : unit
                  : undefined
              }
              basis={
                editing.kind === 'nutrient' ? BASIS_LABELS[basis] : undefined
              }
              error={draftError}
              onChange={(next) => {
                setDraft(next);
                setDraftError(undefined);
              }}
            />
            {editing.kind === 'nutrient' ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: space.s2,
                  }}
                >
                  {UNITS.map((option) => (
                    <View key={option} style={{ flexGrow: 1 }}>
                      <Button
                        label={option === 'percent' ? '%' : option}
                        variant={option === unit ? 'tonal' : 'outline'}
                        accessibilityLabel={`Unit ${option}${option === unit ? ', selected' : ''}`}
                        onPress={() => setUnit(option)}
                      />
                    </View>
                  ))}
                </View>
                <View style={{ gap: space.s2 }}>
                  {BASES.map((option) => (
                    <Button
                      key={option}
                      label={BASIS_LABELS[option] ?? option}
                      variant={option === basis ? 'tonal' : 'outline'}
                      accessibilityLabel={`${BASIS_LABELS[option]}${option === basis ? ', selected' : ''}`}
                      onPress={() => setBasis(option)}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <Button
              label={enGB.review.retake}
              variant="text"
              icon="photo_camera"
              onPress={() => {
                setEditing(null);
                retake(
                  editing.kind === 'nutrient' ? 'nutrition' : 'ingredients',
                );
              }}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet
        visible={confirmDiscard}
        title={enGB.capture.discardTitle}
        dirty={false}
        onClose={() => setConfirmDiscard(false)}
        secondaryAction={{
          label: enGB.sheet.keepReviewing,
          variant: 'tonal',
          onPress: () => setConfirmDiscard(false),
        }}
        primaryAction={{
          label: enGB.sheet.discard,
          variant: 'outline',
          onPress: () => {
            setConfirmDiscard(false);
            label.discard();
            router.dismissAll();
          },
        }}
      >
        <AppText>{enGB.capture.discardBody}</AppText>
      </Sheet>
    </ScreenFrame>
  );
}
