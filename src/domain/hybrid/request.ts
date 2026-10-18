import type {
  Issue,
  NutrientObservation,
  PresenceFact,
  ProductSnapshot,
  SourceRef,
} from '../contracts/generated/local';
import { wireValidators } from '../contracts/generated/validate-wire';
import type {
  AnalyzeRequest,
  Issue as WireIssue,
  ProductAnalysisInput,
  ProductInputObservation,
  ProductInputSource,
  PresenceFact as WirePresenceFact,
  ScoringFacts as WireScoringFacts,
} from '../contracts/generated/wire';
import { validationDetail } from '../contracts/validator-types';
import { MAX_REQUEST_BYTES, WIRE_CONTRACT_VERSION } from './constants';
import type { ResourceCompatibility } from './resources';

/**
 * Builds the product-only analysis request (D67, HYB-01 case 1).
 *
 * Every field is copied by name from the snapshot, never spread, so a
 * profile, allergy, learning record, photo, crop or panel region cannot reach
 * the body even if a caller attaches one to the object. Local source ids are
 * replaced by per-request labels src-0, src-1, ... (D73), and source titles
 * come from the contract's fixed catalogue.
 */

export type BuildResult =
  | { ok: true; body: string; request: AnalyzeRequest }
  | { ok: false; issue: Issue };

type LabelUse = { ingredients: boolean; nutrition: boolean };

const WIRE_KINDS = new Set<SourceRef['kind']>([
  'label',
  'off',
  'user_correction',
]);

const REV = /^rev-[0-9]{1,9}$/;
const RETRIEVED = /^retrieved-(.+)$/;

/** Wire editions are rev-N or a UTC retrieval time; anything else is left out. */
function wireEdition(edition: string | undefined): string | undefined {
  if (edition === undefined) {
    return undefined;
  }
  if (REV.test(edition)) {
    return edition;
  }
  const retrieved = RETRIEVED.exec(edition);
  if (retrieved?.[1]) {
    const time = Date.parse(retrieved[1]);
    if (Number.isFinite(time)) {
      return `${new Date(time).toISOString().slice(0, 19)}Z`;
    }
  }
  return undefined;
}

function wireTitle(
  source: SourceRef,
  use: LabelUse,
): ProductInputSource['title'] {
  switch (source.kind) {
    case 'off':
      return 'Open Food Facts product';
    case 'user_correction':
      return 'User correction';
    default:
      if (use.ingredients && !use.nutrition) {
        return 'Ingredient panel';
      }
      if (use.nutrition && !use.ingredients) {
        return 'Nutrition panel';
      }
      return 'Combined label photo';
  }
}

function invalid(message: string): BuildResult {
  return {
    ok: false,
    issue: {
      code: 'backend_request_invalid',
      stage: 'method',
      message,
      action: 'none',
    },
  };
}

export function buildAnalyzeRequest(
  snapshot: ProductSnapshot,
  resources: ResourceCompatibility,
): BuildResult {
  const byId = new Map(snapshot.sourceRefs.map((ref) => [ref.id, ref]));
  const labelUse = new Map<string, LabelUse>();
  const markUse = (ids: readonly string[], panel: keyof LabelUse) => {
    for (const id of ids) {
      const use = labelUse.get(id) ?? { ingredients: false, nutrition: false };
      use[panel] = true;
      labelUse.set(id, use);
    }
  };
  for (const mention of snapshot.ingredients) {
    markUse(mention.sourceIds, 'ingredients');
  }
  for (const observation of snapshot.observations) {
    if (observation.kind !== 'missing') {
      markUse(observation.sourceIds, 'nutrition');
    }
  }

  // src-N in the order sources are listed; only kinds the wire accepts.
  const wireId = new Map<string, string>();
  const sourceRefs: ProductInputSource[] = [];
  for (const ref of snapshot.sourceRefs) {
    if (!WIRE_KINDS.has(ref.kind) || wireId.has(ref.id)) {
      continue;
    }
    const id = `src-${sourceRefs.length}`;
    wireId.set(ref.id, id);
    const edition = wireEdition(ref.edition);
    sourceRefs.push({
      id,
      kind: ref.kind as ProductInputSource['kind'],
      title: wireTitle(
        ref,
        labelUse.get(ref.id) ?? { ingredients: false, nutrition: false },
      ),
      ...(edition !== undefined ? { edition } : {}),
    });
  }

  const mapIds = (ids: readonly string[]): string[] =>
    ids.flatMap((id) => {
      const mapped = byId.has(id) ? wireId.get(id) : undefined;
      return mapped === undefined ? [] : [mapped];
    });
  const nonEmpty = (ids: string[]): [string, ...string[]] | null => {
    const [first, ...rest] = ids;
    return first === undefined ? null : [first, ...rest];
  };

  const observations: ProductInputObservation[] = [];
  for (const observation of snapshot.observations) {
    const mapped = toWireObservation(observation, mapIds, nonEmpty);
    if (mapped) {
      observations.push(mapped);
    }
  }

  const panel = snapshot.panels.find((item) => item.panel === 'ingredients');
  const text = panel?.text?.trim() ?? '';
  const hasText =
    text.length > 0 &&
    (panel?.state === 'read' || panel?.state === 'uncertain');
  const ingredientsStatus: ProductAnalysisInput['ingredientsStatus'] = !hasText
    ? 'missing'
    : panel?.state === 'read'
      ? 'complete'
      : 'partial';

  const product: ProductAnalysisInput = {
    barcode: snapshot.barcode,
    name: snapshot.name,
    market: snapshot.market,
    ingredientsText: hasText ? text : null,
    ingredientsStatus,
    observations,
    sourceRefs,
    issues: [],
  };
  // ADR013: omission means unknown, so an unknown category is left out.
  if (snapshot.category !== 'unknown') {
    product.category = snapshot.category;
  }
  if (snapshot.scoringFacts) {
    const fact = (local: PresenceFact): WirePresenceFact => {
      if (local.state === 'unknown') {
        return { state: 'unknown' };
      }
      const ids = nonEmpty(mapIds(local.sourceIds));
      // A fact whose sources cannot travel is unknown, never absent.
      return ids
        ? { state: local.state, sourceIds: ids }
        : { state: 'unknown' };
    };
    const facts: WireScoringFacts = {
      categorySourceIds:
        snapshot.category === 'unknown'
          ? []
          : mapIds(snapshot.scoringFacts.categorySourceIds),
      cheese: fact(snapshot.scoringFacts.cheese),
      redMeat: fact(snapshot.scoringFacts.redMeat),
      plainWater: fact(snapshot.scoringFacts.plainWater),
      nonNutritiveSweetener: fact(snapshot.scoringFacts.nonNutritiveSweetener),
    };
    product.scoringFacts = facts;
  }

  const request: AnalyzeRequest = {
    contractVersion: WIRE_CONTRACT_VERSION,
    product,
    resourceCompatibility: {
      taxonomyVersion: resources.taxonomyVersion,
      evidenceVersion: resources.evidenceVersion,
      methodEdition: resources.methodEdition,
      methodBundleSha256: resources.methodBundleSha256,
    },
  };
  const body = JSON.stringify(request);
  if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
    return invalid('The product facts are too large to send for analysis.');
  }
  // Validate a parsed copy: the validator may assign defaults.
  const validator = wireValidators.AnalyzeRequest;
  if (!validator(JSON.parse(body))) {
    return invalid(
      `The analysis request failed the contract: ${validationDetail(validator)}`,
    );
  }
  return { ok: true, body, request };
}

function toWireObservation(
  observation: NutrientObservation,
  mapIds: (ids: readonly string[]) => string[],
  nonEmpty: (ids: string[]) => [string, ...string[]] | null,
): ProductInputObservation | null {
  switch (observation.kind) {
    case 'missing':
      return {
        field: observation.field,
        kind: 'missing',
        reason: observation.reason,
        issues: [],
      };
    case 'estimated':
      // Model estimates are not label facts; the server never receives them.
      return null;
    case 'read':
    case 'uncertain':
    case 'corrected': {
      const sourceIds = nonEmpty(mapIds(observation.sourceIds));
      if (!sourceIds) {
        return null;
      }
      const common = {
        field: observation.field,
        sourceIds,
        unit: observation.unit,
        basis: observation.basis,
        ...(observation.derivation
          ? { derivation: [...observation.derivation] }
          : {}),
        value: observation.value,
      };
      if (observation.kind === 'read') {
        return { ...common, kind: 'read', issues: [] };
      }
      if (observation.kind === 'uncertain') {
        // The wire requires at least one issue saying why it is uncertain.
        const [first, ...rest] = observation.issues.flatMap(wireIssue);
        return first
          ? { ...common, kind: 'uncertain', issues: [first, ...rest] }
          : null;
      }
      const previous = nonEmpty(mapIds(observation.previousSourceIds));
      return previous
        ? {
            ...common,
            kind: 'corrected',
            issues: [],
            previousSourceIds: previous,
          }
        : null;
    }
  }
}

/** Wire issues have no personal or storage stage; those stay on the phone. */
function wireIssue(issue: Issue): WireIssue[] {
  if (issue.stage === 'personal' || issue.stage === 'storage') {
    return [];
  }
  return [
    {
      code: issue.code,
      stage: issue.stage,
      ...(issue.field !== undefined ? { field: issue.field } : {}),
      message: issue.message,
      action: issue.action,
    },
  ];
}
