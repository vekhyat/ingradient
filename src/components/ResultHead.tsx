import { useRef } from 'react';
import { View } from 'react-native';

import { enGB } from '../copy/en-GB';
import type { RevealMotion } from '../motion/reveal';
import { duration } from '../motion/durations';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import type { Letter } from '../view-models/types';
import { AppText } from './AppText';
import { GradeBadge, type GradeBadgeHandle } from './GradeBadge';
import { Touchable } from './Touchable';

export interface ResultHeadProps {
  title: string;
  /** Size and source, including the ODbL credit for barcode records. */
  meta: string;
  /** The For you letter, or null when there is no letter to show. */
  letter: Letter | null;
  motion: RevealMotion;
}

/** Wait for Result to finish sliding in, so the stamp is seen landing. */
const STAMP_DELAY = duration.route + 150;

/**
 * The top of Result, set like the head of a nutrition panel: the product
 * name large, the meta line in mono, the For you stamp beside the name, and
 * one heavy ink rule underneath. A tap on the stamp mid-reveal finishes it.
 */
export function ResultHead({ title, meta, letter, motion }: ResultHeadProps) {
  const colors = useColors();
  const stamp = useRef<GradeBadgeHandle>(null);
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: space.s4,
        }}
      >
        <View style={{ flex: 1, gap: space.s2 }}>
          <AppText variant="display" heading>
            {title}
          </AppText>
          {meta ? (
            <AppText variant="code" color="ink3">
              {meta.toUpperCase()}
            </AppText>
          ) : null}
        </View>
        {letter ? (
          <Touchable
            accessibilityRole="image"
            accessibilityLabel={enGB.forYou.gradeName(letter)}
            radius={radius.sm}
            onPress={() => stamp.current?.skip()}
            style={{ paddingTop: space.s1 }}
          >
            <GradeBadge
              ref={stamp}
              letter={letter}
              role="personal"
              size="lg"
              motion={motion}
              speak={false}
              tilt
              delay={STAMP_DELAY}
            />
          </Touchable>
        ) : null}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          height: size.rule,
          backgroundColor: colors.ink,
          // The rule runs edge to edge, past the screen's side padding.
          marginHorizontal: -(space.s5 - space.s1),
          marginTop: space.s5,
        }}
      />
    </View>
  );
}
