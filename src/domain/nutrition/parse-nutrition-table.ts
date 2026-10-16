import type {
  Issue,
  ProductInputObservation,
} from '../contracts/generated/wire';
import {
  parseAmountCell,
  type Bound,
  type ParsedCell,
  type QuantityToken,
} from './amount';
import {
  addScale,
  decimalToNumber,
  decimalsEqual,
  formatDecimal,
  multiplyRational,
  type Decimal,
} from './decimal';
import {
  buildTableModel,
  fragmentFromInput,
  type PlacedFragment,
} from './geometry';
import type { NutritionTextFragment } from './ocr-input';
import {
  KCAL_TO_KJ_NOTE,
  KCAL_TO_KJ_URL,
  SALT_FORMULA_NOTE,
  SALT_FORMULA_URL,
  classifyLabel,
  servingDerivation,
  type AmountUnit,
  type Basis,
  type NutrientField,
  type ServingSize,
} from './vocabulary';

const SOURCE_ID = /^src-[0-9]{1,3}$/;

const MISSING_RANK = {
  conflicting_sources: 6,
  ambiguous: 5,
  unsupported_basis: 4,
  unreadable: 3,
  not_declared: 2,
  not_available: 1,
} as const;

type MissingReason = keyof typeof MISSING_RANK;

export class NutritionParseError extends Error {
  override readonly name = 'NutritionParseError';
}

export interface NutritionParseOptions {
  /**
   * One id per fragment, in the same order. Each id must match `src-` plus
   * one to three digits. When omitted, fragments are `src-0`, `src-1`, …
   * in input order, which is not the left-to-right reading order.
   */
  sourceIds?: readonly string[];
}

export interface NutritionParseResult {
  observations: ProductInputObservation[];
  issues: Issue[];
  /** Rows recognised as nutrients that are not stored, so they are not folded into another field. */
  ignoredLabels: string[];
  unrecognisedLabels: string[];
}

interface ValueDraft {
  type: 'value';
  field: NutrientField;
  basis: Basis;
  sourceIds: string[];
  decimal: Decimal;
  unit: 'g' | 'kJ' | 'percent';
  observationKind: 'read' | 'uncertain';
  issues: Issue[];
  derivation: string[];
}

interface BlankDraft {
  type: 'blank';
  field: NutrientField;
  reason: MissingReason;
  issues: Issue[];
}

type Draft = ValueDraft | BlankDraft;

/**
 * Read a nutrition table into contract observations.
 *
 * A row that is not on the label is omitted. Omission is not zero. A printed
 * `0` is zero. `Nil` is a declared zero. A dash is not a quantity. `<`, `≤`,
 * trace, and "not detected" are `uncertain`: the number is the printed bound
 * (or 0 when the label gives no bound), not a measurement equal to that number.
 *
 * Per-serving amounts stay on `per_serving`, including when the header states
 * the serving size. Grams and millilitres are taken from the header. No market
 * and no density is consulted.
 */
export function parseNutritionTable(
  fragments: readonly NutritionTextFragment[],
  options: NutritionParseOptions = {},
): NutritionParseResult {
  const ids = sourceIdsFor(fragments, options.sourceIds);
  const issues: Issue[] = [];
  const placed: PlacedFragment[] = [];
  fragments.forEach((fragment, index) => {
    const id = ids[index];
    if (id === undefined || fragment.text.trim().length === 0) {
      return;
    }
    const valid = fragmentFromInput(fragment, id);
    if (valid === null) {
      issues.push(
        extractionIssue(
          'invalid_box',
          'A text fragment has a box that cannot be placed, so it was skipped.',
          undefined,
          'retake',
        ),
      );
      return;
    }
    placed.push(valid);
  });

  const model = buildTableModel(placed);
  for (const warning of model.warnings) {
    issues.push(
      extractionIssue(warning.code, warning.message, undefined, 'edit'),
    );
  }

  const drafts: Draft[] = [];
  const ignoredLabels: string[] = [];
  const unrecognisedLabels: string[] = [];
  let saltLabelSeen = false;

  for (const row of model.rows) {
    const classified = classifyLabel(row.label);
    if (classified.kind === 'unknown') {
      if (row.label.length > 0) {
        unrecognisedLabels.push(row.label);
        issues.push(
          extractionIssue(
            'unrecognised_row',
            `No nutrient field was assigned to “${row.label}”. It was not copied into another row.`,
            clipField(row.label),
            'edit',
          ),
        );
      }
      continue;
    }
    if (classified.kind === 'ignore') {
      ignoredLabels.push(classified.label);
      continue;
    }
    if (classified.field === 'salt') {
      saltLabelSeen = true;
    }
    if (row.amounts.some((amount) => amount.column === 'ambiguous')) {
      drafts.push({
        type: 'blank',
        field: classified.field,
        reason: 'ambiguous',
        issues: [
          extractionIssue(
            'column_ambiguous',
            'An amount sits between columns, so it was not assigned to a header.',
            classified.field,
            'edit',
          ),
        ],
      });
      continue;
    }

    const byColumn = new Map<number, PlacedFragment[]>();
    for (const amount of row.amounts) {
      if (amount.column === 'ambiguous') {
        continue;
      }
      const column = model.columns[amount.column];
      if (column === undefined || column.reference) {
        continue;
      }
      const list = byColumn.get(amount.column) ?? [];
      list.push(amount.fragment);
      byColumn.set(amount.column, list);
    }

    const indexes = new Set<number>([
      ...byColumn.keys(),
      ...model.columns.flatMap((column, index) =>
        column.reference ? [] : [index],
      ),
    ]);
    if (indexes.size === 0) {
      drafts.push({
        type: 'blank',
        field: classified.field,
        reason: 'not_declared',
        issues: [
          extractionIssue(
            'basis_blank',
            `${classified.field} has a row and no amount. The blank was not read as zero.`,
            classified.field,
            'add_field',
          ),
        ],
      });
      continue;
    }

    for (const index of indexes) {
      const column = model.columns[index];
      const fragmentsInColumn = byColumn.get(index) ?? [];
      if (column === undefined) {
        continue;
      }
      drafts.push(
        outcomeForColumn(
          classified.field,
          classified.declaredUnit,
          column.basis,
          column.serving,
          row.labelIds,
          fragmentsInColumn,
        ),
      );
    }
  }

  const collapsed = [...collapseByBasis(drafts).values()];
  if (!saltLabelSeen) {
    for (const draft of collapsed) {
      if (draft.type === 'value' && draft.field === 'sodium') {
        collapsed.push(deriveSalt(draft));
      }
    }
  }

  const observations: ProductInputObservation[] = [];
  for (const group of groupByField(collapsed).values()) {
    const values = group.filter(
      (draft): draft is ValueDraft => draft.type === 'value',
    );
    const blanks = group.filter(
      (draft): draft is BlankDraft => draft.type === 'blank',
    );
    if (values.length > 0) {
      for (const value of values) {
        observations.push(toObservation(value));
      }
      for (const blank of blanks) {
        issues.push(...blank.issues);
      }
      continue;
    }
    const blank = worstBlank(blanks);
    if (blank !== undefined) {
      observations.push({
        field: blank.field,
        kind: 'missing',
        reason: blank.reason,
        issues: blank.issues,
      });
    }
  }

  return { observations, issues, ignoredLabels, unrecognisedLabels };
}

function sourceIdsFor(
  fragments: readonly NutritionTextFragment[],
  provided: readonly string[] | undefined,
): readonly string[] {
  if (fragments.length > 1000) {
    throw new NutritionParseError(
      'A nutrition table cannot use more than 1000 source ids (src-0 through src-999).',
    );
  }
  if (provided === undefined) {
    return fragments.map((_, index) => `src-${index}`);
  }
  if (provided.length !== fragments.length) {
    throw new NutritionParseError(
      'sourceIds must have one id for every text fragment.',
    );
  }
  const seen = new Set<string>();
  for (const id of provided) {
    if (!SOURCE_ID.test(id) || seen.has(id)) {
      throw new NutritionParseError(
        `Source id “${id}” must be a unique src-N label.`,
      );
    }
    seen.add(id);
  }
  return provided;
}

function outcomeForColumn(
  field: NutrientField,
  declaredUnit: AmountUnit | null,
  basis: Basis | null,
  serving: ServingSize | null,
  labelIds: readonly string[],
  fragments: readonly PlacedFragment[],
): Draft {
  if (basis === null) {
    const printed = fragments
      .map((fragment) => fragment.text.trim())
      .filter((text) => text.length > 0);
    const suffix =
      printed.length === 0
        ? ''
        : ` Read “${printed.join(' / ')}” and did not assign it.`;
    return {
      type: 'blank',
      field,
      reason: 'unsupported_basis',
      issues: [
        extractionIssue(
          'basis_not_stated',
          `The header does not say whether the amount is per 100 g or per 100 ml, so no basis was guessed.${suffix}`,
          field,
          'edit',
        ),
      ],
    };
  }
  if (fragments.length === 0) {
    return {
      type: 'blank',
      field,
      reason: 'not_declared',
      issues: [
        extractionIssue(
          'basis_blank',
          `No amount was placed in the ${basis} column for ${field}. The blank was not read as zero.`,
          field,
          'add_field',
        ),
      ],
    };
  }
  const parsed = parseAmountCell(
    fragments.map((fragment) => fragment.text).join(' / '),
  );
  const sourceIds = [...labelIds, ...fragments.map((fragment) => fragment.id)];
  return parsedToDraft(field, declaredUnit, basis, serving, sourceIds, parsed);
}

function parsedToDraft(
  field: NutrientField,
  declaredUnit: AmountUnit | null,
  basis: Basis,
  serving: ServingSize | null,
  sourceIds: readonly string[],
  parsed: ParsedCell,
): Draft {
  if (
    parsed.status === 'dash' ||
    parsed.status === 'not_applicable' ||
    parsed.status === 'empty'
  ) {
    const code =
      parsed.status === 'not_applicable' ? 'not_applicable' : 'dash_not_zero';
    const message =
      parsed.status === 'not_applicable'
        ? 'The cell says not applicable. That is not a measured zero.'
        : 'The cell is a dash. A dash is not a measured zero.';
    return {
      type: 'blank',
      field,
      reason: 'not_declared',
      issues: [extractionIssue(code, message, field, 'edit')],
    };
  }
  if (parsed.status === 'ambiguous') {
    return {
      type: 'blank',
      field,
      reason: 'ambiguous',
      issues: [extractionIssue(parsed.code, parsed.message, field, 'edit')],
    };
  }
  if (parsed.status === 'unreadable') {
    return {
      type: 'blank',
      field,
      reason: 'unreadable',
      issues: [
        extractionIssue('unreadable_amount', parsed.message, field, 'edit'),
      ],
    };
  }
  if (parsed.status === 'nil') {
    return valueDraft(
      field,
      basis,
      sourceIds,
      zeroDecimal(),
      unitFor(field),
      'read',
      [
        extractionIssue(
          'nil_marker',
          'The label says Nil. Recorded as a declared zero. A missing row is not recorded as zero.',
          field,
          'edit',
        ),
      ],
      servingLines(basis, serving),
    );
  }
  if (parsed.status === 'trace' || parsed.status === 'not_detected') {
    const trace = parsed.status === 'trace';
    return valueDraft(
      field,
      basis,
      sourceIds,
      zeroDecimal(),
      unitFor(field),
      'uncertain',
      [
        extractionIssue(
          trace ? 'trace_amount' : 'not_detected',
          trace
            ? 'The label says trace. That is not a measured number and not a declared zero.'
            : 'The label says not detected. That is below a reporting limit, not a measured zero.',
          field,
          'edit',
        ),
      ],
      [
        'No numeric bound was printed. The contract requires a number, so 0 is a placeholder and not a declared zero.',
        ...servingLines(basis, serving),
      ],
    );
  }

  const resolved = resolveQuantities(field, declaredUnit, parsed.quantities);
  if (resolved.ok === false) {
    return {
      type: 'blank',
      field,
      reason: resolved.reason,
      issues: [extractionIssue(resolved.code, resolved.message, field, 'edit')],
    };
  }
  const issues = [...resolved.issues];
  if (
    greaterThanHundred(resolved.decimal) &&
    resolved.unit === 'g' &&
    basis !== 'per_serving'
  ) {
    issues.push(
      extractionIssue(
        'mass_over_base',
        `Declared ${formatDecimal(resolved.decimal)} g on ${basis} is above 100 g. The value was kept.`,
        field,
        'edit',
      ),
    );
  }
  return valueDraft(
    field,
    basis,
    sourceIds,
    resolved.decimal,
    resolved.unit,
    resolved.observationKind,
    issues,
    [...resolved.derivation, ...servingLines(basis, serving)],
  );
}

interface ResolvedQuantity {
  ok: true;
  decimal: Decimal;
  unit: 'g' | 'kJ' | 'percent';
  observationKind: 'read' | 'uncertain';
  issues: Issue[];
  derivation: string[];
}

function resolveQuantities(
  field: NutrientField,
  declaredUnit: AmountUnit | null,
  quantities: readonly QuantityToken[],
):
  | ResolvedQuantity
  | { ok: false; reason: MissingReason; code: string; message: string } {
  const filled = quantities.map((quantity) =>
    applyDeclaredUnit(quantity, declaredUnit),
  );
  const unitIssues = filled.flatMap((entry) => entry.issues);
  const prepared = filled.map((entry) => entry.quantity);
  if (prepared.some((quantity) => quantity.unit === null)) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'unit_not_stated',
      message: 'The amount has no unit, and the row name does not state one.',
    };
  }
  if (new Set(prepared.map((quantity) => quantity.bound)).size > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'ambiguous_number',
      message: 'The cell states more than one bound.',
    };
  }
  if (field === 'energy') {
    return resolveEnergy(prepared, unitIssues);
  }
  if (field === 'fvl') {
    return resolvePercent(prepared, unitIssues);
  }
  return resolveMass(field, prepared, unitIssues);
}

function resolveEnergy(
  quantities: readonly QuantityToken[],
  unitIssues: readonly Issue[],
):
  | ResolvedQuantity
  | { ok: false; reason: MissingReason; code: string; message: string } {
  const kilojoules = quantities.filter((quantity) => quantity.unit === 'kJ');
  const kilocalories = quantities.filter(
    (quantity) => quantity.unit === 'kcal',
  );
  const others = quantities.filter(
    (quantity) => quantity.unit !== 'kJ' && quantity.unit !== 'kcal',
  );
  if (others.length > 0 || kilojoules.length > 1 || kilocalories.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: others.some((quantity) => quantity.unit === 'percent')
        ? 'percent_is_not_mass'
        : 'ambiguous_number',
      message:
        'The energy cell does not state one kilojoule amount or one kilocalorie amount.',
    };
  }
  const printedKj = kilojoules[0];
  const printedKcal = kilocalories[0];
  if (printedKj !== undefined) {
    const derived =
      printedKcal === undefined
        ? null
        : multiplyRational(printedKcal.decimal, 4184n, 1000n);
    const issues = [...unitIssues, ...quantityIssues('energy', printedKj)];
    if (printedKcal !== undefined) {
      issues.push(...quantityIssues('energy', printedKcal));
    }
    if (derived !== null && energyDisagrees(printedKj.decimal, derived)) {
      issues.push(
        extractionIssue(
          'energy_figures_disagree',
          `Printed ${formatDecimal(printedKj.decimal)} kJ does not match ${formatDecimal(printedKcal?.decimal ?? printedKj.decimal)} kcal × 4.184. The printed kilojoule figure was kept.`,
          'energy',
          'edit',
        ),
      );
    }
    const derivation =
      printedKcal === undefined
        ? []
        : [
            `Label also states ${formatDecimal(printedKcal.decimal)} kcal. The kilojoule figure is the one printed on the label.`,
          ];
    return {
      ok: true,
      decimal: printedKj.decimal,
      unit: 'kJ',
      observationKind: observationKind(printedKj, printedKcal),
      issues: uniqueIssues(issues),
      derivation,
    };
  }
  if (printedKcal === undefined) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'unit_not_stated',
      message: 'Energy has no kilojoule or kilocalorie unit.',
    };
  }
  const converted = multiplyRational(printedKcal.decimal, 4184n, 1000n);
  return {
    ok: true,
    decimal: converted,
    unit: 'kJ',
    observationKind: observationKind(printedKcal),
    issues: uniqueIssues([
      ...unitIssues,
      ...quantityIssues('energy', printedKcal),
    ]),
    derivation: [
      `Read ${formatDecimal(printedKcal.decimal)} kcal × 4.184 = ${formatDecimal(converted)} kJ.`,
      KCAL_TO_KJ_NOTE,
      KCAL_TO_KJ_URL,
    ],
  };
}

function resolveMass(
  field: NutrientField,
  quantities: readonly QuantityToken[],
  unitIssues: readonly Issue[],
):
  | ResolvedQuantity
  | { ok: false; reason: MissingReason; code: string; message: string } {
  if (quantities.some((quantity) => quantity.unit === 'percent')) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'percent_is_not_mass',
      message: 'A percent in a nutrient column was not read as grams.',
    };
  }
  if (quantities.length !== 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'ambiguous_number',
      message: 'The cell has more than one mass amount.',
    };
  }
  const quantity = quantities[0];
  if (
    quantity === undefined ||
    (quantity.unit !== 'g' && quantity.unit !== 'mg' && quantity.unit !== 'mcg')
  ) {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'unit_not_stated',
      message: 'The amount is not a mass in g, mg, or micrograms.',
    };
  }
  const converted = toGrams(quantity);
  return {
    ok: true,
    decimal: converted.decimal,
    unit: 'g',
    observationKind: observationKind(quantity),
    issues: uniqueIssues([...unitIssues, ...quantityIssues(field, quantity)]),
    derivation: converted.note === null ? [] : [converted.note],
  };
}

function resolvePercent(
  quantities: readonly QuantityToken[],
  unitIssues: readonly Issue[],
):
  | ResolvedQuantity
  | { ok: false; reason: MissingReason; code: string; message: string } {
  if (quantities.length !== 1 || quantities[0]?.unit !== 'percent') {
    return {
      ok: false,
      reason: 'ambiguous',
      code: 'unit_not_stated',
      message: 'Fruit, vegetable, and legume content needs a percent.',
    };
  }
  const quantity = quantities[0];
  return {
    ok: true,
    decimal: quantity.decimal,
    unit: 'percent',
    observationKind: observationKind(quantity),
    issues: uniqueIssues([...unitIssues, ...quantityIssues('fvl', quantity)]),
    derivation: [],
  };
}

function applyDeclaredUnit(
  quantity: QuantityToken,
  declaredUnit: AmountUnit | null,
): { quantity: QuantityToken; issues: Issue[] } {
  if (quantity.unit === null) {
    return declaredUnit === null
      ? { quantity, issues: [] }
      : { quantity: { ...quantity, unit: declaredUnit }, issues: [] };
  }
  if (declaredUnit !== null && declaredUnit !== quantity.unit) {
    return {
      quantity,
      issues: [
        extractionIssue(
          'label_unit_ignored',
          `The row name says ${declaredUnit}, and the cell says ${quantity.unit}. The cell unit was kept.`,
          undefined,
          'edit',
        ),
      ],
    };
  }
  return { quantity, issues: [] };
}

function toGrams(quantity: QuantityToken): {
  decimal: Decimal;
  note: string | null;
} {
  if (quantity.unit === 'mg') {
    const grams = addScale(quantity.decimal, 3);
    return {
      decimal: grams,
      note: `Read ${formatDecimal(quantity.decimal)} mg and divided by 1000 to record ${formatDecimal(grams)} g.`,
    };
  }
  if (quantity.unit === 'mcg') {
    const grams = addScale(quantity.decimal, 6);
    return {
      decimal: grams,
      note: `Read ${formatDecimal(quantity.decimal)} micrograms and divided by 1000000 to record ${formatDecimal(grams)} g.`,
    };
  }
  return { decimal: quantity.decimal, note: null };
}

function quantityIssues(
  field: NutrientField,
  quantity: QuantityToken,
): Issue[] {
  const issues: Issue[] = [];
  const bound = boundIssue(field, quantity);
  if (bound !== null) {
    issues.push(bound);
  }
  if (quantity.approximate) {
    issues.push(
      extractionIssue(
        'approximate_value',
        'The label marks the amount as approximate. It was not read as an exact quantity.',
        field,
        'edit',
      ),
    );
  }
  if (quantity.repairs.length > 0) {
    issues.push(
      extractionIssue(
        'ocr_glyph',
        `A glyph was read as a digit (${quantity.repairs.join('; ')}).`,
        field,
        'edit',
      ),
    );
  }
  return issues;
}

function boundIssue(
  field: NutrientField,
  quantity: QuantityToken,
): Issue | null {
  if (quantity.bound === 'none') {
    return null;
  }
  const phrase = boundPhrase(quantity.bound);
  const unit = quantity.unit ?? 'units';
  return extractionIssue(
    boundCode(quantity.bound),
    `The label states an amount ${phrase} ${formatDecimal(quantity.decimal)} ${unit}. That is not a measurement equal to ${formatDecimal(quantity.decimal)}.`,
    field,
    'edit',
  );
}

function boundPhrase(bound: Exclude<Bound, 'none'>): string {
  if (bound === 'lt') {
    return 'less than';
  }
  if (bound === 'lte') {
    return 'less than or equal to';
  }
  if (bound === 'gt') {
    return 'greater than';
  }
  return 'greater than or equal to';
}

function boundCode(bound: Exclude<Bound, 'none'>): string {
  if (bound === 'lt') {
    return 'upper_bound';
  }
  if (bound === 'lte') {
    return 'upper_bound_inclusive';
  }
  if (bound === 'gt') {
    return 'lower_bound';
  }
  return 'lower_bound_inclusive';
}

function observationKind(
  ...quantities: (QuantityToken | undefined)[]
): 'read' | 'uncertain' {
  const present = quantities.filter(
    (quantity): quantity is QuantityToken => quantity !== undefined,
  );
  const uncertain = present.some(
    (quantity) => quantity.bound !== 'none' || quantity.approximate,
  );
  return uncertain ? 'uncertain' : 'read';
}

function energyDisagrees(stated: Decimal, derived: Decimal): boolean {
  const left = decimalToNumber(stated);
  const right = decimalToNumber(derived);
  const delta = Math.abs(left - right);
  if (!(delta > 5)) {
    return false;
  }
  if (left === 0) {
    return right > 0;
  }
  return delta / left > 0.02;
}

function deriveSalt(sodium: ValueDraft): ValueDraft {
  const salt = multiplyRational(sodium.decimal, 5n, 2n);
  return {
    ...sodium,
    field: 'salt',
    decimal: salt,
    unit: 'g',
    issues: sodium.issues.map((item) => ({ ...item, field: 'salt' })),
    derivation: uniqueLines([
      sodium.observationKind === 'uncertain'
        ? 'The sodium amount is uncertain, so this salt figure is uncertain as well.'
        : '',
      `Sodium was recorded as ${formatDecimal(sodium.decimal)} g. salt = ${formatDecimal(sodium.decimal)} g × 2.5 = ${formatDecimal(salt)} g.`,
      SALT_FORMULA_NOTE,
      SALT_FORMULA_URL,
      ...sodium.derivation,
    ]),
  };
}

function collapseByBasis(drafts: readonly Draft[]): Map<string, Draft> {
  const groups = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const basis = draft.type === 'value' ? draft.basis : draft.reason;
    const key = `${draft.field}|${draft.type}|${basis}`;
    const list = groups.get(key) ?? [];
    list.push(draft);
    groups.set(key, list);
  }
  const collapsed = new Map<string, Draft>();
  for (const [key, group] of groups) {
    const values = group.filter(
      (draft): draft is ValueDraft => draft.type === 'value',
    );
    const blanks = group.filter(
      (draft): draft is BlankDraft => draft.type === 'blank',
    );
    if (values.length > 0) {
      collapsed.set(key, mergeValues(values));
      continue;
    }
    const blank = worstBlank(blanks);
    if (blank !== undefined) {
      collapsed.set(key, blank);
    }
  }
  return collapsed;
}

function mergeValues(drafts: readonly ValueDraft[]): Draft {
  const first = drafts[0];
  if (first === undefined) {
    throw new NutritionParseError('Cannot merge an empty value group.');
  }
  const conflict = drafts.some(
    (draft) =>
      draft.observationKind !== first.observationKind ||
      draft.unit !== first.unit ||
      !decimalsEqual(draft.decimal, first.decimal),
  );
  if (conflict) {
    return {
      type: 'blank',
      field: first.field,
      reason: 'conflicting_sources',
      issues: [
        extractionIssue(
          'conflicting_values',
          `More than one ${first.field} value was placed on ${first.basis}: ${drafts.map((draft) => formatDecimal(draft.decimal)).join(', ')}.`,
          first.field,
          'choose_candidate',
        ),
      ],
    };
  }
  return {
    ...first,
    sourceIds: drafts.flatMap((draft) => draft.sourceIds),
    issues: uniqueIssues(drafts.flatMap((draft) => draft.issues)),
    derivation: uniqueLines(drafts.flatMap((draft) => draft.derivation)),
  };
}

function groupByField(drafts: readonly Draft[]): Map<string, Draft[]> {
  const groups = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const list = groups.get(draft.field) ?? [];
    list.push(draft);
    groups.set(draft.field, list);
  }
  return groups;
}

function worstBlank(drafts: readonly BlankDraft[]): BlankDraft | undefined {
  const ranked = [...drafts].sort(
    (left, right) => MISSING_RANK[right.reason] - MISSING_RANK[left.reason],
  );
  const first = ranked[0];
  if (first === undefined) {
    return undefined;
  }
  return {
    ...first,
    issues: uniqueIssues(ranked.flatMap((draft) => draft.issues)),
  };
}

function toObservation(draft: ValueDraft): ProductInputObservation {
  const sourceIds = sourceTuple(draft.sourceIds);
  const derivation = draft.derivation.length > 0 ? draft.derivation : undefined;
  if (draft.observationKind === 'uncertain') {
    const fallback = extractionIssue(
      'uncertain_amount',
      'The amount is uncertain.',
      draft.field,
      'edit',
    );
    const issues = draft.issues.length > 0 ? draft.issues : [fallback];
    const head = issues[0] ?? fallback;
    return {
      field: draft.field,
      kind: 'uncertain',
      value: decimalToNumber(draft.decimal),
      unit: draft.unit,
      basis: draft.basis,
      sourceIds,
      issues: [head, ...issues.slice(1)],
      ...(derivation === undefined ? {} : { derivation }),
    };
  }
  return {
    field: draft.field,
    kind: 'read',
    value: decimalToNumber(draft.decimal),
    unit: draft.unit,
    basis: draft.basis,
    sourceIds,
    issues: draft.issues,
    ...(derivation === undefined ? {} : { derivation }),
  };
}

function valueDraft(
  field: NutrientField,
  basis: Basis,
  sourceIds: readonly string[],
  decimal: Decimal,
  unit: 'g' | 'kJ' | 'percent',
  observationKind: 'read' | 'uncertain',
  issues: readonly Issue[],
  derivation: readonly string[],
): ValueDraft {
  return {
    type: 'value',
    field,
    basis,
    sourceIds: [...sourceIds],
    decimal,
    unit,
    observationKind,
    issues: [...issues],
    derivation: uniqueLines(derivation),
  };
}

function servingLines(basis: Basis, serving: ServingSize | null): string[] {
  if (basis !== 'per_serving' || serving === null) {
    return [];
  }
  return [servingDerivation(serving)];
}

function unitFor(field: NutrientField): 'g' | 'kJ' | 'percent' {
  if (field === 'energy') {
    return 'kJ';
  }
  if (field === 'fvl') {
    return 'percent';
  }
  return 'g';
}

function zeroDecimal(): Decimal {
  return { significand: 0n, scale: 0 };
}

function greaterThanHundred(value: Decimal): boolean {
  return value.significand > 100n * 10n ** BigInt(value.scale);
}

function sourceTuple(ids: readonly string[]): [string, ...string[]] {
  const unique = [...new Set(ids)].sort(
    (left, right) => Number(left.slice(4)) - Number(right.slice(4)),
  );
  const first = unique[0];
  if (first === undefined) {
    throw new NutritionParseError('An observation has no source fragment.');
  }
  for (const line of unique) {
    if (!SOURCE_ID.test(line)) {
      throw new NutritionParseError(
        `Source id “${line}” does not match src-N.`,
      );
    }
  }
  return [first, ...unique.slice(1)];
}

function uniqueLines(lines: readonly string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    if (line.length === 0 || kept.includes(line)) {
      continue;
    }
    if (line.length > 500) {
      throw new NutritionParseError(
        'A derivation line exceeds 500 characters.',
      );
    }
    kept.push(line);
  }
  return kept.slice(0, 12);
}

function uniqueIssues(issues: readonly Issue[]): Issue[] {
  const kept: Issue[] = [];
  for (const item of issues) {
    if (
      !kept.some(
        (other) => other.code === item.code && other.message === item.message,
      )
    ) {
      kept.push(item);
    }
  }
  return kept;
}

function extractionIssue(
  code: string,
  message: string,
  field: string | undefined,
  action: Issue['action'],
): Issue {
  return {
    code,
    stage: 'extraction',
    message,
    action,
    ...(field === undefined ? {} : { field: clipField(field) }),
  };
}

function clipField(field: string): string {
  return field.length <= 160 ? field : field.slice(0, 160);
}
