import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { type SharedValue } from 'react-native-reanimated';

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
import { LabelFactsCard } from '../../features/result/LabelFactsCard';
import { NutritionTable } from '../../features/result/NutritionTable';
import { useResult } from '../../features/result/useResult';
import { haptics } from '../../motion/haptics';
import { useReducedMotion } from '../../motion/reduced-motion';
import { revealSession, type RevealMotion } from '../../motion/reveal';
import {
  useResultReveal,
  useRevealSection,
} from '../../motion/useResultReveal';
import { space } from '../../theme/tokens';
import { hasNutritionValues, labelFacts } from '../../view-models/label-facts';

const PREVIEW_INGREDIENTS = 6;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** One revealed section; index 0 is the product card. */
function Reveal({
  progress,
  index,
  children,
}: {
  progress: SharedValue<number>;
  index: number;
  children: ReactNode;
}) {
  const style = useRevealSection(progress, index);
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * U08 Result, ingredients first (D131). Order: what the pack is, what its
 * ingredient list says, the ingredients, then the nutrition grade and table.
 * Without a nutrition table the grade block asks for it instead of
 * dominating the screen. The v18 reveal plays once per new result (D58).
 * Saving says "Saved on this phone" only after the encrypted store confirms.
 */
export default function ResultScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const result = useResult(key);
  const { store, scan, label, bumpStore } = useServices();
  const reducedMotion = useReducedMotion();
  const [saveState, setSaveState] = useState<SaveState>('idle');

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
  const reveal = useResultReveal(motion, reducedMotion);

  const facts = useMemo(
    () => (result ? labelFacts(result.stored.snapshot) : null),
    [result],
  );

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
        : enGB.facts.title,
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
  const needsNutrition = !hasNutritionValues(stored.snapshot);

  const save = async () => {
    if (store.status !== 'ready' || saveState === 'saving') {
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
    } catch {
      setSaveState('failed');
    }
  };

  const addNutrition = () => {
    label.start(stored.snapshot);
    router.push('/capture');
  };

  const reasons = view.reasons.slice(0, 3);
  const citationTitles: Record<string, string> = {};
  for (const citation of Object.values(view.citations)) {
    citationTitles[citation.id] = citation.title;
  }
  let section = 0;

  return (
    <ScreenFrame
      title={enGB.result.title}
      onBack={() => router.back()}
      dock={
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
                store.status === 'error' ? enGB.status.saving.failed : undefined
              }
              onPress={() => void save()}
            />
          )}
        </DockItem>
      }
    >
      {saveState === 'failed' ? (
        <Card>
          <AppText accessibilityRole="alert">
            {enGB.status.saving.failed}
          </AppText>
        </Card>
      ) : null}

      <Reveal progress={reveal.progress} index={section++}>
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
      </Reveal>

      <Reveal progress={reveal.progress} index={section++}>
        {facts ? (
          <LabelFactsCard facts={facts} />
        ) : (
          <Card>
            <AppText color="ink2">{enGB.facts.none}</AppText>
          </Card>
        )}
      </Reveal>

      {needsNutrition && stored.origin === 'new' ? (
        <Reveal progress={reveal.progress} index={section++}>
          <Card style={{ gap: space.s3 }}>
            <AppText variant="heading" heading>
              {enGB.addNutrition.title}
            </AppText>
            <AppText color="ink2">{enGB.addNutrition.body}</AppText>
            <Button
              label={enGB.addNutrition.action}
              variant="tonal"
              icon="photo_camera"
              onPress={addNutrition}
            />
          </Card>
        </Reveal>
      ) : null}

      <Reveal progress={reveal.progress} index={section++}>
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
            state={view.ingredients.length > 0 ? 'ready' : 'missing'}
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
      </Reveal>

      <Reveal progress={reveal.progress} index={section++}>
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
      </Reveal>

      {reasons.length > 0 ? (
        <Reveal progress={reveal.progress} index={section++}>
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
        </Reveal>
      ) : null}

      {!needsNutrition ? (
        <Reveal progress={reveal.progress} index={section++}>
          <NutritionTable
            rows={view.nutrients}
            onCheck={() =>
              router.push({
                pathname: '/method/[key]',
                params: { key: view.resultKey },
              })
            }
          />
        </Reveal>
      ) : null}

      <AppText variant="bodySm" color="ink3">
        {view.executor === 'backend'
          ? enGB.result.analysedOnServer
          : enGB.result.analysedOnPhone}
      </AppText>
    </ScreenFrame>
  );
}
