import templatesJson from '../../../resources/evidence/reason-templates.json';
import methodJson from '../../../resources/method/nutriscore-updated-2023.json';
import type {
  Citation,
  Issue,
  ScientificAssessment,
  ScientificReason,
  TraceStep,
} from '../contracts/generated/local';
import type {
  GradedResult,
  NutriScoreResult,
  TraceStep as CalculationTrace,
} from '../scientific';

export const EVIDENCE_VERSION = templatesJson.evidenceEdition;
export const EVIDENCE_CITATIONS: readonly Citation[] = methodJson.citations;
const templates = new Map(
  templatesJson.templates.map((template) => [template.templateId, template]),
);

export interface EvidenceResult {
  readonly scientific: ScientificAssessment;
  readonly citations: readonly Citation[];
  readonly issues: readonly Issue[];
}

/** Serializes actual calculation evidence using only the installed reviewed text. */
export function renderScientificAssessment(
  result: NutriScoreResult,
  snapshotId: string,
): EvidenceResult {
  if (result.state !== 'graded') {
    return {
      scientific: {
        state: result.state,
        inputSnapshotId: snapshotId,
        reasons: [],
        issues: [result.issues[0], ...result.issues.slice(1)],
      },
      citations: EVIDENCE_CITATIONS,
      issues: [],
    };
  }
  const reasons: ScientificReason[] = [];
  const issues: Issue[] = [];
  const trace: TraceStep[] = [];
  for (const step of result.trace) {
    const [citation, ...rest] = applicableCitations(
      step.citationIds,
      result.route,
    );
    if (!citation || !step.ruleLocator) {
      issues.push(evidenceIssue('evidence_trace_unsupported', step.component));
      continue;
    }
    trace.push({
      component: step.component,
      inputFields: [...step.inputFields],
      points: step.points,
      ruleLocator: step.ruleLocator,
      citationIds: [citation, ...rest],
    });
    const templateId = templateFor(step);
    if (templateId === null) continue;
    const rendered = renderStep(templateId, step, result);
    if (rendered) reasons.push(rendered);
    else
      issues.push(evidenceIssue('evidence_template_unsupported', templateId));
  }
  const [firstReason, ...restReasons] = reasons;
  const [firstTrace, ...restTrace] = trace;
  const firstIssue = issues[0];
  if (firstIssue || !firstReason || !firstTrace) {
    const issue =
      firstIssue ?? evidenceIssue('evidence_unavailable', 'scientific');
    return {
      scientific: {
        state: 'method_unavailable',
        inputSnapshotId: snapshotId,
        reasons: [],
        issues: [issue, ...issues.slice(1)],
      },
      citations: EVIDENCE_CITATIONS,
      issues: [issue, ...issues.slice(1)],
    };
  }
  return {
    scientific: {
      state: 'graded',
      grade: result.grade,
      score: result.score,
      route: result.route,
      method: {
        ...result.method,
        label: 'Nutrition grade · European reference',
      },
      inputSnapshotId: snapshotId,
      reasons: [firstReason, ...restReasons],
      trace: [firstTrace, ...restTrace],
      issues: [],
    },
    citations: EVIDENCE_CITATIONS,
    issues: [],
  };
}

function templateFor(step: CalculationTrace): string | null {
  if (step.component === 'water_classification')
    return 'nutriscore.water_classification';
  if (step.component === 'sweeteners')
    return step.points > 0 ? 'nutriscore.sweetener' : null;
  if (['points_a', 'points_c', 'final_score'].includes(step.component))
    return null;
  if (step.component === 'protein' && step.counted === false)
    return 'nutriscore.protein_not_counted';
  if (step.component === 'protein' && step.redMeatCap === 'applied')
    return 'nutriscore.protein_red_meat';
  return `nutriscore.${step.component}`;
}

function applicableCitations(
  ids: readonly string[],
  route: GradedResult['route'],
): string[] {
  const report = route === 'beverage' ? 'sc-beverage-2023' : 'sc-food-2022';
  return ids.filter(
    (id) =>
      (id === report || id === 'fps-public-health-tool-2025') &&
      EVIDENCE_CITATIONS.some((citation) => citation.id === id),
  );
}

function renderStep(
  templateId: string,
  step: CalculationTrace,
  result: GradedResult,
): ScientificReason | null {
  const template = templates.get(templateId);
  const [citation, ...rest] = applicableCitations(
    step.citationIds,
    result.route,
  );
  if (!template || !citation || !template.citationIds.includes(citation))
    return null;
  // The fats energy trace is deliberately mapped to a dedicated reviewed template.
  if (
    template.component !== step.component &&
    !(step.component === 'protein' && template.component === 'protein')
  )
    return null;
  const params: Readonly<Record<string, string>> = {
    value: step.evaluation?.value ?? '',
    unit: step.evaluation?.unit ?? '',
    points: String(step.points),
  };
  let missing = false;
  const text = template.format.replace(
    /\{([^}]+)\}/g,
    (_match: string, key: string) => {
      const value = params[key];
      if (value === undefined || value === '') {
        missing = true;
        return '';
      }
      return value;
    },
  );
  if (missing) return null;
  return {
    id: `reason-${step.component}`,
    templateId,
    text,
    citationIds: [citation, ...rest],
    inputFields: [...step.inputFields],
    step: `${step.component}-points`,
  };
}

function evidenceIssue(code: string, field: string): Issue {
  return {
    code,
    stage: 'method',
    field,
    message:
      'A reviewed reason template and applicable calculation evidence are unavailable.',
    action: 'read_source',
  };
}

/** Never pass through the server sentence, even when its template is familiar. */
export function renderBackendReasons(
  server: readonly ScientificReason[],
  replay: EvidenceResult,
): { reasons: ScientificReason[]; issues: Issue[] } {
  const reasons: ScientificReason[] = [];
  const issues: Issue[] = [];
  for (const reason of server) {
    if (!templates.has(reason.templateId)) {
      issues.push(evidenceIssue('unknown_reason_template', reason.templateId));
      continue;
    }
    const local = replay.scientific.reasons.find(
      (item) =>
        item.templateId === reason.templateId && item.step === reason.step,
    );
    if (
      !local ||
      !sameReferences(local.citationIds, reason.citationIds) ||
      !sameReferences(local.inputFields, reason.inputFields)
    ) {
      issues.push(evidenceIssue('reason_evidence_mismatch', reason.templateId));
      continue;
    }
    reasons.push({
      ...local,
      citationIds: [local.citationIds[0], ...local.citationIds.slice(1)],
      inputFields: [...local.inputFields],
    });
  }
  return { reasons, issues };
}

function sameReferences(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((reference) => actual.includes(reference))
  );
}
