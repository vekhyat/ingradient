import { useEffect, useRef } from 'react';
import { AccessibilityInfo, PixelRatio, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import type { RevealMotion } from '../motion/reveal';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { PersonalView, ScientificView } from '../view-models/types';
import { AppText } from './AppText';
import { Card, Divider } from './Card';
import { GradeBadge, type GradeBadgeHandle } from './GradeBadge';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface AssessmentBlockProps {
  slice: 'S1' | 'S2' | 'S3' | 'S4';
  science: ScientificView;
  personal: PersonalView;
  summary: string | null;
  personalPending: boolean;
  motion: RevealMotion;
  /** D70. Null when no eligible late backend result exists. */
  updateOffer: null | {
    introducesHardFinding: boolean;
    differsFromDisplayed: boolean;
  };
  onOpenUpdate: () => void;
  onOpenMethod: () => void;
}

function gapTitle(science: Exclude<ScientificView, { status: 'supported' }>) {
  switch (science.status) {
    case 'insufficient_data':
      return enGB.assessment.insufficientTitle;
    case 'method_unavailable':
      return enGB.assessment.methodUnavailableTitle;
    case 'unsupported':
      return enGB.assessment.unsupportedTitle;
  }
}

function gapLines(science: Exclude<ScientificView, { status: 'supported' }>) {
  return science.status === 'unsupported' ? [science.detail] : science.gaps;
}

/**
 * Component 11, S1 branches. One answer first: the product grade with a
 * sourced sentence, or the named reason there is no letter. In S1 the
 * headline is about the product alone; no For you line and no profile
 * prompt. A later backend result is offered, never applied by itself.
 */
export function AssessmentBlock({
  science,
  personal,
  summary,
  personalPending,
  motion,
  updateOffer,
  onOpenUpdate,
  onOpenMethod,
}: AssessmentBlockProps) {
  const colors = useColors();
  const badge = useRef<GradeBadgeHandle>(null);
  const announcedOffer = useRef(false);
  const stacked = PixelRatio.getFontScale() >= 1.5;

  useEffect(() => {
    if (updateOffer && !announcedOffer.current) {
      announcedOffer.current = true;
      AccessibilityInfo.announceForAccessibility(
        enGB.assessment.updateAvailable,
      );
    }
  }, [updateOffer]);

  const animating = motion !== 'still' && science.status === 'supported';

  return (
    <Card style={{ gap: space.s4 }}>
      {science.status === 'supported' ? (
        <View
          style={{
            flexDirection: stacked ? 'column-reverse' : 'row',
            gap: space.s3,
            alignItems: stacked ? 'flex-start' : 'center',
          }}
        >
          <View
            accessible
            accessibilityLabel={[
              enGB.grade.name(science.letter),
              summary ?? '',
            ].join('. ')}
            style={{ flex: stacked ? undefined : 1, gap: space.s1 }}
          >
            <AppText variant="label" color="ink2">
              {enGB.assessment.productGrade.toUpperCase()}
            </AppText>
            <AppText variant="display" heading>
              {enGB.grade.name(science.letter)}
            </AppText>
            {summary ? <AppText color="ink2">{summary}</AppText> : null}
          </View>
          <GradeBadge
            ref={badge}
            letter={science.letter}
            role="scientific"
            size="lg"
            motion={motion}
            speak={false}
          />
        </View>
      ) : (
        <View style={{ gap: space.s2 }}>
          <AppText variant="label" color="ink2">
            {enGB.assessment.noGrade.toUpperCase()}
          </AppText>
          <AppText variant="display" heading>
            {gapTitle(science)}
          </AppText>
          {gapLines(science).map((line, index) => (
            <AppText key={`${index}-${line}`} color="ink2">
              {line}
            </AppText>
          ))}
        </View>
      )}

      {personal.status === 'unavailable' ? (
        <AppText color="ink2">{`${enGB.assessment.personalUnavailable}: ${personal.cause}`}</AppText>
      ) : null}
      {personalPending ? (
        <AppText color="ink2">{enGB.assessment.checkingRequirements}</AppText>
      ) : null}

      {updateOffer ? (
        <View
          style={{
            backgroundColor: colors.primarySoft,
            borderRadius: radius.sm,
            padding: space.s3,
            gap: space.s2,
          }}
        >
          <AppText variant="subhead" color="onPrimarySoft">
            {enGB.assessment.updateAvailable}
          </AppText>
          {!updateOffer.differsFromDisplayed ? (
            <AppText variant="bodySm" color="onPrimarySoft">
              {enGB.assessment.updateSame}
            </AppText>
          ) : null}
          <Touchable
            accessibilityRole="button"
            radius={radius.sm}
            onPress={onOpenUpdate}
            style={{ justifyContent: 'center', alignSelf: 'flex-start' }}
          >
            <AppText variant="button" color="onPrimarySoft">
              {enGB.assessment.updateOpen}
            </AppText>
          </Touchable>
        </View>
      ) : null}

      <Divider />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
        <Touchable
          accessibilityRole="button"
          radius={radius.sm}
          onPress={onOpenMethod}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s2,
            flexGrow: 1,
          }}
        >
          <Icon name="info" color={colors.ink2} />
          <AppText variant="bodySm" color="ink2" style={{ flex: 1 }}>
            {`${enGB.assessment.methodLabel} · ${enGB.result.method}`}
          </AppText>
          <Icon name="chevron_right" color={colors.ink2} />
        </Touchable>
        {animating ? (
          <Touchable
            accessibilityRole="button"
            radius={radius.sm}
            onPress={() => badge.current?.skip()}
            style={{ justifyContent: 'center' }}
          >
            <AppText variant="bodySm" color="primary">
              {enGB.assessment.skip}
            </AppText>
          </Touchable>
        ) : null}
      </View>
    </Card>
  );
}
