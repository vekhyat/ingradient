/**
 * Adversarial-refusal cases for the envelope check (envelope.mjs).
 *
 * Every product value here is synthetic. No health or personal data.
 *
 * A request case has a phone snapshot and a wire equivalent:
 *   snapshot   what the phone holds; the phone builds from it and replays it
 *   wire(r)    mutates a clone of the base phone request into the body the
 *              backend gets when the phone refuses to build (or always, with
 *              `rawOnly`). A string value NAN / INF / HUGE becomes a bare
 *              NaN / Infinity / 1e999 token, which JSON.stringify cannot write.
 *   expect     the documented backend outcome: an HTTP status for a problem,
 *              or the scientific state of a 200 answer.
 *
 * A tamper case changes a stored 200 answer before the phone sees it. It never
 * goes to a backend.
 */

export const TOKEN = {
  NAN: 'NaN',
  INF: 'Infinity',
  HUGE: '1e999',
};

/** Replaces the quoted sentinels with bare tokens a phone cannot produce. */
export function rawTokens(text) {
  return text.replace(/"__TOKEN_(NAN|INF|HUGE)__"/g, (_m, k) => TOKEN[k]);
}

const SCRIPT = '<script>alert("parity")</script>';
const SQL = "sugar'); DROP TABLE products; --";
const EMOJI = '\u{1F96B}'; // canned food, one code point, four UTF-8 bytes
const ZALGO = 'sú̂̃gar ‮etirw‬ salt oil';
export const MARKERS = [
  '<script',
  'DROP TABLE',
  '‮',
  'PARITY-TAMPER',
  '\uD800',
];

function setValue(observations, field, patch) {
  return observations.map((o) => (o.field === field ? { ...o, ...patch } : o));
}

/** The adversarial request cases. `base` is vector 0's inputs. */
export function adversarialCases({ snapshotFor, base, fats }) {
  const obs = base.observations;
  const fieldIndex = (r, field) =>
    r.product.observations.findIndex((o) => o.field === field);
  const sugars = (r, value) => {
    r.product.observations[fieldIndex(r, 'sugars')].value = value;
  };
  const snap = (id, patch = {}) => snapshotFor({ id, ...base, ...patch });
  const cases = [];
  const add = (name, measure, expect, snapshot, wire, extra = {}) =>
    cases.push({ name, measure, expect, snapshot, wire, ...extra });

  // ----- nutrition values ---------------------------------------------------
  add(
    'adv-energy-above-3800kj',
    'nutrition',
    'insufficient_data',
    snap('adv-energy-above-3800kj', {
      observations: setValue(obs, 'energy', { value: 4000 }),
    }),
  );
  add(
    'adv-sugars-above-100g',
    'nutrition',
    'insufficient_data',
    snap('adv-sugars-above-100g', {
      observations: setValue(obs, 'sugars', { value: 150 }),
    }),
  );
  add(
    'adv-sugars-1e308',
    'nutrition',
    'insufficient_data',
    snap('adv-sugars-1e308', {
      observations: setValue(obs, 'sugars', { value: 1e308 }),
    }),
  );
  add(
    'adv-sugars-negative',
    'nutrition',
    400,
    snap('adv-sugars-negative', {
      observations: setValue(obs, 'sugars', { value: -1 }),
    }),
    (r) => sugars(r, -1),
  );
  add(
    'adv-sugars-nan',
    'nutrition',
    400,
    snap('adv-sugars-nan', {
      observations: setValue(obs, 'sugars', { value: Number.NaN }),
    }),
    (r) => sugars(r, '__TOKEN_NAN__'),
  );
  add(
    'adv-sugars-infinity',
    'nutrition',
    400,
    snap('adv-sugars-infinity', {
      observations: setValue(obs, 'sugars', {
        value: Number.POSITIVE_INFINITY,
      }),
    }),
    (r) => sugars(r, '__TOKEN_INF__'),
  );
  add(
    'adv-sugars-1e999',
    'nutrition',
    400,
    snap('adv-sugars-1e999', {
      observations: setValue(obs, 'sugars', {
        value: Number.POSITIVE_INFINITY,
      }),
    }),
    (r) => sugars(r, '__TOKEN_HUGE__'),
  );
  add(
    'adv-sugars-string',
    'nutrition',
    400,
    snap('adv-sugars-string', {
      observations: setValue(obs, 'sugars', { value: '5' }),
    }),
    (r) => sugars(r, '5'),
  );
  add(
    'adv-sugars-boolean',
    'nutrition',
    400,
    snap('adv-sugars-boolean', {
      observations: setValue(obs, 'sugars', { value: true }),
    }),
    (r) => sugars(r, true),
  );
  add(
    'adv-fats-fat-zero',
    'nutrition',
    'insufficient_data',
    snapshotFor({
      id: 'adv-fats-fat-zero',
      ...fats,
      observations: setValue(
        setValue(fats.observations, 'fat', { value: 0 }),
        'saturates',
        { value: 0 },
      ),
    }),
  );

  // ----- duplicated observations ----------------------------------------------
  const sugar = obs.find((o) => o.field === 'sugars');
  add(
    'adv-duplicate-observation-same',
    'duplicate',
    'insufficient_data',
    snap('adv-duplicate-observation-same', { observations: [...obs, sugar] }),
  );
  add(
    'adv-duplicate-observation-differ',
    'duplicate',
    'insufficient_data',
    snap('adv-duplicate-observation-differ', {
      observations: [...obs, { ...sugar, value: 9 }],
    }),
  );
  add(
    'adv-wire-duplicate-source-ref',
    'duplicate',
    400,
    snap('adv-wire-duplicate-source-ref'),
    (r) => {
      r.product.sourceRefs.push({ ...r.product.sourceRefs[0] });
    },
    { rawOnly: true },
  );
  add(
    'adv-wire-duplicate-json-key',
    'duplicate',
    400,
    snap('adv-wire-duplicate-json-key'),
    null,
    {
      rawOnly: true,
      text: (body) => body.replace('{', '{"contractVersion":"0.2.0-draft",'),
    },
  );

  // ----- units and bases ------------------------------------------------------
  add(
    'adv-unit-sugars-kj',
    'unit',
    'insufficient_data',
    snap('adv-unit-sugars-kj', {
      observations: setValue(obs, 'sugars', { unit: 'kJ' }),
    }),
  );
  add(
    'adv-unit-energy-g',
    'unit',
    'insufficient_data',
    snap('adv-unit-energy-g', {
      observations: setValue(obs, 'energy', { unit: 'g' }),
    }),
  );
  add(
    'adv-unit-unknown-mg',
    'unit',
    400,
    snap('adv-unit-unknown-mg', {
      observations: setValue(obs, 'salt', { unit: 'mg' }),
    }),
    (r) => {
      r.product.observations[fieldIndex(r, 'salt')].unit = 'mg';
    },
  );
  add(
    'adv-basis-per-serving',
    'unit',
    'insufficient_data',
    snap('adv-basis-per-serving', {
      observations: setValue(obs, 'salt', { basis: 'per_serving' }),
    }),
  );
  add(
    'adv-basis-per-100ml-general',
    'unit',
    'insufficient_data',
    snap('adv-basis-per-100ml-general', {
      observations: setValue(obs, 'fibre', { basis: 'per_100_ml' }),
    }),
  );

  // ----- unknown enum values --------------------------------------------------
  add(
    'adv-enum-category',
    'enum',
    400,
    snap('adv-enum-category', { category: 'snack' }),
    (r) => {
      r.product.category = 'snack';
    },
  );
  add(
    'adv-enum-market',
    'enum',
    400,
    { ...snap('adv-enum-market'), market: 'US' },
    (r) => {
      r.product.market = 'US';
    },
  );
  add(
    'adv-enum-fact-state',
    'enum',
    400,
    snap('adv-enum-fact-state', { flags: { ...base.flags, cheese: 'maybe' } }),
    (r) => {
      r.product.scoringFacts.cheese = { state: 'maybe', sourceIds: ['src-0'] };
    },
  );
  add(
    'adv-wire-enum-source-kind',
    'enum',
    400,
    snap('adv-wire-enum-source-kind'),
    (r) => {
      r.product.sourceRefs[0].kind = 'scanner';
    },
    { rawOnly: true },
  );
  add(
    'adv-wire-enum-observation-kind',
    'enum',
    400,
    snap('adv-wire-enum-observation-kind'),
    (r) => {
      r.product.observations[0].kind = 'guessed';
    },
    { rawOnly: true },
  );
  add(
    'adv-wire-null-category',
    'enum',
    400,
    snap('adv-wire-null-category'),
    (r) => {
      r.product.category = null;
    },
    { rawOnly: true },
  );

  // ----- category and fact consistency ----------------------------------------
  add(
    'adv-facts-cheese-on-beverage',
    'facts',
    400,
    snap('adv-facts-cheese-on-beverage', {
      category: 'beverage',
      observations: obs.map((o) => ({ ...o, basis: 'per_100_ml' })),
      flags: { ...base.flags, cheese: true },
    }),
    (r) => {
      r.product.category = 'beverage';
      for (const o of r.product.observations) o.basis = 'per_100_ml';
      r.product.scoringFacts.cheese = {
        state: 'present',
        sourceIds: ['src-0'],
      };
    },
  );
  add(
    'adv-facts-plain-water-on-general',
    'facts',
    400,
    snap('adv-facts-plain-water-on-general', {
      flags: { ...base.flags, plainWater: true },
    }),
    (r) => {
      r.product.scoringFacts.plainWater = {
        state: 'present',
        sourceIds: ['src-0'],
      };
    },
  );
  {
    const missingProvenance = snap('adv-facts-category-unsourced');
    missingProvenance.scoringFacts.categorySourceIds = [];
    add(
      'adv-facts-category-unsourced',
      'facts',
      'insufficient_data',
      missingProvenance,
    );
  }

  // ----- malformed or oversize fields -----------------------------------------
  add('adv-name-500', 'size', 'graded', {
    ...snap('adv-name-500'),
    name: 'n'.repeat(500),
  });
  add(
    'adv-name-501',
    'size',
    400,
    { ...snap('adv-name-501'), name: 'n'.repeat(501) },
    (r) => {
      r.product.name = 'n'.repeat(501);
    },
  );
  add(
    'adv-ingredients-20000-emoji',
    'size',
    'graded',
    snap('adv-ingredients-20000-emoji', { text: EMOJI.repeat(20000) }),
  );
  add(
    'adv-ingredients-20001-emoji',
    'size',
    400,
    snap('adv-ingredients-20001-emoji', { text: EMOJI.repeat(20001) }),
    (r) => {
      r.product.ingredientsText = EMOJI.repeat(20001);
    },
  );
  {
    const many = Array.from({ length: 101 }, (_v, i) => ({
      field: `extra${i}`,
      value: 1,
      unit: 'g',
      basis: 'per_100_g',
    }));
    add(
      'adv-observations-101',
      'size',
      400,
      snap('adv-observations-101', { observations: many }),
      (r) => {
        const template = r.product.observations[0];
        r.product.observations = many.map((o) => ({
          ...template,
          field: o.field,
          unit: 'g',
          value: 1,
        }));
      },
    );
  }
  add(
    'adv-wire-bad-barcode',
    'size',
    400,
    snap('adv-wire-bad-barcode'),
    (r) => {
      r.product.barcode = '12ab';
    },
    { rawOnly: true },
  );

  // ----- injection-like ingredient text ---------------------------------------
  // Graded: the phone refuses the unreplayable grade. Gap: toUpdate maps it.
  // RFC 8785 hashes I-JSON (RFC 7493 section 2.1), which forbids an unpaired
  // surrogate, so the backend refuses that text with 400 (analyses.py).
  for (const [suffix, text, graded, gap] of [
    ['script', `${SCRIPT}, sugar, salt`, 'graded', 'insufficient_data'],
    ['sql', SQL, 'graded', 'insufficient_data'],
    ['zalgo-rtl', ZALGO, 'graded', 'insufficient_data'],
    ['lone-surrogate', '\uD800 sugar, salt', 400, 400],
  ]) {
    add(
      `adv-inject-${suffix}`,
      'injection',
      graded,
      snap(`adv-inject-${suffix}`, { text }),
    );
    add(
      `adv-inject-${suffix}-gap`,
      'injection',
      gap,
      snap(`adv-inject-${suffix}-gap`, { text, observations: [] }),
    );
  }

  // ----- digest canonicalisation ------------------------------------------------
  // Unscored fields the calculator ignores, so only the digest sees them.
  const numberForms = [
    0.30000000000000004, 1e-7, 1e21, 5e-324, 99.99999999999999,
  ];
  add(
    'adv-digest-number-forms',
    'digest',
    'graded',
    snap('adv-digest-number-forms', {
      observations: [
        ...obs,
        ...numberForms.map((value, i) => ({
          field: `unscored${i}`,
          value,
          unit: 'g',
          basis: 'per_100_g',
        })),
      ],
    }),
  );

  // ----- contract envelope ----------------------------------------------------
  add(
    'adv-wire-contract-version-old',
    'contract',
    400,
    snap('adv-wire-contract-version-old'),
    (r) => {
      r.contractVersion = '0.2.0-draft';
    },
    { rawOnly: true },
  );
  add(
    'adv-wire-contract-version-missing',
    'contract',
    400,
    snap('adv-wire-contract-version-missing'),
    (r) => {
      delete r.contractVersion;
    },
    { rawOnly: true },
  );
  add(
    'adv-wire-forged-input-digest',
    'contract',
    400,
    snap('adv-wire-forged-input-digest'),
    (r) => {
      r.inputDigest = 'a'.repeat(64);
    },
    { rawOnly: true },
  );
  add(
    'adv-wire-forged-method-sha',
    'contract',
    'method_unavailable',
    snap('adv-wire-forged-method-sha'),
    (r) => {
      r.resourceCompatibility.methodBundleSha256 = 'f'.repeat(64);
    },
    { rawOnly: true },
  );
  return cases;
}

/**
 * Tampered 200 answers. `from` names the stored answer to start from; `mutate`
 * returns the new body text. These test the phone gate only.
 */
export function tamperCases() {
  const json = (mutate) => (body) =>
    JSON.stringify(mutate(structuredClone(body)));
  const issue0 = (b) => b.scientific.issues[0];
  return [
    {
      name: 'tamper-forged-digest',
      expect: 'rejected',
      from: 'nutrition-missing',
      text: json((b) => ({ ...b, inputDigest: 'a'.repeat(64) })),
    },
    {
      name: 'tamper-stale-digest',
      expect: 'rejected',
      from: 'nutrition-missing',
      stale: 'vector-general-mid',
      text: null, // set from the stale answer's digest at check time
    },
    {
      name: 'tamper-contract-version',
      expect: 'rejected',
      from: 'nutrition-missing',
      text: json((b) => ({ ...b, contractVersion: '0.2.0-draft' })),
    },
    {
      name: 'tamper-unknown-state',
      expect: 'rejected',
      from: 'nutrition-missing',
      text: json((b) => ({
        ...b,
        scientific: { ...b.scientific, state: 'maybe' },
      })),
    },
    {
      name: 'tamper-extra-field',
      expect: 'rejected',
      from: 'nutrition-missing',
      text: json((b) => ({ ...b, debug: 'PARITY-TAMPER extra' })),
    },
    {
      name: 'tamper-snapshot-id',
      expect: 'rejected',
      from: 'nutrition-missing',
      text: json((b) => ({
        ...b,
        scientific: { ...b.scientific, inputSnapshotId: 'someone-else' },
      })),
    },
    {
      name: 'tamper-script-message',
      expect: 'shown',
      from: 'nutrition-missing',
      text: json((b) => {
        issue0(b).message = `PARITY-TAMPER ${SCRIPT}`;
        return b;
      }),
    },
    {
      name: 'tamper-script-field',
      expect: 'shown',
      from: 'nutrition-missing',
      text: json((b) => {
        issue0(b).field = `PARITY-TAMPER ${SCRIPT}`;
        return b;
      }),
    },
    {
      name: 'tamper-script-code',
      expect: 'shown',
      from: 'nutrition-missing',
      text: json((b) => {
        issue0(b).code = 'parity_tamper_script';
        return b;
      }),
    },
    {
      name: 'tamper-script-citation',
      expect: 'shown',
      from: 'nutrition-missing',
      text: json((b) => {
        if (b.citations[0]) b.citations[0].title = `PARITY-TAMPER ${SCRIPT}`;
        return b;
      }),
    },
    {
      name: 'tamper-grade-f',
      expect: 'rejected',
      from: 'vector-general-mid',
      text: json((b) => ({
        ...b,
        scientific: { ...b.scientific, grade: 'F' },
      })),
    },
    {
      name: 'tamper-method-sha',
      expect: 'rejected',
      from: 'vector-general-mid',
      text: json((b) => ({
        ...b,
        scientific: {
          ...b.scientific,
          method: { ...b.scientific.method, bundleSha256: 'b'.repeat(64) },
        },
      })),
    },
    {
      name: 'tamper-nan-body',
      expect: 'rejected',
      from: 'nutrition-missing',
      text: (body) =>
        JSON.stringify(body).replace(/"inputDigest":"[0-9a-f]+"/, '"x":NaN'),
    },
  ];
}
