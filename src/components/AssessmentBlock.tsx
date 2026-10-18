import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { PersonalView, ScientificView } from '../view-models/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { GradeBadge } from './GradeBadge';
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
  /** The cited scientific reasons, shown inside the Product grade drop-down. */
  evidence?: ReactNode;
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
 * Component 11. For you leads (ADR 002); the product's own scientific grade
 * sits under it in a Product grade band that opens on demand, with its cited
 * reasons. Scientific evidence stays inside that band, apart from personal
 * reasons. When the app cannot assess the user's needs, For you says so in
 * words and shows no letter. Without a profile (S1) For you is the product
 * alone. A later backend result is offered, never applied by itself.
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
}: AssessmentBlockProps) {
  const colors = useColors();
  const announcedOffer = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (updateOffer && !announcedOffer.current) {
      announcedOffer.current = true;
      AccessibilityInfo.announceForAccessibility(
        enGB.assessment.updateAvailable,
      );
    }
  }, [updateOffer]);

  const supported = science.status === 'supported';
  const cannotAssess = personal.status === 'unavailable';

  return (
    <View style={{ gap: space.s5 }}>
      <View style={{ gap: space.s2 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: space.s2,
          }}
        >
          <AppText variant="label" color="ink3" heading>
            {enGB.forYou.title}
          </AppText>
          {supported && !cannotAssess ? (
            <AppText variant="bodySm" color="ink3">
              {enGB.forYou.sameAsProduct}
            </AppText>
          ) : null}
        </View>

        {cannotAssess ? (
          <>
            <AppText variant="title">
              {enGB.assessment.personalUnavailable}
            </AppText>
            <AppText color="ink2">{personal.cause}</AppText>
          </>
        ) : supported ? (
          <AppText color="ink2">{enGB.forYou.productAlone}</AppText>
        ) : (
          <>
            <AppText variant="title">{gapTitle(science)}</AppText>
            {gapLines(science).map((line, index) => (
              <AppText key={`${index}-${line}`} color="ink2">
                {line}
              </AppText>
            ))}
            <Button
              label={enGB.you.method}
              variant="text"
              onPress={onOpenMethod}
            />
          </>
        )}
        {personalPending ? (
          <AppText color="ink2">{enGB.assessment.checkingRequirements}</AppText>
        ) : null}
      </View>

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

      {supported ? (
        <View
          style={{
            backgroundColor: colors.card,
            marginHorizontal: -(space.s5 - space.s1),
            paddingHorizontal: space.s5 - space.s1,
          }}
        >
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={enGB.grade.name(science.letter)}
            accessibilityState={{ expanded: open }}
            radius={radius.sm}
            onPress={() => setOpen((value) => !value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.s3,
              minHeight: 56,
            }}
          >
            <AppText variant="label" color="ink3">
              {enGB.assessment.productGrade}
            </AppText>
            <AppText
              variant="button"
              style={{ textDecorationLine: 'underline' }}
            >
              {open ? enGB.common.hide : enGB.common.show}
            </AppText>
          </Touchable>
          {open ? (
            <View style={{ gap: space.s4, paddingBottom: space.s5 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s4,
                }}
              >
                <GradeBadge
                  letter={science.letter}
                  role="scientific"
                  size="lg"
                  motion="still"
                />
                <AppText color="ink2" style={{ flex: 1 }}>
                  {summary ?? enGB.grade.name(science.letter)}
                </AppText>
              </View>
              {evidence}
              <Button
                label={enGB.you.method}
                variant="text"
                onPress={onOpenMethod}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
