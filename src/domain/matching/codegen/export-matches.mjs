/**
 * Exports the actual TypeScript `matchIngredient` identity for every reviewed
 * exact-match fixture vector. No expected identity supplies output.
 *
 * Run from the repository root:
 *   node src/domain/matching/codegen/export-matches.mjs
 *
 * Set INGRADIENT_MATCH_VECTORS to read another fixture path for engineering
 * failure tests. The reviewed fixture bundle hash is still enforced, so an
 * unregistered or edited edition is refused instead of exported silently.
 *
 * Before the matcher runs, the reviewed fixture bundle, its taxonomy source
 * pins, the pinned taxonomy bytes and the generated matcher index must all
 * agree with resources/manifest.json. A mismatch, a malformed fixture, a
 * repeated id, an invalid profile or a compilation failure exits non-zero and
 * writes nothing to stdout.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Exact-identity profile this exporter is allowed to publish. */
const FIXTURE_BUNDLE_ID = 'off-exact-match-vectors';
const FIXTURE_PROFILE = 'exact-identity';
const FIXTURE_SCHEMA_VERSION = 1;
const EXPORT_SCOPE = 'exact-matching';

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJsonFile(path, label) {
  let raw;
  try {
    raw = readFileSync(path);
  } catch (error) {
    fail(`${label} is unreadable at ${path}: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail(`${label} at ${path} is not valid JSON: ${error.message}`);
  }
  return { value, raw };
}

function asObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value;
}

function asNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value;
}

/** Indexes resources/manifest.json bundles by id, rejecting repeats. */
function indexBundles(manifest) {
  if (!Array.isArray(manifest.bundles) || manifest.bundles.length === 0) {
    fail('resources/manifest.json lists no bundles.');
  }
  const byId = new Map();
  for (const entry of manifest.bundles) {
    const bundle = asObject(entry, 'Manifest bundle');
    const bundleId = asNonEmptyString(bundle.bundleId, 'Manifest bundleId');
    if (byId.has(bundleId)) {
      fail(`resources/manifest.json lists ${bundleId} twice.`);
    }
    byId.set(bundleId, bundle);
  }
  return byId;
}

/** Rejects malformed or empty vectors before any identity is trusted. */
function verifyFixture(fixture) {
  const value = asObject(fixture, 'Match fixture');
  if (value.schemaVersion !== FIXTURE_SCHEMA_VERSION) {
    fail(`Match fixture schemaVersion must be ${FIXTURE_SCHEMA_VERSION}.`);
  }
  if (value.profile !== FIXTURE_PROFILE) {
    fail(`Match fixture profile must be "${FIXTURE_PROFILE}".`);
  }
  if (!Array.isArray(value.vectors) || value.vectors.length === 0) {
    fail('Match fixture lists no vectors.');
  }
  const ids = new Set();
  const vectors = value.vectors.map((entry, position) => {
    const vector = asObject(entry, `Match vector #${position + 1}`);
    const id = asNonEmptyString(vector.id, `Match vector #${position + 1} id`);
    if (ids.has(id)) {
      fail(`Match fixture repeats vector id ${id}.`);
    }
    ids.add(id);
    const input = asObject(vector.input, `Match vector ${id} input`);
    if (typeof input.text !== 'string') {
      fail(`Match vector ${id} input.text must be a string.`);
    }
    if (typeof input.additiveContext !== 'boolean') {
      fail(`Match vector ${id} input.additiveContext must be a boolean.`);
    }
    return { id, text: input.text, additiveContext: input.additiveContext };
  });
  return { fixture: value, vectors };
}

/** The reviewed fixture bytes must be the manifest's pinned bundle. */
function verifyFixtureBundle(byId, raw) {
  const bundle = byId.get(FIXTURE_BUNDLE_ID);
  if (!bundle) {
    fail(`resources/manifest.json lists no ${FIXTURE_BUNDLE_ID} bundle.`);
  }
  const digest = sha256(raw);
  if (digest !== bundle.sha256 || raw.length !== bundle.sizeBytes) {
    fail(
      `Reviewed fixture bundle ${FIXTURE_BUNDLE_ID} does not match the ` +
        `manifest (sha256 ${digest}, ${raw.length} bytes).`,
    );
  }
  return bundle;
}

/** Each source pin must match the manifest and the actual pinned bytes. */
function verifySourcePins(fixture, byId) {
  if (!Array.isArray(fixture.sourcePins) || fixture.sourcePins.length === 0) {
    fail('Match fixture lists no sourcePins.');
  }
  for (const entry of fixture.sourcePins) {
    const pin = asObject(entry, 'Fixture source pin');
    const bundleId = asNonEmptyString(pin.bundleId, 'Fixture pin bundleId');
    const bundle = byId.get(bundleId);
    if (!bundle) {
      fail(`Fixture pin ${bundleId} is absent from resources/manifest.json.`);
    }
    if (pin.sha256 !== bundle.sha256 || pin.sizeBytes !== bundle.sizeBytes) {
      fail(`Fixture pin ${bundleId} does not match resources/manifest.json.`);
    }
    if (pin.path !== bundle.path) {
      fail(
        `Fixture pin ${bundleId} points at ${pin.path}, not ${bundle.path}.`,
      );
    }
    const pinnedPath = join(root, 'resources', bundle.path);
    let bytes;
    try {
      bytes = readFileSync(pinnedPath);
    } catch (error) {
      fail(`Pinned source ${pinnedPath} is unreadable: ${error.message}`);
    }
    const digest = sha256(bytes);
    if (digest !== pin.sha256 || bytes.length !== pin.sizeBytes) {
      fail(`Pinned source ${bundle.path} does not match pin ${bundleId}.`);
    }
  }
  return fixture.sourcePins.map((pin) => ({
    bundleId: pin.bundleId,
    sha256: pin.sha256,
  }));
}

/** The generated matcher index must be built from the pinned manifest. */
function verifyGeneratedIndex(index, manifest, byId, pins) {
  if (index.manifestRevision !== manifest.revision) {
    fail(
      `Generated matching index revision ${index.manifestRevision} does not ` +
        `match manifest revision ${manifest.revision}.`,
    );
  }
  if (!Array.isArray(index.sources) || index.sources.length === 0) {
    fail('Generated matching index lists no sources.');
  }
  const sources = index.sources.map((entry) => {
    const source = asObject(entry, 'Generated index source');
    const bundleId = asNonEmptyString(
      source.bundleId,
      'Generated index source bundleId',
    );
    const bundle = byId.get(bundleId);
    if (!bundle) {
      fail(`Generated index source ${bundleId} is not in the manifest.`);
    }
    if (source.sha256 !== bundle.sha256) {
      fail(`Generated index source ${bundleId} does not match the manifest.`);
    }
    return { bundleId, sha256: source.sha256 };
  });
  for (const pin of pins) {
    const source = sources.find((entry) => entry.bundleId === pin.bundleId);
    if (!source || source.sha256 !== pin.sha256) {
      fail(
        `Generated matching index is not built from pinned ${pin.bundleId}.`,
      );
    }
  }
}

const manifest = asObject(
  readJsonFile(join(root, 'resources/manifest.json'), 'resources/manifest.json')
    .value,
  'resources/manifest.json',
);
const bundleById = indexBundles(manifest);

const fixturePath =
  process.env.INGRADIENT_MATCH_VECTORS ??
  join(root, 'resources/vectors/match-vectors.json');
const fixtureRead = readJsonFile(fixturePath, 'Match fixture');
const { fixture, vectors } = verifyFixture(fixtureRead.value);
verifyFixtureBundle(bundleById, fixtureRead.raw);
const pins = verifySourcePins(fixture, bundleById);
verifyGeneratedIndex(
  asObject(
    readJsonFile(
      join(root, 'src/domain/matching/generated/taxonomy-index.json'),
      'Generated matching index',
    ).value,
    'Generated matching index',
  ),
  manifest,
  bundleById,
  pins,
);

const temporary = mkdtempSync(join(tmpdir(), 'ingr-matching-export-'));
try {
  const config = join(temporary, 'tsconfig.json');
  const output = join(temporary, 'compiled');
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'Node',
        resolveJsonModule: true,
        esModuleInterop: true,
        strict: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        types: [],
        ignoreDeprecations: '6.0',
        rootDir: root,
        outDir: output,
      },
      files: [join(root, 'src/domain/matching/index.ts')],
    }),
  );
  const compiled = spawnSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--project', config],
    { cwd: root, encoding: 'utf8' },
  );
  if (compiled.error || compiled.status !== 0) {
    fail(
      'Compiling src/domain/matching/index.ts failed: ' +
        (compiled.error?.message ?? `${compiled.stdout}${compiled.stderr}`),
    );
  }
  const require = createRequire(import.meta.url);
  const { matchIngredient } = require(
    join(output, 'src/domain/matching/index.js'),
  );
  if (typeof matchIngredient !== 'function') {
    fail('Compiled src/domain/matching/index.ts exports no matchIngredient.');
  }
  // Identity only: fuzzy keeps its exact default; fixture expectations unused.
  const records = vectors.map(
    (vector) =>
      JSON.stringify({
        id: vector.id,
        scope: EXPORT_SCOPE,
        match: matchIngredient(vector.text, {
          additiveContext: vector.additiveContext,
        }),
      }) + '\n',
  );
  process.stdout.write(records.join(''));
} finally {
  if (
    dirname(resolve(temporary)) !== resolve(tmpdir()) ||
    !basename(temporary).startsWith('ingr-matching-export-')
  ) {
    fail('Unexpected matching export directory');
  }
  rmSync(temporary, { recursive: true, force: true });
}
