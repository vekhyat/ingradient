import { useState, type ReactNode } from 'react';
import { PixelRatio, View } from 'react-native';

import { AppText } from '../components/AppText';
import { AssessmentBlock } from '../components/AssessmentBlock';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CaptureViewfinder } from '../components/CaptureViewfinder';
import { EvidenceReason } from '../components/EvidenceReason';
import { GradeBadge } from '../components/GradeBadge';
import { HistoryList } from '../components/HistoryList';
import { IngredientList } from '../components/IngredientList';
import { LocalDataControls } from '../components/LocalDataControls';
import { NavBar, type RootTab } from '../components/NavBar';
import { OperationStatus } from '../components/OperationStatus';
import { PanelReview } from '../components/PanelReview';
import { ProductIdentity } from '../components/ProductIdentity';
import { ProvenanceMark } from '../components/ProvenanceMark';
import { Sheet } from '../components/Sheet';
import { SourceDetail } from '../components/SourceDetail';
import { TextField } from '../components/TextField';
import {
  getLocalScenario,
  type LocalScenarioName,
} from '../fixtures/scenarios';
import type { RevealMotion } from '../motion/reveal';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { toResultView } from '../view-models/map-result';
import type { IngredientOccurrence } from '../view-models/types';

/**
 * FE-03 developer playground. Every component in its loading, empty, error,
 * long-text and large-type states, built from the named fixtures. All data
 * here is fictional and labelled so; this screen is reachable only in
 * development builds.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.s3 }}>
      <AppText variant="heading" heading>
        {title}
      </AppText>
      {children}
    </View>
  );
}

function FixtureLabel({ text }: { text: string }) {
  return (
    <AppText variant="label" color="alertInk">
      {`FICTIONAL FIXTURE · ${text}`.toUpperCase()}
    </AppText>
  );
}

const SCENARIOS: LocalScenarioName[] = [
  'complete_graded',
  'missing_nutrients',
  'unsupported_category',
  'conflicting_sources',
];

const LONG_NAME =
  'Extra-long product name with roasted almonds, dark chocolate pieces and a very descriptive subtitle that must wrap';

export function Playground() {
  const theme = useTheme();
  const [sheet, setSheet] = useState(false);
  const [dirtySheet, setDirtySheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [barcode, setBarcode] = useState('89012345');
  const [transcription, setTranscription] = useState(
    'Whole wheat flour (atta) (52%)',
  );
  const [motion, setMotion] = useState<RevealMotion>('first');
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<RootTab>('scan');

  const views = SCENARIOS.map((name) => {
    const scenario = getLocalScenario(name);
    return {
      name,
      view: toResultView({
        snapshot: scenario.snapshot,
        assessment: scenario.assessment,
        executor: 'phone',
        analysedAt: '2026-10-16T10:00:00.000Z',
      }),
    };
  });
  const graded = views[0]?.view;

  const longIngredients: IngredientOccurrence[] = [
    ...(graded?.ingredients ?? []),
    {
      occurrenceId: 'long',
      packOrder: 99,
      printedText:
        'Emulsifier (soy lecithin, sunflower lecithin) and a very long printed ingredient description that wraps over several lines',
      canonicalId: null,
      match: 'ambiguous',
      kind: { kind: 'corrected', origin: 'user_correction', previous: 'ocr' },
      nestedIn: null,
      depth: 0,
    },
    {
      occurrenceId: 'nested',
      packOrder: 100,
      printedText: 'cocoa butter',
      canonicalId: null,
      match: 'unresolved',
      kind: { kind: 'read', origin: 'ocr' },
      nestedIn: 'long',
      depth: 1,
    },
  ];

  return (
    <View style={{ gap: space.s6 }}>
      <Card style={{ gap: space.s2 }}>
        <FixtureLabel text="developer surface" />
        <AppText variant="bodySm">
          {`Theme: ${theme.scheme}, ${theme.source}${
            theme.fallbackReason ? ` (${theme.fallbackReason})` : ''
          } · Font scale ${PixelRatio.getFontScale().toFixed(2)}`}
        </AppText>
      </Card>

      <Section title="01 Button">
        <Button
          label="Save on this phone"
          variant="primary"
          icon="bookmark"
          onPress={() => undefined}
        />
        <Button
          label="Photograph label"
          variant="tonal"
          icon="photo_camera"
          onPress={() => undefined}
        />
        <Button
          label="Outline action"
          variant="outline"
          onPress={() => undefined}
        />
        <Button label="Text action" variant="text" onPress={() => undefined} />
        <Button
          label="A forty character label that wraps here ok"
          variant="primary"
          busy={busy}
          onPress={() => {
            setBusy(true);
            setTimeout(() => setBusy(false), 1500);
          }}
        />
        <Button
          label="Analyse"
          variant="primary"
          disabledReason="Photograph the nutrition table first."
          onPress={() => undefined}
        />
      </Section>

      <Section title="02 Text field">
        <TextField
          purpose="barcode"
          label="Type the barcode"
          value={barcode}
          error={barcode.length === 8 ? 'invalid_checksum' : undefined}
          onChange={setBarcode}
          onSubmit={() => undefined}
        />
        <TextField
          purpose="transcription"
          label="Ingredient as printed"
          value={transcription}
          originalPrinted="Whole wheat fl0ur (atta) (52%)"
          onChange={setTranscription}
        />
      </Section>

      <Section title="04 Sheet">
        <Button
          label="Open clean sheet"
          variant="outline"
          onPress={() => setSheet(true)}
        />
        <Button
          label="Open dirty sheet"
          variant="outline"
          onPress={() => setDirtySheet(true)}
        />
        <Sheet
          visible={sheet}
          title="Source details"
          dirty={false}
          onClose={() => setSheet(false)}
        >
          <AppText>
            Close, system Back and the scrim all close this sheet.
          </AppText>
        </Sheet>
        <Sheet
          visible={dirtySheet}
          title="Correct Total sugars"
          dirty
          onClose={() => setDirtySheet(false)}
          primaryAction={{
            label: 'Apply',
            variant: 'primary',
            onPress: () => setDirtySheet(false),
          }}
        >
          <AppText>
            This sheet has unsaved edits, so closing asks first.
          </AppText>
        </Sheet>
      </Section>

      <Section title="06 Navigation bar">
        <NavBar current={tab} onSelect={setTab} floating={false} />
      </Section>

      <Section title="07 Grade badge">
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: space.s3,
            alignItems: 'center',
          }}
        >
          {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => (
            <GradeBadge
              key={`${letter}-${replay}`}
              letter={letter}
              role="scientific"
              size="lg"
              motion={motion}
            />
          ))}
          <GradeBadge letter="C" role="scientific" size="md" motion="still" />
          <GradeBadge letter="C" role="scientific" size="sm" motion="still" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
          {(['first', 'repeat', 'still'] as const).map((value) => (
            <View key={value} style={{ flexGrow: 1 }}>
              <Button
                label={`Replay ${value}`}
                variant={value === motion ? 'tonal' : 'outline'}
                onPress={() => {
                  setMotion(value);
                  setReplay((n) => n + 1);
                }}
              />
            </View>
          ))}
        </View>
      </Section>

      <Section title="08 Provenance mark">
        <ProvenanceMark
          fact={{ kind: 'read', origin: 'ocr' }}
          text="14.2 g per 100 g"
        />
        <ProvenanceMark
          fact={{
            kind: 'uncertain',
            origin: 'ocr',
            cause:
              'The photo was blurry over this row, so the decimal point may be misread.',
          }}
          text="14 g per 100 g"
          onCheck={() => undefined}
        />
        <ProvenanceMark
          fact={{
            kind: 'corrected',
            origin: 'user_correction',
            previous: 'ocr',
          }}
          text="14.2 g per 100 g"
        />
        <ProvenanceMark
          fact={{
            kind: 'estimated',
            origin: 'model_estimate',
            modelId: 'fixture-model',
            modelVersion: '0.0',
          }}
          text="14 g per 100 g"
        />
      </Section>

      {graded ? (
        <Section title="09 Product identity">
          <FixtureLabel text="complete_graded" />
          <ProductIdentity
            product={graded.product}
            density="hero"
            onInspectSource={() => undefined}
          />
          <ProductIdentity
            product={{
              ...graded.product,
              name: LONG_NAME,
              dataCredit: 'off',
              categoryLabel: 'Biscuits',
            }}
            density="hero"
          />
          <ProductIdentity
            product={{ ...graded.product, name: null, dataCredit: 'mixed' }}
            density="hero"
          />
          <ProductIdentity product={graded.product} density="row" />
        </Section>
      ) : null}

      <Section title="11 Assessment block">
        {views.map(({ name, view }) => (
          <View key={name} style={{ gap: space.s2 }}>
            <FixtureLabel text={name} />
            <AssessmentBlock
              slice="S1"
              science={view.science}
              personal={view.personal}
              summary={view.summary}
              personalPending={false}
              updateOffer={null}
              onOpenUpdate={() => undefined}
              onOpenMethod={() => undefined}
            />
          </View>
        ))}
        <FixtureLabel text="method unavailable + update offer" />
        <AssessmentBlock
          slice="S1"
          science={{
            status: 'method_unavailable',
            gaps: [
              'The grading method is not installed in this build yet, so no letter is shown.',
            ],
          }}
          personal={{ status: 'not_in_slice' }}
          summary={null}
          personalPending={false}
          updateOffer={{
            introducesHardFinding: false,
            differsFromDisplayed: false,
          }}
          onOpenUpdate={() => undefined}
          onOpenMethod={() => undefined}
        />
      </Section>

      <Section title="12 Ingredient list">
        <Card>
          <IngredientList
            items={longIngredients}
            state="ready"
            onOpen={() => undefined}
            onRetry={() => undefined}
          />
        </Card>
        <Card>
          <IngredientList
            items={[]}
            state="loading"
            onOpen={() => undefined}
            onRetry={() => undefined}
          />
        </Card>
        <Card>
          <IngredientList
            items={[]}
            state="missing"
            onOpen={() => undefined}
            onRetry={() => undefined}
          />
        </Card>
        <Card>
          <IngredientList
            items={[]}
            state="error"
            onOpen={() => undefined}
            onRetry={() => undefined}
          />
        </Card>
      </Section>

      {graded ? (
        <Section title="13 Evidence reason">
          {graded.reasons.map((reason) => (
            <EvidenceReason
              key={reason.id}
              id={reason.id}
              text={reason.text}
              citationIds={reason.citationIds}
              citationTitles={Object.fromEntries(
                Object.values(graded.citations).map((c) => [c.id, c.title]),
              )}
              inputText={reason.inputText}
              state="supported"
              onOpenSource={() => undefined}
            />
          ))}
          <EvidenceReason
            id="x"
            text=""
            citationIds={[]}
            citationTitles={{}}
            inputText=""
            state="unavailable"
            onOpenSource={() => undefined}
          />
        </Section>
      ) : null}

      <Section title="14 Source detail">
        <Card>
          <SourceDetail
            title="Nutri-Score FAQ (Version 11)"
            issuer="Santé publique France"
            edition="faq-v11-2025-03-17"
            locator="Section 4"
            claim="general"
            limitation="Fixture text: the method is European and is not an Indian standard."
            url="https://www.santepubliquefrance.fr"
            state="metadata_only"
            onOpenExternal={() => undefined}
            onClose={() => undefined}
          />
        </Card>
        <Card>
          <SourceDetail
            title="Bad link fixture"
            issuer=""
            edition=""
            locator=""
            claim=""
            limitation=""
            url="javascript:alert(1)"
            state="available"
            onOpenExternal={() => undefined}
            onClose={() => undefined}
          />
        </Card>
      </Section>

      <Section title="15 Capture viewfinder">
        <CaptureViewfinder
          scanningBarcodes
          showPanels={false}
          permission="granted"
          cameraState="ready"
          torch="off"
          panels={[]}
          onTorch={() => undefined}
          onAllow={() => undefined}
          onSettings={() => undefined}
        />
        <CaptureViewfinder
          scanningBarcodes={false}
          showPanels
          permission="granted"
          cameraState="ready"
          torch="on"
          panels={[
            { panel: 'ingredients', state: 'read', imageId: 'a' },
            { panel: 'nutrition', state: 'missing', imageId: null },
          ]}
          onTorch={() => undefined}
          onAllow={() => undefined}
          onSettings={() => undefined}
        />
        <CaptureViewfinder
          scanningBarcodes
          showPanels={false}
          permission="blocked"
          cameraState="starting"
          torch="unsupported"
          panels={[]}
          onTorch={() => undefined}
          onAllow={() => undefined}
          onSettings={() => undefined}
        />
      </Section>

      {graded ? (
        <Section title="16 Panel review">
          <PanelReview
            ingredients={graded.ingredients}
            nutrients={views[1]?.view.nutrients ?? []}
            panels={graded.panels}
            pending={false}
            onEditIngredient={() => undefined}
            onEditNutrient={() => undefined}
            onRetake={() => undefined}
            onAnalyseAvailable={() => undefined}
            onDiscard={() => undefined}
          />
        </Section>
      ) : null}

      <Section title="17 Operation status">
        <OperationStatus
          stage="lookup"
          state="pending"
          message="Looking up this barcode"
          onCancel={() => undefined}
        />
        <OperationStatus
          stage="analysis"
          analysisPath="server"
          state="pending"
          message=""
          onCancel={() => undefined}
        />
        <OperationStatus
          stage="analysis"
          analysisPath="phone_fallback"
          state="pending"
          message=""
          onCancel={() => undefined}
        />
        <OperationStatus
          stage="lookup"
          state="failed"
          message="You are offline. Barcode lookup needs a connection."
          onRetry={() => undefined}
          onCaptureLabel={() => undefined}
        />
        <OperationStatus
          stage="lookup"
          state="empty"
          message="This product is not in Open Food Facts yet."
          onCaptureLabel={() => undefined}
        />
      </Section>

      <Section title="18 History list">
        <HistoryList
          rows={[
            {
              snapshotId: '1',
              name: 'Oat Crunch Cereal',
              capturedAt: '2026-10-16T10:00:00Z',
              label: 'Product alone',
              letter: 'C',
              kind: 'product',
            },
            {
              snapshotId: '2',
              name: LONG_NAME,
              capturedAt: '2026-10-01T10:00:00Z',
              label: 'Product alone',
              letter: null,
              kind: 'product',
            },
          ]}
          state="ready"
          onOpen={() => undefined}
          onDelete={() => undefined}
          onRetry={() => undefined}
        />
        <HistoryList
          rows={[]}
          state="empty"
          onOpen={() => undefined}
          onDelete={() => undefined}
          onRetry={() => undefined}
        />
        <HistoryList
          rows={[]}
          state="error"
          onOpen={() => undefined}
          onDelete={() => undefined}
          onRetry={() => undefined}
        />
      </Section>

      <Section title="19 Local data controls">
        <LocalDataControls
          slice="S1"
          savedCount={3}
          operation="idle"
          onErase={() => undefined}
          onOpenPrivacy={() => undefined}
          onOpenMethod={() => undefined}
        />
        <LocalDataControls
          slice="S1"
          savedCount={3}
          operation="failed"
          onErase={() => undefined}
          onOpenPrivacy={() => undefined}
          onOpenMethod={() => undefined}
        />
      </Section>
    </View>
  );
}
