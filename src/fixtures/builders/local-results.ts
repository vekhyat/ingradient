import type {
  Issue,
  LocalAssessment,
  PersonalAssessment,
  ProductSnapshot,
  ScientificAssessment,
  ScientificReason,
  TraceStep,
} from '../../domain/contracts/generated/local';

const methodLabel = 'Nutrition grade · European reference' as const;
const fixtureHash =
  '0000000000000000000000000000000000000000000000000000000000000000';
export const fixtureCapturedAt = '2026-10-16T00:00:00.000Z';

export interface LocalResultFixture {
  readonly snapshot: ProductSnapshot;
  readonly assessment: LocalAssessment;
}

function issue(code: string, message: string): Issue {
  return {
    code,
    stage: 'method',
    message,
    action: 'none',
  };
}

function notInSlice(): PersonalAssessment {
  return { state: 'not_in_slice', issues: [] };
}

export function buildFixtureSnapshot(id = 'fixture-1'): ProductSnapshot {
  return {
    id,
    barcode: null,
    name: null,
    market: 'IN',
    capturedAt: fixtureCapturedAt,
    sourceRefs: [],
    observations: [],
    ingredients: [],
    panels: [
      {
        panel: 'ingredients',
        state: 'missing',
        imageId: null,
        regionId: null,
        issues: [],
      },
    ],
    category: 'unknown',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  };
}

function reason(): ScientificReason {
  return {
    id: 'fixture-reason',
    templateId: 'fixture.reason',
    text: 'Illustrative method reason; this fixture is not a scored product.',
    citationIds: ['spf-faq-v11'],
    inputFields: ['sugars'],
    step: 'sugars-points',
  };
}

function traceStep(): TraceStep {
  return {
    component: 'fixture-only',
    inputFields: ['sugars'],
    points: 5,
    ruleLocator: 'Fixture only; not an official calculation vector',
    citationIds: ['spf-faq-v11'],
  };
}

export function buildGradedScientific(
  inputSnapshotId = 'fixture-1',
): ScientificAssessment {
  return {
    state: 'graded',
    grade: 'C',
    score: 5,
    route: 'general',
    method: {
      id: 'nutriscore-updated-2023',
      edition: 'faq-v11-2025-03-17',
      bundleId: 'fixture-method-1',
      bundleSha256: fixtureHash,
      label: methodLabel,
    },
    inputSnapshotId,
    reasons: [reason()],
    trace: [traceStep()],
    issues: [],
  };
}

export function buildInsufficientDataScientific(
  inputSnapshotId = 'fixture-1',
): ScientificAssessment {
  return {
    state: 'insufficient_data',
    inputSnapshotId,
    reasons: [],
    issues: [
      {
        code: 'missing_fibre',
        stage: 'completeness',
        field: 'fibre',
        message: 'Fibre is not available for this calculation.',
        action: 'add_field',
      },
    ],
  };
}

export function buildMethodUnavailableScientific(
  inputSnapshotId = 'fixture-1',
): ScientificAssessment {
  return {
    state: 'method_unavailable',
    inputSnapshotId,
    reasons: [],
    issues: [
      issue(
        'candidate_method_not_released',
        'A reviewed compatible method bundle is not available.',
      ),
    ],
  };
}

export function buildUnsupportedScientific(
  inputSnapshotId = 'fixture-1',
): ScientificAssessment {
  return {
    state: 'unsupported',
    inputSnapshotId,
    reasons: [],
    issues: [
      issue(
        'category_excluded',
        'This fixture category is outside the supported routes.',
      ),
    ],
  };
}

function asResult(scientific: ScientificAssessment): LocalResultFixture {
  return {
    snapshot: buildFixtureSnapshot(scientific.inputSnapshotId),
    assessment: {
      snapshotId: scientific.inputSnapshotId,
      scientific,
      personal: notInSlice(),
      citations: [],
    },
  };
}

export function buildGradedResult(): LocalResultFixture {
  return asResult(buildGradedScientific());
}

export function buildInsufficientDataResult(): LocalResultFixture {
  return asResult(buildInsufficientDataScientific());
}

export function buildMethodUnavailableResult(): LocalResultFixture {
  return asResult(buildMethodUnavailableScientific());
}

export function buildUnsupportedResult(): LocalResultFixture {
  return asResult(buildUnsupportedScientific());
}
