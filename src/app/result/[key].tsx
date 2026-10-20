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
import {
  productSummaryLine,
  productTitle,
} from '../../components/ProductIdentity';
import { ResultDisclosure } from '../../components/ResultDisclosure';
import { ResultHead } from '../../components/ResultHead';
import { enGB } from '../../copy/en-GB';
import { DockItem, ScreenFrame } from '../../features/app/ScreenFrame';
import { useServices } from '../../features/app/services';
import { DeclaredAllergens } from '../../features/result/DeclaredAllergens';
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

/** One revealed section; index 0 is the product and grade card. */
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
 * U08 Result: the product head, then the scientific product grade as the
 * headline with its top reason (ADR 015), closed by the heavy rule. The
 * allergens the pack declares and the ingredients follow; label facts and
 * nutrition expand in place. Missing inputs still produce a named gap,
 * never a guessed letter (D131). The v18 reveal plays once per new result
 * (D58).
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
      const savedAt = new Date().toISOString();
      await store.store.save({
        schemaVersion: 1,
        id: savedId,
        savedAt,
        kind: 'product',
        snapshot: stored.snapshot,
        assessment: stored.assessment,
        executor: stored.executor,
        analysedAt: stored.analysedAt,
      });
      scan.markSaved(stored.resultKey, savedId, savedAt);
      bumpStore();
      setSaveState('saved');
      AccessibilityInfo.announceForAccessibility(enGB.result.saved);
    } catch {
      setSaveState('failed');
    }
  };

  // D70: the update opens as its own result; Back returns to this one.
  const openUpdate = () => {
    const updatedKey = scan.openUpdate(stored.resultKey);
    if (updatedKey) {
      router.push({ pathname: '/result/[key]', params: { key: updatedKey } });
    }
  };

  const addNutrition = () => {
    label.start(stored.snapshot);
    router.push('/capture');
  };

  const reasons = view.reasons;
  const citationTitles: Record<string, string> = {};
  for (const citation of Object.values(view.citations)) {
    citationTitles[citation.id] = citation.title;
  }
  const openMethod = () =>
    router.push({
      pathname: '/method/[key]',
      params: { key: view.resultKey },
    });
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
                {stored.origin === 'history' && stored.savedAt
                  ? enGB.result.savedOn(formatSavedDate(stored.savedAt))
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
        <ResultHead
          title={productTitle(view.product)}
          meta={productSummaryLine(view.product)}
        />
      </Reveal>

      <Reveal progress={reveal.progress} index={section++}>
        <AssessmentBlock
          slice="S1"
          science={view.science}
          personal={view.personal}
          summary={view.summary}
          personalPending={false}
          updateOffer={
            stored.pendingUpdate
              ? {
                  introducesHardFinding:
                    stored.pendingUpdate.introducesHardFinding,
                  differsFromDisplayed:
                    stored.pendingUpdate.differsFromDisplayed,
                }
              : null
          }
          onOpenUpdate={openUpdate}
          onOpenMethod={openMethod}
          motion={motion}
          reasonCount={reasons.length}
          onAddNutrition={
            needsNutrition && stored.origin === 'new' ? addNutrition : undefined
          }
          evidence={
            reasons.length > 0 ? (
              <View style={{ gap: space.s1 }}>
                <AppText variant="code" color="ink3">
                  {enGB.assessment.methodLabel.toUpperCase()}
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
              </View>
            ) : null
          }
        />
      </Reveal>

      {facts && (facts.contains.length > 0 || facts.mayContain.length > 0) ? (
        <Reveal progress={reveal.progress} index={section++}>
          <DeclaredAllergens
            contains={facts.contains}
            mayContain={facts.mayContain}
          />
        </Reveal>
      ) : null}

      <Reveal progress={reveal.progress} index={section++}>
        <View style={{ gap: space.s2 }}>
          <AppText variant="label" color="ink3" heading>
            {view.ingredients.length > 0
              ? enGB.ingredients.heading(view.ingredients.length)
              : enGB.ingredients.title}
          </AppText>
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
        </View>
      </Reveal>

      <View>
        {facts ? (
          <ResultDisclosure title={enGB.facts.title}>
            <LabelFactsCard facts={facts} />
          </ResultDisclosure>
        ) : null}
        {!needsNutrition ? (
          <ResultDisclosure title={enGB.nutrition.title}>
            <NutritionTable rows={view.nutrients} onCheck={openMethod} />
          </ResultDisclosure>
        ) : null}
      </View>

      <AppText variant="bodySm" color="ink3">
        {view.executor === 'backend'
          ? enGB.result.analysedOnServer
          : (stored.fallbackIssue?.message ?? enGB.result.analysedOnPhone)}
      </AppText>
    </ScreenFrame>
  );
}
