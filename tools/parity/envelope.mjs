/**
 * Phone side of the AnalyzeResponse envelope check (driven by envelope.py).
 *
 *   node envelope.mjs build <dir>   write the phone-built request per case
 *   node envelope.mjs check <dir>   validate each stored backend response with
 *                                   the generated wire validator, then run it
 *                                   through the real hybrid analyser (toUpdate)
 *
 * Adversarial cases (adversarial.mjs) also record the phone's wire-validator
 * verdict and the phone's own local replay of the same snapshot. Each parity
 * measure is reported on its own; they are never summed.
 *
 * No network: the analyser gets a fake fetch that replays the stored response.
 * Nothing in src/ is edited; the phone modules are compiled to a temp folder.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  MARKERS,
  adversarialCases,
  rawTokens,
  tamperCases,
} from './adversarial.mjs';
import { KNOWN_DEFECTS } from './known-defects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [mode, dir] = process.argv.slice(2);
if (!['build', 'check'].includes(mode) || !dir) {
  console.error('usage: envelope.mjs <build|check> <work-dir>');
  process.exit(2);
}
const work = resolve(dir);

function compile() {
  const temporary = mkdtempSync(join(tmpdir(), 'ingr-envelope-'));
  const output = join(temporary, 'compiled');
  const config = join(temporary, 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'Node',
        resolveJsonModule: true,
        esModuleInterop: true,
        allowJs: true,
        checkJs: false,
        strict: true,
        skipLibCheck: true,
        lib: ['ES2022', 'DOM'],
        types: ['node'],
        typeRoots: [join(root, 'node_modules/@types')],
        ignoreDeprecations: '6.0',
        rootDir: root,
        outDir: output,
      },
      files: [
        join(root, 'src/adapters/backend/hybrid-analyser.ts'),
        join(root, 'src/domain/hybrid/resources.ts'),
        join(root, 'src/copy/en-GB.ts'),
        join(root, 'src/domain/pipeline/index.ts'),
        join(root, 'src/features/app/analysis.ts'),
      ],
    }),
  );
  const run = spawnSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--project', config],
    { cwd: root, encoding: 'utf8' },
  );
  if (run.error || run.status !== 0) {
    console.error(run.error?.message ?? run.stdout + run.stderr);
    rmSync(temporary, { recursive: true, force: true });
    process.exit(2);
  }
  // tsc does not emit generated .js validators that sit beside a .d.ts file.
  const generated = 'src/domain/contracts/generated';
  mkdirSync(join(output, generated), { recursive: true });
  for (const name of ['validate-wire.js', 'validate-local.js']) {
    copyFileSync(join(root, generated, name), join(output, generated, name));
  }
  // The compiled files live in a temp folder; resolve ajv and friends from the repo.
  process.env.NODE_PATH = join(root, 'node_modules');
  Module._initPaths();
  return { temporary, output };
}

let exitCode = 0;
const { temporary, output } = compile();
try {
  const load = (path) => createRequire(import.meta.url)(join(output, path));
  const { createHybridAnalyser } = load(
    'src/adapters/backend/hybrid-analyser.js',
  );
  const { installedResources } = load('src/domain/hybrid/resources.js');
  const { buildAnalyzeRequest } = load('src/domain/hybrid/request.js');
  const { checkBackendAnswer } = load('src/domain/hybrid/offer.js');
  const { mapAnalyzeResponse } = load(
    'src/domain/contracts/map-analyze-response.js',
  );
  const { wireValidators } = load(
    'src/domain/contracts/generated/validate-wire.js',
  );
  const { localValidators } = load(
    'src/domain/contracts/generated/validate-local.js',
  );
  const { enGB } = load('src/copy/en-GB.js');
  const { replayScientificSnapshot } = load('src/domain/pipeline/index.js');

  const { createAnalysis } = load('src/features/app/analysis.js');
  const { phoneAnalyser } = load('src/domain/pipeline/phone-analyser.js');
  const { renderReplayedBackendReasons } = load(
    'src/domain/pipeline/backend-replay-renderer.js',
  );

  const resources = installedResources();
  const vectors = JSON.parse(
    readFileSync(
      join(root, 'resources/vectors/nutriscore-vectors.json'),
      'utf8',
    ),
  ).vectors;
  const INGREDIENTS = 'Whole grain oats, sugar, sunflower oil, sea salt';

  function snapshotFor(options) {
    const {
      id,
      category,
      flags = {},
      observations = [],
      text = INGREDIENTS,
      source = { kind: 'label', title: 'Combined label photo' },
    } = options;
    const src = { id: 'src-0', kind: source.kind, title: source.title };
    if (source.edition) src.edition = source.edition;
    const fact = (value) => {
      const state =
        value === true
          ? 'present'
          : value === false
            ? 'absent'
            : (value ?? 'unknown');
      return state === 'unknown'
        ? { state: 'unknown' }
        : { state, sourceIds: ['src-0'] };
    };
    const hasText = typeof text === 'string' && text.length > 0;
    return {
      id,
      barcode: source.kind === 'off' ? '8901030000001' : null,
      name: null,
      market: 'IN',
      capturedAt: '2026-10-16T00:00:00.000Z',
      sourceRefs: [src],
      observations: observations.map((o) => ({
        field: o.field,
        kind: 'read',
        value: o.value,
        unit: o.unit,
        basis: o.basis,
        sourceIds: ['src-0'],
        issues: [],
      })),
      ingredients: hasText
        ? [
            {
              id: 'ing-1',
              text: text.split(',')[0],
              parentId: null,
              canonicalId: null,
              state: 'unresolved',
              candidateIds: [],
              sourceIds: ['src-0'],
              taxonomyVersion: resources.taxonomyVersion,
            },
          ]
        : [],
      panels: [
        {
          panel: 'ingredients',
          state: hasText ? 'read' : 'missing',
          imageId: null,
          regionId: null,
          ...(hasText ? { text } : {}),
          issues: [],
        },
      ],
      category,
      scoringFacts: {
        categorySourceIds: category === 'unknown' ? [] : ['src-0'],
        cheese: fact(flags.cheese),
        redMeat: fact(flags.redMeat),
        plainWater: fact(flags.plainWater),
        nonNutritiveSweetener: fact(flags.nonNutritiveSweetener),
      },
      taxonomyVersion: resources.taxonomyVersion,
      evidenceVersion: resources.evidenceVersion,
    };
  }

  const base = vectors[0].inputs;
  /** Every case the phone could build. `resources` overrides the installed pins. */
  const built = [
    ...vectors.map((v) => ({
      name: v.id,
      group: 'vector',
      snapshot: snapshotFor({ id: v.id, ...v.inputs }),
    })),
    {
      name: 'ingredients-missing',
      group: 'variant',
      snapshot: snapshotFor({ id: 'ingredients-missing', ...base, text: null }),
    },
    {
      name: 'ingredients-hindi',
      group: 'variant',
      snapshot: snapshotFor({
        id: 'ingredients-hindi',
        ...base,
        text: 'आटा, चीनी, सूरजमुखी का तेल, नमक',
      }),
    },
    {
      name: 'nutrition-missing',
      group: 'variant',
      snapshot: snapshotFor({
        id: 'nutrition-missing',
        ...base,
        observations: [],
      }),
    },
    {
      name: 'source-open-food-facts',
      group: 'variant',
      snapshot: snapshotFor({
        id: 'source-open-food-facts',
        ...base,
        source: {
          kind: 'off',
          title: 'Open Food Facts product',
          edition: 'rev-12',
        },
      }),
    },
    {
      name: 'stale-phone-resources',
      group: 'variant',
      snapshot: snapshotFor({ id: 'stale-phone-resources', ...base }),
      resources: { ...resources, taxonomyVersion: 'stale-taxonomy-edition' },
    },
  ];

  const fats = vectors.find((v) => v.inputs.category === 'fats_nuts_seeds');
  const adversarial = adversarialCases({
    snapshotFor,
    base,
    fats: fats.inputs,
  }).map((c) => ({ ...c, group: 'adversarial' }));
  const replayTampers = [
    [
      'grade',
      (s) => {
        s.grade = 'E';
      },
    ],
    [
      'score',
      (s) => {
        s.score += 1;
      },
    ],
    [
      'route',
      (s) => {
        s.route = 'beverage';
      },
    ],
    [
      'method-id',
      (s) => {
        s.method.id = 'different-method';
      },
    ],
    [
      'method-label',
      (s) => {
        s.method.label = 'Untrusted label';
      },
    ],
    [
      'trace-points',
      (s) => {
        s.trace[0].points += 1;
      },
    ],
    [
      'trace-locator',
      (s) => {
        s.trace[0].ruleLocator = 'Untrusted locator';
      },
    ],
    [
      'trace-citations',
      (s) => {
        s.trace[0].citationIds = ['unknown'];
      },
    ],
    [
      'reason-template',
      (s) => {
        s.reasons[0].templateId = 'unknown';
      },
    ],
    [
      'reason-inputs',
      (s) => {
        s.reasons[0].inputFields = ['protein'];
      },
    ],
    [
      'reason-omission',
      (s) => {
        s.reasons.splice(0, 1);
      },
    ],
  ].map(([name, mutate]) => ({
    name: `tamper-replay-${name}`,
    from: 'vector-general-mid',
    expect: 'refused',
    text: (body) => {
      const changed = structuredClone(body);
      mutate(changed.scientific);
      return JSON.stringify(changed);
    },
  }));
  const localTextTamper = {
    name: 'tamper-replay-server-text',
    from: 'vector-general-mid',
    expect: 'shown',
    text: (body) => {
      const changed = structuredClone(body);
      changed.scientific.reasons[0].text = 'PARITY-TAMPER untrusted reason';
      changed.citations[0].title = 'PARITY-TAMPER untrusted citation';
      return JSON.stringify(changed);
    },
  };
  const tampers = [...tamperCases(), ...replayTampers, localTextTamper];

  // ----- check mode ---------------------------------------------------------

  /** Reviewed phone sentences: the only issue messages allowed on the screen. */
  function reviewedMessages() {
    const copy = enGB.backendIssue;
    const labels = Object.values(copy.nutrientLabel);
    return new Set([
      copy.unknown,
      ...Object.values(copy.fixed),
      ...labels.flatMap((l) => [
        copy.missing(l),
        copy.conflicting(l),
        copy.unsupportedBasis(l),
        copy.invalid(l),
        copy.unusable(l),
      ]),
    ]);
  }

  /** Free-text strings the server sent (sentences and source names). */
  function serverText(value, out = []) {
    if (Array.isArray(value)) value.forEach((v) => serverText(v, out));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (
          typeof v === 'string' &&
          ['message', 'text', 'title', 'issuer', 'locator'].includes(k)
        ) {
          out.push(v);
        } else serverText(v, out);
      }
    }
    return out;
  }

  function errorDetail(validator) {
    const first = validator.errors?.[0];
    return first ? `${first.instancePath || '/'} ${first.message}` : 'unknown';
  }

  const PROBLEM_FALLBACK = {
    400: 'backend_rejected',
    413: 'backend_too_large',
    429: 'backend_rate_limited',
    503: 'backend_unavailable',
  };

  async function runAnalyser(item, stored, replayMode = 'production') {
    const snapshot = item.snapshot ?? built[0].snapshot;
    let localCalls = 0;
    const fetch = async () =>
      new Response(stored.text, {
        status: stored.status,
        headers: stored.headers,
      });
    const context = { acceptedNoticeVersion: () => '1-draft' };
    // Normal cases exercise the same factory as services.tsx. Resource overrides
    // and deliberately missing/null renderers are isolated negative controls.
    const analyser =
      replayMode === 'production' && !item.resources
        ? createAnalysis(context, {
            baseUrl: 'https://analysis.example.invalid',
            fetch,
          }).analyser
        : createHybridAnalyser({
            baseUrl: 'https://analysis.example.invalid',
            fetch,
            context,
            local: {
              analyse: (...args) => {
                localCalls += 1;
                return phoneAnalyser.analyse(...args);
              },
            },
            resources: item.resources ?? resources,
            ...(replayMode === 'missing'
              ? {}
              : {
                  renderReasons:
                    replayMode === 'null'
                      ? () => null
                      : renderReplayedBackendReasons,
                }),
          });
    try {
      const result = await analyser.analyse(
        snapshot,
        new AbortController().signal,
      );
      return { result, localCalls, thrown: null };
    } catch (error) {
      return { result: null, localCalls, thrown: String(error) };
    }
  }

  const readStored = (name) =>
    JSON.parse(readFileSync(join(work, 'responses', `${name}.json`), 'utf8'));
  const parseOrUndefined = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  /** Problems in what the phone would show: server text and markers. */
  function shownProblems(result, body, reviewed, snapshot) {
    const replay = replayScientificSnapshot(snapshot);
    const allowed = new Set([
      ...reviewed,
      ...replay.scientific.reasons.map((reason) => reason.text),
      ...replay.scientific.issues.map((issue) => issue.message),
      ...replay.issues.map((issue) => issue.message),
    ]);
    const problems = [];
    const text = JSON.stringify(result ?? null);
    for (const marker of MARKERS) {
      if (text.includes(JSON.stringify(marker).slice(1, -1))) {
        problems.push(`marker ${JSON.stringify(marker)} in phone result`);
      }
    }
    if (result && !localValidators.LocalAssessment(result.assessment)) {
      problems.push('analyser returned an invalid local assessment');
    }
    if (result?.executor !== 'backend') return problems;
    const shown = result.assessment;
    for (const issue of shown.scientific.issues) {
      if (!allowed.has(issue.message)) {
        problems.push(`server text on screen: "${issue.message}"`);
      }
    }
    if (shown.citations.length > 0 && shown.scientific.reasons.length === 0) {
      problems.push(`${shown.citations.length} server citations kept`);
    }
    if (
      JSON.stringify(shown.scientific.reasons) !==
      JSON.stringify(replay.scientific.reasons)
    ) {
      problems.push('shown reasons differ from the installed replay');
    }
    const citations =
      shown.scientific.reasons.length > 0 ? replay.citations : [];
    if (JSON.stringify(shown.citations) !== JSON.stringify(citations)) {
      problems.push('shown citations differ from the installed replay');
    }
    const rest = JSON.stringify({ ...shown, citations: [] });
    const leaked = serverText({ ...(body ?? {}), citations: [] }).filter(
      (t) =>
        !allowed.has(t) &&
        t.length > 12 &&
        rest.includes(JSON.stringify(t).slice(1, -1)),
    );
    if (leaked.length > 0) {
      problems.push(`server text in result: ${JSON.stringify(leaked[0])}`);
    }
    return problems;
  }

  function outcomeOf(run) {
    if (run.thrown) return 'THROWN';
    if (run.result.executor === 'backend') return 'shown';
    if (run.result.fallbackIssue?.code === 'backend_answer_invalid')
      return 'refused-unreplayable';
    return 'fallback-' + (run.result.fallbackIssue?.code ?? 'none');
  }

  /** One adversarial request case: four separate measures, never summed. */
  async function checkAdversarial(entry, reviewed, finding) {
    const item = adversarial.find((a) => a.name === entry.name);
    const stored = readStored(entry.name);
    const body = parseOrUndefined(stored.text);
    const sentBody = readFileSync(
      join(work, 'requests', `${entry.name}.json`),
      'utf8',
    );
    const row = {
      case: entry.name,
      measure: item.measure,
      sent: entry.sent,
      phoneBuild: entry.phoneBuild,
      via: entry.via ?? 'in-process',
    };
    const flag = (measure, text) => finding(`${entry.name}:${measure}`, text);

    // 1. The backend gives the documented problem status or gap state.
    row.backend =
      stored.status === 200
        ? (body?.scientific?.state ?? 'not-json')
        : stored.status;
    row.expect = item.expect;
    if (row.backend !== item.expect) {
      flag('backend', `backend gave ${row.backend}, documented ${item.expect}`);
    }
    const validator =
      stored.status === 200
        ? wireValidators.AnalyzeResponse
        : wireValidators.Problem;
    if (body === undefined || !validator(structuredClone(body))) {
      flag(
        'backend',
        `response ${stored.status} fails the phone schema: ${body === undefined ? 'not JSON' : errorDetail(validator)}`,
      );
    }

    // 2. The phone wire validator agrees with the backend on accept/refuse.
    const parsed = parseOrUndefined(sentBody);
    let verdict;
    try {
      verdict =
        parsed === undefined
          ? 'refuse (not JSON)'
          : wireValidators.AnalyzeRequest(parsed)
            ? 'accept'
            : `refuse (${errorDetail(wireValidators.AnalyzeRequest)})`;
    } catch (error) {
      verdict = 'THROWN';
      flag('phone', `wire validator threw: ${String(error)}`);
    }
    row.wire = verdict;
    row.wireAgrees = (verdict === 'accept') === (stored.status === 200);
    if (!row.wireAgrees) {
      flag(
        'wire',
        `phone validator says ${verdict}, backend answered ${stored.status}`,
      );
    }

    // The phone's digest and edition gate on a 200 answer to its own request.
    row.gate = '-';
    if (stored.status === 200 && body !== undefined && entry.sent === 'phone') {
      try {
        const gate = checkBackendAnswer({
          sentBody,
          response: body,
          resources,
          scanActive: true,
          now: 0,
          deadline: 1,
        });
        row.gate = gate.ok ? 'ok' : gate.reason;
      } catch (error) {
        flag('phone', `phone gate threw: ${String(error)}`);
        row.gate = 'THROWN';
      }
      if (row.gate !== 'ok') flag('gate', `phone gate gave ${row.gate}`);
    }

    // 3. The phone never throws and shows no server text or marker.
    const run = await runAnalyser(item, stored);
    row.phone = outcomeOf(run);
    if (entry.phoneBuild === 'THREW' || run.thrown) {
      flag('phone', `phone threw: ${run.thrown ?? 'buildAnalyzeRequest'}`);
    }
    for (const problem of shownProblems(
      run.result,
      body,
      reviewed,
      item.snapshot,
    )) {
      flag('phone', problem);
    }

    // 4. The phone's own local analysis of the same snapshot.
    try {
      row.local = replayScientificSnapshot(item.snapshot).scientific.state;
    } catch (error) {
      row.local = 'THROWN';
      flag('local', `local replay threw: ${String(error)}`);
    }
    if (item.rawOnly) {
      row.parity = 'n/a (phone never sends it)';
    } else if (stored.status === 200) {
      row.parity = row.backend === row.local ? 'same' : 'DIFFER';
      if (row.parity === 'DIFFER') {
        flag('state', `backend ${row.backend}, phone local ${row.local}`);
      }
      if (
        entry.sent === 'phone' &&
        row.gate === 'ok' &&
        row.parity === 'same' &&
        row.phone !== 'shown'
      ) {
        flag(
          'phone',
          `matching actual Python answer was not shown: ${row.phone}`,
        );
      }
    } else if (entry.phoneBuild !== 'ok') {
      row.parity = 'both refuse';
    } else {
      row.parity = 'DIFFER';
      flag('state', `phone sends it, backend refuses with ${stored.status}`);
    }
    return row;
  }

  /** A tampered 200 answer: never throw, never show tampered text. */
  async function checkTamper(tamper, reviewed, finding) {
    const origin = readStored(tamper.from);
    const row = { case: tamper.name, from: tamper.from, expect: tamper.expect };
    const originBody = parseOrUndefined(origin.text);
    if (origin.status !== 200 || originBody === undefined) {
      row.phone = `skipped (${tamper.from} gave ${origin.status})`;
      finding(`${tamper.name}:phone`, row.phone);
      return row;
    }
    const text = tamper.stale
      ? JSON.stringify({
          ...originBody,
          inputDigest: JSON.parse(readStored(tamper.stale).text).inputDigest,
        })
      : tamper.text(originBody);
    const item = built.find((b) => b.name === tamper.from);
    const run = await runAnalyser(item, { ...origin, text });
    row.phone = outcomeOf(run);
    if (run.thrown) finding(`${tamper.name}:phone`, `threw: ${run.thrown}`);
    if ((row.phone === 'shown') !== (tamper.expect === 'shown')) {
      finding(
        `${tamper.name}:gate`,
        `phone outcome ${row.phone}, expected ${tamper.expect}`,
      );
    }
    const problems = shownProblems(
      run.result,
      parseOrUndefined(text),
      reviewed,
      item.snapshot,
    );
    for (const problem of problems) {
      finding(`${tamper.name}:phone`, problem);
    }
    return row;
  }

  async function check(manifestCases) {
    const reviewed = reviewedMessages();
    const rows = [];
    const defects = [];
    const advRows = [];
    const tamperRows = [];
    const findings = [];
    const finding = (key, text) => findings.push({ key, text });
    for (const entry of manifestCases) {
      if (entry.group === 'adversarial') {
        advRows.push(await checkAdversarial(entry, reviewed, finding));
        continue;
      }
      const item = built.find((b) => b.name === entry.name) ?? {
        name: entry.name,
        snapshot: built[0].snapshot,
      };
      const stored = JSON.parse(
        readFileSync(join(work, 'responses', `${entry.name}.json`), 'utf8'),
      );
      const row = {
        case: entry.name,
        status: stored.status,
        schema: null,
        outcome: null,
        replayControls: null,
        notes: [],
      };
      const defect = (text) => defects.push(`${entry.name}: ${text}`);
      let body;
      try {
        body = JSON.parse(stored.text);
      } catch {
        row.schema = 'not-json';
        defect('response body is not JSON');
      }
      const validator =
        stored.status === 200
          ? wireValidators.AnalyzeResponse
          : wireValidators.Problem;
      if (body !== undefined) {
        const ok = validator(structuredClone(body));
        row.schema = ok ? 'valid' : 'INVALID';
        if (!ok)
          defect(
            `schema-invalid ${stored.status} body: ${errorDetail(validator)}`,
          );
      }

      const run = await runAnalyser(item, stored);
      if (run.thrown) {
        row.outcome = 'THROWN';
        defect(`analyser threw: ${run.thrown}`);
      } else if (stored.status === 200) {
        const sentBody = readFileSync(
          join(work, 'requests', `${entry.name}.json`),
          'utf8',
        );
        const gate = checkBackendAnswer({
          sentBody,
          response: body,
          resources: item.resources ?? resources,
          scanActive: true,
          now: 0,
          deadline: 1,
        });
        let mapError = null;
        try {
          mapAnalyzeResponse(body, {
            capturedAt: item.snapshot.capturedAt,
            panels: item.snapshot.panels,
            personal: { state: 'not_in_slice', issues: [] },
          });
        } catch (error) {
          mapError = String(error);
          defect(`mapAnalyzeResponse threw: ${mapError}`);
        }
        const state = body.scientific.state;
        row.state = state;
        row.notes.push(
          `state=${state}`,
          `gate=${gate.ok ? 'ok' : gate.reason}`,
        );
        if (run.result.executor === 'backend') {
          row.outcome = state === 'graded' ? 'replayed-grade' : 'gap-copy';
          for (const problem of shownProblems(
            run.result,
            body,
            reviewed,
            item.snapshot,
          )) {
            defect(problem);
          }
        } else if (!gate.ok) {
          row.outcome = `rejected-${gate.reason}`;
        } else {
          row.outcome = outcomeOf(run);
          defect(`eligible Python answer not accepted: ${row.outcome}`);
        }
        if (state === 'graded' && gate.ok && !mapError) {
          row.replayControls = {};
          for (const replayMode of ['missing', 'null']) {
            const control = await runAnalyser(item, stored, replayMode);
            row.replayControls[replayMode] = outcomeOf(control);
            if (
              control.thrown ||
              control.result?.executor !== 'phone' ||
              control.result?.fallbackIssue?.code !== 'backend_answer_invalid'
            ) {
              defect(`${replayMode} replay did not refuse the grade`);
            }
          }
        }
      } else {
        const wanted = PROBLEM_FALLBACK[stored.status];
        const got = run.result.fallbackIssue?.code;
        row.outcome = `fallback-${got}`;
        if (got !== wanted)
          defect(`status ${stored.status} gave ${got}, expected ${wanted}`);
        if (run.result.executor !== 'phone') {
          defect('problem response did not use actual phone analysis');
        }
        if (stored.status === 429) {
          const header = Number(stored.headers['retry-after']);
          row.notes.push(`Retry-After=${stored.headers['retry-after']}`);
          if (!(header >= 1) || header !== body?.retryAfterSeconds) {
            defect('Retry-After header and retryAfterSeconds disagree');
          }
        }
      }
      rows.push(row);
    }
    for (const tamper of tampers) {
      tamperRows.push(await checkTamper(tamper, reviewed, finding));
    }

    // Known adversarial defects are reported, not failed; anything else fails.
    const known = [];
    for (const f of findings) {
      if (KNOWN_DEFECTS[f.key]) known.push(f);
      else defects.push(`${f.key}: ${f.text}`);
    }
    for (const key of Object.keys(KNOWN_DEFECTS)) {
      if (!findings.some((f) => f.key === key)) {
        defects.push(`${key}: listed known defect no longer reproduces`);
      }
    }
    writeFileSync(
      join(work, 'results.json'),
      JSON.stringify({ rows, advRows, tamperRows, findings, defects }, null, 2),
    );
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      pad('case', 36) +
        pad('http', 5) +
        pad('schema', 9) +
        pad('state', 20) +
        pad('toUpdate outcome', 30) +
        'missing/null replay controls',
    );
    for (const r of rows) {
      console.log(
        pad(r.case, 36) +
          pad(r.status, 5) +
          pad(r.schema, 9) +
          pad(r.state ?? '-', 20) +
          pad(r.outcome, 30) +
          (r.replayControls ? JSON.stringify(r.replayControls) : '-'),
      );
    }
    console.log('');
    console.log(
      pad('adversarial case', 38) +
        pad('sent', 6) +
        pad('backend', 19) +
        pad('wire', 8) +
        pad('gate', 6) +
        pad('phone', 34) +
        pad('local', 18) +
        'parity',
    );
    for (const r of advRows) {
      console.log(
        pad(r.case, 38) +
          pad(r.sent, 6) +
          pad(r.backend, 19) +
          pad(r.wireAgrees ? 'agree' : 'DIFFER', 8) +
          pad(r.gate, 6) +
          pad(r.phone, 34) +
          pad(r.local, 18) +
          r.parity,
      );
    }
    console.log('');
    console.log(pad('tampered answer', 38) + pad('expect', 10) + 'phone');
    for (const r of tamperRows) {
      console.log(pad(r.case, 38) + pad(r.expect ?? '-', 10) + r.phone);
    }
    for (const f of known) {
      console.log(
        `  KNOWN DEFECT (reported, not fixed) ${f.key}: ${f.text} [${KNOWN_DEFECTS[f.key]}]`,
      );
    }
    console.log(
      defects.length === 0
        ? 'envelope: no defects'
        : `envelope: ${defects.length} defect(s)`,
    );
    for (const d of defects) console.log('  DEFECT ' + d);
    return defects.length === 0 ? 0 : 1;
  }
  if (mode === 'build') {
    mkdirSync(join(work, 'requests'), { recursive: true });
    const cases = [];
    for (const item of built) {
      const result = buildAnalyzeRequest(
        item.snapshot,
        item.resources ?? resources,
      );
      if (!result.ok) {
        console.error(
          `phone cannot build ${item.name}: ${result.issue.message}`,
        );
        process.exit(2);
      }
      writeFileSync(join(work, 'requests', `${item.name}.json`), result.body);
      cases.push({ name: item.name, group: item.group });
    }
    const baseBody = buildAnalyzeRequest(built[0].snapshot, resources).body;
    for (const item of adversarial) {
      let phone;
      try {
        phone = buildAnalyzeRequest(item.snapshot, resources);
      } catch (error) {
        phone = { ok: false, threw: String(error) };
      }
      const phoneBuild = phone.threw ? 'THREW' : phone.ok ? 'ok' : 'refused';
      let body;
      if (phone.ok && !item.rawOnly) {
        body = phone.body;
      } else if (item.wire || item.text) {
        const request = JSON.parse(baseBody);
        item.wire?.(request);
        body = rawTokens(JSON.stringify(request));
        if (item.text) body = item.text(body);
      } else {
        console.error(`phone refused ${item.name} and it has no wire body`);
        process.exit(2);
      }
      writeFileSync(join(work, 'requests', `${item.name}.json`), body);
      cases.push({
        name: item.name,
        group: 'adversarial',
        sent: phone.ok && !item.rawOnly ? 'phone' : 'raw',
        phoneBuild,
      });
    }
    writeFileSync(join(work, 'cases.json'), JSON.stringify(cases, null, 2));
    console.log(`built ${cases.length} phone requests`);
  } else {
    const manifest = JSON.parse(
      readFileSync(join(work, 'manifest.json'), 'utf8'),
    );
    exitCode = await check(manifest);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
process.exit(exitCode);
