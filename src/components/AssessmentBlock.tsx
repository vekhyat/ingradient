import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { duration } from '../motion/durations';
import type { RevealMotion } from '../motion/reveal';
import { gradeColor } from '../theme/resolve-theme';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import type {
  Letter,
  PersonalView,
  ScientificView,
} from '../view-models/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { GradeBadge, type GradeBadgeHandle } from './GradeBadge';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface AssessmentBlockProps {
  slice: 'S1' | 'S2' | 'S3' | 'S4';
  science: ScientificView;
  personal: PersonalView;
  summary: string | null;
  personalPending: boolean;
  /** D70. Null when no eligible late backend result exists. */
  updateOffer: null | {
    introducesHardFinding: boolean;
    differsFromDisplayed: boolean;
  };
  onOpenUpdate: () => void;
  onOpenMethod: () => void;
  /** The cited scientific reasons, shown when the reasons row opens. */
  evidence?: ReactNode;
  /** How many cited reasons `evidence` holds; names the reasons row. */
  reasonCount: number;
  /** The headline stamp's reveal (D58). */
  motion: RevealMotion;
  /** Offered inside the named gap when the nutrition table is missing. */
  onAddNutrition?: () => void;
}

/** Wait for Result to finish sliding in, so the stamp is seen landing. */
const STAMP_DELAY = duration.route + 150;

type Gap = Exclude<ScientificView, { status: 'supported' }>;

function gapTitle(science: Gap) {
  switch (science.status) {
    case 'insufficient_data':
      return enGB.assessment.insufficientTitle;
    case 'method_unavailable':
      return enGB.assessment.methodUnavailableTitle;
    case 'unsupported':
      return enGB.assessment.unsupportedTitle;
  }
}

function gapLines(science: Gap) {
  return science.status === 'unsupported' ? [science.detail] : science.gaps;
}

/** The heavy ink rule that closes the grade section, edge to edge. */
function HeavyRule() {
  const colors = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: size.rule,
        backgroundColor: colors.ink,
        // The rule runs past the screen's side padding.
        marginHorizontal: -(space.s5 - space.s1),
      }}
    />
  );
}

/** A full-width row that opens or closes the cited reasons. */
function ReasonsRow({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      radius={radius.sm}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.s3,
        minHeight: size.targetMin,
        borderTopWidth: 1,
        borderTopColor: colors.hair,
      }}
    >
      <AppText
        variant="button"
        style={{ flexShrink: 1, textDecorationLine: 'underline' }}
      >
        {label}
      </AppText>
      <Icon name={open ? 'expand_less' : 'expand_more'} color={colors.ink} />
    </Touchable>
  );
}

/** The opened reasons, followed by the method page link. */
function Evidence({
  evidence,
  onOpenMethod,
}: {
  evidence: ReactNode;
  onOpenMethod: () => void;
}) {
  return (
    <View style={{ gap: space.s3 }}>
      {evidence}
      <Button label={enGB.you.method} variant="text" onPress={onOpenMethod} />
    </View>
  );
}

/**
 * The scientific product grade as the Result headline (ADR 015): the
 * stamp, its name and top reason beside it, then the full reasons on demand.
 * A tap on the stamp mid-reveal finishes it.
 */
function ScientificHeadline({
  letter,
  summary,
  motion,
  reasonCount,
  evidence,
  onOpenMethod,
}: {
  letter: Letter;
  summary: string | null;
  motion: RevealMotion;
  reasonCount: number;
  evidence: ReactNode;
  onOpenMethod: () => void;
}) {
  const stamp = useRef<GradeBadgeHandle>(null);
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.s3 }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s4 }}
      >
        <Touchable
          accessibilityRole="image"
          accessibilityLabel={enGB.grade.name(letter)}
          radius={radius.sm}
          onPress={() => stamp.current?.skip()}
        >
          <GradeBadge
            ref={stamp}
            letter={letter}
            role="scientific"
            size="xl"
            motion={motion}
            speak={false}
            tilt
            delay={STAMP_DELAY}
          />
        </Touchable>
        <View style={{ flex: 1, gap: space.s1 }}>
          <AppText variant="label" color="ink3" heading>
            {enGB.assessment.scientificGrade}
          </AppText>
          {summary ? <AppText variant="subhead">{summary}</AppText> : null}
          <AppText variant="bodySm" color="ink3">
            {enGB.assessment.scaleHint}
          </AppText>
        </View>
      </View>
      {reasonCount > 0 ? (
        <View>
          <ReasonsRow
            label={
              open
                ? enGB.assessment.hideReasons
                : enGB.assessment.seeReasons(reasonCount)
            }
            open={open}
            onPress={() => setOpen((value) => !value)}
          />
          {open ? (
            <Evidence evidence={evidence} onOpenMethod={onOpenMethod} />
          ) : null}
        </View>
      ) : (
        <Button label={enGB.you.method} variant="text" onPress={onOpenMethod} />
      )}
    </View>
  );
}

/** A–E with the supported letter filled; the band's label speaks it. */
function GradeScale({ letter }: { letter: Letter }) {
  const colors = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s1 }}
    >
      {(['A', 'B', 'C', 'D', 'E'] as const).map((item) => {
        const on = item === letter;
        return (
          <View
            key={item}
            style={{
              minWidth: on ? 34 : 26,
              minHeight: on ? 34 : 26,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? gradeColor(colors, item) : undefined,
              borderWidth: on ? size.badgeRing : 1,
              borderColor: on ? colors.badgeRing : colors.hair2,
            }}
          >
            <AppText
              variant={on ? 'subhead' : 'bodySm'}
              style={{ color: on ? colors.onGrade : colors.ink3 }}
            >
              {item}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The scientific grade under a personal or conflict headline (ADR 002 D20):
 * a band that opens to its cited reasons and never implies suitability.
 */
function ScientificDropdown({
  letter,
  summary,
  reasonCount,
  evidence,
  onOpenMethod,
}: {
  letter: Letter;
  summary: string | null;
  reasonCount: number;
  evidence: ReactNode;
  onOpenMethod: () => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{
        backgroundColor: colors.card,
        marginHorizontal: -(space.s5 - space.s1),
        paddingHorizontal: space.s5 - space.s1,
        paddingBottom: open ? space.s5 : 0,
      }}
    >
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${enGB.grade.name(letter)}. ${summary ?? ''}`}
        accessibilityState={{ expanded: open }}
        radius={radius.sm}
        onPress={() => setOpen((value) => !value)}
        style={{ gap: space.s3, paddingVertical: space.s4 }}
      >
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: space.s2,
          }}
        >
          <AppText variant="label" color="ink3">
            {enGB.assessment.scientificGrade}
          </AppText>
          <AppText variant="button" style={{ textDecorationLine: 'underline' }}>
            {open ? enGB.common.hide : enGB.assessment.reasonCount(reasonCount)}
          </AppText>
        </View>
        <GradeScale letter={letter} />
        {summary ? <AppText variant="subhead">{summary}</AppText> : null}
      </Touchable>
      {open ? (
        <Evidence evidence={evidence} onOpenMethod={onOpenMethod} />
      ) : null}
    </View>
  );
}

/** A named gap: no letter, what is missing, and the way to fix it (D131). */
function GapBlock({
  science,
  onOpenMethod,
  onAddNutrition,
}: {
  science: Gap;
  onOpenMethod: () => void;
  onAddNutrition?: () => void;
}) {
  return (
    <View style={{ gap: space.s2 }}>
      <AppText variant="label" color="ink3" heading>
        {enGB.assessment.scientificGrade}
      </AppText>
      <AppText variant="title">{gapTitle(science)}</AppText>
      {gapLines(science).map((line, index) => (
        <AppText key={`${index}-${line}`} color="ink2">
          {line}
        </AppText>
      ))}
      {onAddNutrition ? (
        <View style={{ marginTop: space.s2 }}>
          <Button
            label={enGB.addNutrition.action}
            variant="outline"
            icon="photo_camera"
            onPress={onAddNutrition}
          />
        </View>
      ) : null}
      <Button label={enGB.you.method} variant="text" onPress={onOpenMethod} />
    </View>
  );
}

/**
 * Component 11 (ADR 015). The scientific product grade leads while nothing
 * in the user's profile changes the result. When the app cannot assess the
 * user's needs, that message leads instead, with no personal letter, and the
 * scientific grade sits in a drop-down under the rule (ADR 002 D20).
 * A later backend result is offered, never applied by itself (D70).
 */
export function AssessmentBlock({
  science,
  personal,
  summary,
  personalPending,
  updateOffer,
  onOpenUpdate,
  onOpenMethod,
  evidence,
  reasonCount,
  motion,
  onAddNutrition,
}: AssessmentBlockProps) {
  const colors = useColors();
  const announcedOffer = useRef(false);

  useEffect(() => {
    if (updateOffer && !announcedOffer.current) {
      announcedOffer.current = true;
      AccessibilityInfo.announceForAccessibility(
        enGB.assessment.updateAvailable,
      );
    }
  }, [updateOffer]);

  const cannotAssess = personal.status === 'unavailable';
  const scientific =
    science.status === 'supported' ? (
      cannotAssess ? (
        <ScientificDropdown
          letter={science.letter}
          summary={summary}
          reasonCount={reasonCount}
          evidence={evidence}
          onOpenMethod={onOpenMethod}
        />
      ) : (
        <ScientificHeadline
          letter={science.letter}
          summary={summary}
          motion={motion}
          reasonCount={reasonCount}
          evidence={evidence}
          onOpenMethod={onOpenMethod}
        />
      )
    ) : (
      <GapBlock
        science={science}
        onOpenMethod={onOpenMethod}
        onAddNutrition={onAddNutrition}
      />
    );

  return (
    <View style={{ gap: space.s5 }}>
      {cannotAssess ? (
        <View style={{ gap: space.s2 }}>
          <AppText variant="title">
            {enGB.assessment.personalUnavailable}
          </AppText>
          <AppText color="ink2">{personal.cause}</AppText>
        </View>
      ) : (
        scientific
      )}
      {personalPending ? (
        <AppText color="ink2">{enGB.assessment.checkingRequirements}</AppText>
      ) : null}

      {updateOffer ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderLeftWidth: 4,
            borderLeftColor: colors.accent,
            padding: space.s4,
            gap: space.s2,
          }}
        >
          <AppText variant="subhead">{enGB.assessment.updateAvailable}</AppText>
          {!updateOffer.differsFromDisplayed ? (
            <AppText variant="bodySm" color="ink2">
              {enGB.assessment.updateSame}
            </AppText>
          ) : null}
          <Button
            label={enGB.assessment.updateOpen}
            variant="text"
            onPress={onOpenUpdate}
          />
        </View>
      ) : null}

      {cannotAssess ? (
        <View style={{ gap: science.status === 'supported' ? 0 : space.s5 }}>
          <HeavyRule />
          {scientific}
        </View>
      ) : (
        <HeavyRule />
      )}
    </View>
  );
}
