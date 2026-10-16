import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { AppText } from '../../components/AppText';
import { AssessmentBlock } from '../../components/AssessmentBlock';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EvidenceReason } from '../../components/EvidenceReason';
import { formatSavedDate } from '../../components/HistoryList';
import { IngredientList } from '../../components/IngredientList';
import { ProductIdentity } from '../../components/ProductIdentity';
import { enGB } from '../../copy/en-GB';
import { DockItem, ScreenFrame } from '../../features/app/ScreenFrame';
import { useServices } from '../../features/app/services';
import { NutritionTable } from '../../features/result/NutritionTable';
import { useResult } from '../../features/result/useResult';
import { haptics } from '../../motion/haptics';
import { useReducedMotion } from '../../motion/reduced-motion';
import { revealSession, type RevealMotion } from '../../motion/reveal';
import { space } from '../../theme/tokens';

const PREVIEW_INGREDIENTS = 4;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * U08 Result. Readable at once: product identity, the S1 product-only
 * assessment or its named gap, up to three cited reasons, ingredients and
 * the nutrition table. Saving is explicit and says "Saved on this phone"
 * only after the encrypted store confirms the write.
 */
export default function ResultScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const result = useResult(key);
  const { store, scan, label, bumpStore } = useServices();
  const reducedMotion = useReducedMotion();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Decide the reveal once per result; Back and re-renders do not replay it.
  const motion = useMemo<RevealMotion>(() => {
    if (!result) {
      return 'still';
    }
    return revealSession.motionFor(
      result.view.resultKey,
      result.stored.origin,
      reducedMotion,
    );
    // Only the first decision counts; reducedMotion changes stop the animation itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.view.resultKey]);

  useEffect(() => {
    if (!result) {
      return;
    }
    const { science } = result.view;
    if (science.status === 'supported' && result.stored.origin === 'new') {
      haptics.play('resultReady', result.view.resultKey);
    }
    AccessibilityInfo.announceForAccessibility(
      science.status === 'supported'
        ? enGB.grade.name(science.letter)
        : enGB.assessment.noGrade,
    );
    // Announce once per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.view.resultKey]);

  if (!result) {
    return (
      <ScreenFrame title={enGB.result.title} onBack={() => router.back()}>
        <AppText color="ink2">{enGB.source.error}</AppText>
      </ScreenFrame>
    );
  }

  const { view, stored } = result;
  const saved = stored.savedId !== null;

  const save = async () => {
    if (store.status !== 'ready' || saveState === 'saving') {
      if (__DEV__) {
        console.warn(`Save skipped: store is ${store.status}`);
      }
      setSaveState('failed');
      return;
    }
    setSaveState('saving');
    try {
      const savedId = `saved-${stored.resultKey}`;
      await store.store.save({
        schemaVersion: 1,
        id: savedId,
        savedAt: new Date().toISOString(),
        kind: 'product',
        snapshot: stored.snapshot,
        assessment: stored.assessment,
        executor: stored.executor,
        analysedAt: stored.analysedAt,
      });
      scan.markSaved(stored.resultKey, savedId);
      bumpStore();
      setSaveState('saved');
      AccessibilityInfo.announceForAccessibility(enGB.result.saved);
    } catch (error) {
      if (__DEV__) {
        console.warn(`Save failed: ${(error as Error).message}`);
        setSaveError((error as Error).message);
      }
      setSaveState('failed');
    }
  };

  const reasons = view.reasons.slice(0, 3);
  const citationTitles: Record<string, string> = {};
  for (const citation of Object.values(view.citations)) {
    citationTitles[citation.id] = citation.title;
  }
  const ingredientState = view.ingredients.length > 0 ? 'ready' : 'missing';

  return (
    <ScreenFrame
      title={view.product.name ?? enGB.result.title}
      onBack={() => router.back()}
      dock={
        <>
          {view.science.status === 'insufficient_data' &&
          stored.origin === 'new' ? (
            <DockItem>
              <Button
                label={enGB.result.photographToFill}
                variant="tonal"
                icon="photo_camera"
                onPress={() => {
                  label.start(stored.snapshot);
                  router.push('/capture');
                }}
              />
            </DockItem>
          ) : null}
          <DockItem>
            {saved || saveState === 'saved' ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                style={{
                  minHeight: 52,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <AppText variant="button" color="ink2">
                  {stored.origin === 'history'
                    ? enGB.result.savedOn(formatSavedDate(stored.analysedAt))
                    : enGB.result.saved}
                </AppText>
              </View>
            ) : (
              <Button
                label={enGB.result.save}
                variant="primary"
                icon="bookmark"
                busy={saveState === 'saving'}
                disabledReason={
                  store.status === 'error'
                    ? enGB.status.saving.failed
                    : undefined
                }
                onPress={() => void save()}
              />
            )}
          </DockItem>
        </>
      }
    >
      {saveState === 'failed' ? (
        <Card>
          <AppText accessibilityRole="alert">
            {enGB.status.saving.failed}
          </AppText>
          {__DEV__ && saveError ? (
            <AppText variant="bodySm" color="ink3">
              {saveError}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <ProductIdentity
        product={view.product}
        density="hero"
        onInspectSource={() =>
          router.push({
            pathname: '/method/[key]',
            params: { key: view.resultKey },
          })
        }
      />

      <AssessmentBlock
        slice="S1"
        science={view.science}
        personal={view.personal}
        summary={view.summary}
        personalPending={false}
        motion={motion}
        updateOffer={null}
        onOpenUpdate={() => undefined}
        onOpenMethod={() =>
          router.push({
            pathname: '/method/[key]',
            params: { key: view.resultKey },
          })
        }
      />

      {reasons.length > 0 ? (
        <Card style={{ gap: space.s2 }}>
          <AppText variant="heading" heading>
            {enGB.reasons.title}
          </AppText>
          {reasons.map((reason) => (
            <EvidenceReason
              key={reason.id}
              id={reason.id}
              text={reason.text}
              citationIds={reason.citationIds}
              citationTitles={citationTitles}
              inputText={reason.inputText}
              state="supported"
              onOpenSource={(citationId) =>
                router.push({
                  pathname: '/reason/[key]/[reasonId]',
                  params: {
                    key: view.resultKey,
                    reasonId: reason.id,
                    citationId,
                  },
                })
              }
            />
          ))}
        </Card>
      ) : null}

      <Card style={{ gap: space.s2 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: space.s2,
          }}
        >
          <AppText variant="heading" heading>
            {enGB.ingredients.title}
          </AppText>
          {view.ingredients.length > 0 ? (
            <AppText variant="bodySm" color="ink2">
              {enGB.ingredients.countInOrder(view.ingredients.length)}
            </AppText>
          ) : null}
        </View>
        <IngredientList
          items={view.ingredients}
          state={ingredientState}
          limit={PREVIEW_INGREDIENTS}
          onOpen={(occurrence) =>
            router.push({
              pathname: '/ingredient/[key]/[occurrence]',
              params: { key: view.resultKey, occurrence },
            })
          }
          onRetry={() => undefined}
        />
        {view.ingredients.length > PREVIEW_INGREDIENTS ? (
          <Button
            label={enGB.ingredients.all(view.ingredients.length)}
            variant="text"
            onPress={() =>
              router.push({
                pathname: '/ingredients/[key]',
                params: { key: view.resultKey },
              })
            }
          />
        ) : null}
      </Card>

      <NutritionTable
        rows={view.nutrients}
        onCheck={() =>
          router.push({
            pathname: '/method/[key]',
            params: { key: view.resultKey },
          })
        }
      />

      <AppText variant="bodySm" color="ink3">
        {view.executor === 'backend'
          ? enGB.result.analysedOnServer
          : enGB.result.analysedOnPhone}
        {view.science.status === 'supported'
          ? ` · ${enGB.assessment.methodLabel}`
          : ''}
      </AppText>
    </ScreenFrame>
  );
}
