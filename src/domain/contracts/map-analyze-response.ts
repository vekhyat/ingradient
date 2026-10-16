/**
 * Map a wire AnalyzeResponse into the phone's ProductSnapshot and LocalAssessment.
 *
 * The phone supplies capturedAt, panels, and personal. Those values are never
 * read from the response. inputDigest and edition checks stay with the hybrid
 * client, which still has the exact request body and the installed resources.
 */

import type {
  Citation,
  IngredientMention,
  Issue,
  LocalAssessment,
  NutrientObservation,
  PanelRegion,
  PersonalAssessment,
  ProductSnapshot,
  ScientificAssessment,
  ScientificReason,
  SourceRef,
  TraceStep,
} from './generated/local';
import type {
  AnalyzedProduct,
  AnalyzeResponse,
  Citation as WireCitation,
  IngredientMention as WireIngredient,
  Issue as WireIssue,
  ProductInputObservation,
  ProductInputSource,
  ScientificAssessment as WireScientific,
  ScientificReason as WireReason,
  TraceStep as WireTrace,
} from './generated/wire';
import { validateAnalyzeResponse } from './generated/validate-wire';
import {
  validateLocalAssessment,
  validateProductSnapshot,
} from './generated/validate-local';
import { validationDetail, type ContractValidator } from './validator-types';

export class ContractValidationError extends Error {
  readonly label: string;

  constructor(label: string, detail: string) {
    super(`${label}: ${detail}`);
    this.name = 'ContractValidationError';
    this.label = label;
  }
}

export interface LocalResultContext {
  readonly capturedAt: string;
  readonly panels: readonly PanelRegion[];
  readonly personal: PersonalAssessment;
}

export interface MappedAnalysis {
  readonly snapshot: ProductSnapshot;
  readonly assessment: LocalAssessment;
}

function assertValid(validator: ContractValidator, value: unknown, label: string): void {
  if (!validator(value)) {
    throw new ContractValidationError(label, validationDetail(validator));
  }
}

function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  return validateAnalyzeResponse(value);
}

function atLeastOne<T>(values: readonly T[], label: string): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new ContractValidationError(label, 'must not be empty.');
  }
  return [first, ...rest];
}

function copyIssue(issue: WireIssue): Issue {
  const mapped: Issue = {
    code: issue.code,
    stage: issue.stage,
    message: issue.message,
    action: issue.action,
  };
  if (issue.field !== undefined) {
    mapped.field = issue.field;
  }
  return mapped;
}

function copyLocalIssue(issue: Issue): Issue {
  const mapped: Issue = {
    code: issue.code,
    stage: issue.stage,
    message: issue.message,
    action: issue.action,
  };
  if (issue.field !== undefined) {
    mapped.field = issue.field;
  }
  return mapped;
}

function copyReason(reason: WireReason): ScientificReason {
  return {
    id: reason.id,
    templateId: reason.templateId,
    text: reason.text,
    citationIds: atLeastOne(reason.citationIds, 'reason citations'),
    inputFields: [...reason.inputFields],
    step: reason.step,
  };
}

function copyTrace(step: WireTrace): TraceStep {
  return {
    component: step.component,
    inputFields: [...step.inputFields],
    points: step.points,
    ruleLocator: step.ruleLocator,
    citationIds: atLeastOne(step.citationIds, 'trace citations'),
  };
}

function copyCitation(citation: WireCitation): Citation {
  return {
    id: citation.id,
    title: citation.title,
    issuer: citation.issuer,
    url: citation.url,
    edition: citation.edition,
    locator: citation.locator,
    claimScope: citation.claimScope,
    checkedAt: citation.checkedAt,
  };
}

function copyIngredient(mention: WireIngredient): IngredientMention {
  return {
    id: mention.id,
    text: mention.text,
    parentId: mention.parentId,
    canonicalId: mention.canonicalId,
    state: mention.state,
    candidateIds: [...mention.candidateIds],
    sourceIds: atLeastOne(mention.sourceIds, 'ingredient sources'),
    taxonomyVersion: mention.taxonomyVersion,
  };
}

function copyDerivation(derivation: readonly string[]): string[] {
  return [...derivation];
}

function mapObservation(observation: ProductInputObservation): NutrientObservation {
  switch (observation.kind) {
    case 'read':
      return {
        field: observation.field,
        kind: 'read',
        value: observation.value,
        unit: observation.unit,
        basis: observation.basis,
        sourceIds: atLeastOne(observation.sourceIds, 'observation sources'),
        issues: observation.issues.map(copyIssue),
        ...(observation.derivation === undefined
          ? {}
          : { derivation: copyDerivation(observation.derivation) }),
      };
    case 'uncertain':
      return {
        field: observation.field,
        kind: 'uncertain',
        value: observation.value,
        unit: observation.unit,
        basis: observation.basis,
        sourceIds: atLeastOne(observation.sourceIds, 'observation sources'),
        issues: atLeastOne(observation.issues.map(copyIssue), 'uncertain observation issues'),
        ...(observation.derivation === undefined
          ? {}
          : { derivation: copyDerivation(observation.derivation) }),
      };
    case 'corrected':
      return {
        field: observation.field,
        kind: 'corrected',
        value: observation.value,
        unit: observation.unit,
        basis: observation.basis,
        sourceIds: atLeastOne(observation.sourceIds, 'observation sources'),
        issues: observation.issues.map(copyIssue),
        previousSourceIds: atLeastOne(observation.previousSourceIds, 'previous sources'),
        ...(observation.derivation === undefined
          ? {}
          : { derivation: copyDerivation(observation.derivation) }),
      };
    case 'missing':
      return {
        field: observation.field,
        kind: 'missing',
        reason: observation.reason,
        issues: observation.issues.map(copyIssue),
      };
    default: {
      const unexpected: never = observation;
      throw new ContractValidationError(
        'observation',
        `wire kind is not mapped: ${JSON.stringify(unexpected)}.`,
      );
    }
  }
}

function mapSource(source: ProductInputSource): SourceRef {
  const mapped: SourceRef = {
    id: source.id,
    kind: source.kind,
    title: source.title,
  };
  if (source.edition !== undefined) {
    mapped.edition = source.edition;
  }
  return mapped;
}

function mapPanel(panel: PanelRegion): PanelRegion {
  const mapped: PanelRegion = {
    panel: panel.panel,
    state: panel.state,
    imageId: panel.imageId,
    regionId: panel.regionId,
    issues: panel.issues.map(copyLocalIssue),
  };
  if (panel.text !== undefined) {
    mapped.text = panel.text;
  }
  return mapped;
}

function mapScientific(scientific: WireScientific): ScientificAssessment {
  if (scientific.state === 'graded') {
    return {
      state: 'graded',
      grade: scientific.grade,
      score: scientific.score,
      route: scientific.route,
      method: {
        id: scientific.method.id,
        edition: scientific.method.edition,
        bundleId: scientific.method.bundleId,
        bundleSha256: scientific.method.bundleSha256,
        label: scientific.method.label,
      },
      inputSnapshotId: scientific.inputSnapshotId,
      reasons: atLeastOne(scientific.reasons.map(copyReason), 'graded reasons'),
      trace: atLeastOne(scientific.trace.map(copyTrace), 'graded trace'),
      issues: scientific.issues.map(copyIssue),
    };
  }
  return {
    state: scientific.state,
    inputSnapshotId: scientific.inputSnapshotId,
    reasons: scientific.reasons.map(copyReason),
    issues: atLeastOne(scientific.issues.map(copyIssue), 'scientific issues'),
  };
}

function mapProduct(product: AnalyzedProduct, context: LocalResultContext): ProductSnapshot {
  return {
    id: product.id,
    barcode: product.barcode,
    name: product.name,
    market: product.market,
    capturedAt: context.capturedAt,
    sourceRefs: product.sourceRefs.map(mapSource),
    observations: product.observations.map(mapObservation),
    ingredients: product.ingredients.map(copyIngredient),
    panels: context.panels.map(mapPanel),
    category: product.category,
    taxonomyVersion: product.taxonomyVersion,
    evidenceVersion: product.evidenceVersion,
  };
}

export function mapAnalyzeResponse(
  response: unknown,
  context: LocalResultContext,
): MappedAnalysis {
  assertValid(validateAnalyzeResponse, response, 'AnalyzeResponse');
  if (!isAnalyzeResponse(response)) {
    throw new ContractValidationError('AnalyzeResponse', 'rejected.');
  }
  if (response.scientific.inputSnapshotId !== response.product.id) {
    throw new ContractValidationError(
      'AnalyzeResponse',
      'scientific.inputSnapshotId must equal product.id.',
    );
  }
  const snapshot = mapProduct(response.product, context);
  const assessment: LocalAssessment = {
    snapshotId: response.product.id,
    scientific: mapScientific(response.scientific),
    personal: context.personal,
    citations: response.citations.map(copyCitation),
  };
  assertValid(validateProductSnapshot, snapshot, 'ProductSnapshot');
  assertValid(validateLocalAssessment, assessment, 'LocalAssessment');
  return { snapshot, assessment };
}
