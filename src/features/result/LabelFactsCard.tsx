import { View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Card, Divider } from '../../components/Card';
import { enGB } from '../../copy/en-GB';
import { space } from '../../theme/tokens';
import type { LabelFacts } from '../../view-models/label-facts';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.s1, paddingVertical: space.s2 }}>
      <AppText variant="label" color="ink2">
        {title.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

/**
 * The ingredients-first answer (D131): what the pack itself says, in plain
 * words. Additive names come from the pinned taxonomy; statements are quoted,
 * not interpreted, and nothing is called safe or unsafe. The pack's Contains
 * and May contain lines sit at the top of Result, so they are not repeated.
 */
export function LabelFactsCard({ facts }: { facts: LabelFacts }) {
  const first = facts.topLevel.slice(0, 3);
  return (
    <Card style={{ gap: space.s1 }}>
      <AppText variant="heading" heading>
        {enGB.facts.title}
      </AppText>

      {first.length > 0 ? (
        <Section title={enGB.facts.listedFirst}>
          <AppText variant="subhead">{first.join(', ')}</AppText>
        </Section>
      ) : null}

      <Divider />
      <Section
        title={
          facts.additives.length > 0
            ? enGB.facts.additives(facts.additives.length)
            : enGB.facts.noAdditives
        }
      >
        {facts.additives.map((additive, index) => (
          <View key={`${additive.code}-${index}`} style={{ gap: 2 }}>
            <AppText variant="subhead">
              {additive.name ?? enGB.facts.unknownAdditive}
            </AppText>
            <AppText variant="bodySm" color="ink2">
              {[additive.written, additive.printedClass]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
        ))}
      </Section>

      {facts.percentages.length > 0 ? (
        <>
          <Divider />
          <Section title={enGB.facts.declared}>
            {facts.percentages.map((item, index) => (
              <View
                key={`${item.name}-${index}`}
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: space.s2,
                }}
              >
                <AppText style={{ flexShrink: 1 }}>{item.name}</AppText>
                <AppText variant="data">{item.text}</AppText>
              </View>
            ))}
          </Section>
        </>
      ) : null}

      {facts.additives.length > 0 ? (
        <AppText variant="bodySm" color="ink3" style={{ paddingTop: space.s2 }}>
          {`${facts.additiveNameCredit}.`}
        </AppText>
      ) : null}
    </Card>
  );
}
