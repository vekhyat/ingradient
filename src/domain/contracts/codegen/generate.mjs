/**
 * Builds the committed contract types and Ajv standalone validators.
 * Run from the repository root: node src/domain/contracts/codegen/generate.mjs
 *
 * The phone imports the emitted validators. It does not compile schemas on device.
 * Only the runtime roots are exported. Their shared $defs are functions in the
 * same file, compiled once per document.
 */

import { load as loadYaml } from 'js-yaml';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { compile } = require('json-schema-to-typescript');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;
const standaloneCode = require('ajv/dist/standalone').default;
const prettier = require('prettier');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const contractsDir = join(repoRoot, 'contracts');
const generatedDir = join(here, '..', 'generated');

const WIRE_ID = 'urn:ingradient:wire-contract:0.3.0-draft';
const HEADER = `/**
 * generated, do not edit
 *
 * Produced by src/domain/contracts/codegen/generate.mjs.
 * The drift test regenerates this file in memory and fails if the text differs.
 */
`;

const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'dependentSchemas',
]);
const ANNOTATIONS = new Set([
  'description',
  'examples',
  'example',
  'discriminator',
  '$comment',
]);

// The phone validates these documents. Nested $defs stay in the file as shared
// functions; they are not exported. Tests compile any other $def in Node.
const LOCAL_RUNTIME_ROOTS = [
  'LocalAssessment',
  'ProductSnapshot',
  'ScientificAssessment',
  'LocalProfile',
  'LocalLearningState',
];
const WIRE_RUNTIME_ROOTS = [
  'AnalyzeRequest',
  'AnalyzeResponse',
  'Health',
  'Problem',
  'ResourceManifest',
];

const typeOptions = {
  bannerComment: HEADER.trim(),
  unreachableDefinitions: true,
  additionalProperties: false,
  enableConstEnums: false,
  unknownAny: true,
  strictIndexSignatures: true,
  // Arrays longer than an exact bound stay arrays. maxItems: 0 still becomes [].
  maxItems: 0,
  format: false,
  declareExternallyReferenced: false,
  $refOptions: {
    resolve: {
      external: false,
      file: false,
      http: false,
    },
  },
};

function compareUtf16(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function asRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value;
}

function readSources() {
  const local = asRecord(
    JSON.parse(readFileSync(join(contractsDir, 'local-contract.schema.json'), 'utf8')),
    'local contract',
  );
  const spec = asRecord(
    loadYaml(readFileSync(join(contractsDir, 'openapi-hybrid.yaml'), 'utf8')),
    'OpenAPI document',
  );
  const components = asRecord(spec.components, 'OpenAPI components');
  const wireDefs = asRecord(
    JSON.parse(
      JSON.stringify(components.schemas).replaceAll('#/components/schemas/', '#/$defs/'),
    ),
    'wire schemas',
  );
  return { local, wireDefs };
}

function schemaNames(defs) {
  return Object.keys(asRecord(defs, 'schema definitions')).sort(compareUtf16);
}

function examplesFromDefs(side, defs) {
  const rows = [];
  for (const schema of schemaNames(defs)) {
    const definition = asRecord(defs[schema], schema);
    const values = [];
    if (Array.isArray(definition.examples)) {
      values.push(...definition.examples);
    }
    if (Object.hasOwn(definition, 'example')) {
      values.push(definition.example);
    }
    values.forEach((value, index) => {
      rows.push({ side, schema, index, value });
    });
  }
  return rows;
}

export function listPositiveExamples() {
  const { local, wireDefs } = readSources();
  return [
    ...examplesFromDefs('local', asRecord(local.$defs, 'local $defs')),
    ...examplesFromDefs('wire', wireDefs),
  ];
}

function schemaForTypes(value) {
  if (Array.isArray(value)) {
    return value.map(schemaForTypes);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    // json-schema-to-typescript drops a definition whose only allOf member is
    // if/then, and it cannot express if/then or not. Ajv still enforces them.
    if (key === 'if' || key === 'then' || key === 'else' || key === 'not') {
      continue;
    }
    next[key] = schemaForTypes(child);
  }
  if (Array.isArray(next.allOf)) {
    const members = next.allOf.filter(
      (member) => member && typeof member === 'object' && Object.keys(member).length > 0,
    );
    if (members.length === 0) {
      delete next.allOf;
    } else {
      next.allOf = members;
    }
  }
  return next;
}

function stripAnnotations(value) {
  if (Array.isArray(value)) {
    return value.map(stripAnnotations);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (ANNOTATIONS.has(key)) {
      continue;
    }
    if (SCHEMA_MAPS.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
      const mapped = {};
      for (const [name, schema] of Object.entries(child)) {
        mapped[name] = stripAnnotations(schema);
      }
      next[key] = mapped;
      continue;
    }
    next[key] = stripAnnotations(child);
  }
  return next;
}

function stripUnnamedReferenceNotes(source) {
  return source.replace(
    /\r?\n \* This (?:interface|type) was referenced by `undefined`'s JSON-Schema\r?\n \* via the `definition` "[^"]+"\./g,
    '',
  );
}

function dropEmptyRoot(source) {
  return source.replace(/export interface (?:Local|Wire)Contract \{\}\r?\n/g, '');
}

async function format(source, filename) {
  const filepath = join(generatedDir, filename);
  const config = await prettier.resolveConfig(filepath);
  const options = { ...(config ?? {}), filepath };
  const formatted = await prettier.format(stripUnnamedReferenceNotes(source), options);
  // json-schema-to-typescript names the document root, which has no fields.
  // Prettier collapses that root to an empty interface, and the lint rule rejects it.
  return prettier.format(dropEmptyRoot(formatted), options);
}

function createAjv() {
  const ajv = new Ajv2020({
    // The frozen if/then branches use `properties` without `type: object`.
    // JSON Schema applies those keywords only when the value is an object.
    // Ajv's strictTypes check rejects the schema before it can validate data.
    strict: true,
    strictTypes: false,
    // `discriminator` is an OpenAPI annotation. It is stripped before compile;
    // this keeps any remaining annotation from failing the build.
    strictSchema: false,
    allErrors: true,
    // Each $ref becomes a call to one shared function. The default inlines
    // every referenced subschema into every validator that uses it.
    inlineRefs: false,
    // One loop per required list or enum, instead of a copy of the error
    // block for every entry. The accept/reject result does not change.
    loopRequired: 1,
    loopEnum: 1,
    code: { source: true, esm: false },
  });
  addFormats(ajv, ['date', 'date-time', 'uri']);
  return ajv;
}

function assertRuntimeRoots(names, roots, label) {
  const known = new Set(names);
  for (const root of roots) {
    if (!known.has(root)) {
      throw new Error(`${label} contract has no ${root} definition.`);
    }
  }
}

// Ajv writes the same vErrors push at every failing keyword. Folding that
// push into one function keeps each error's fields and the allErrors list.
function shareErrorReports(source) {
  let count = 0;
  let out = '';
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('const err', index);
    if (start === -1) {
      out += source.slice(index);
      break;
    }
    const equals = source.indexOf('=', start);
    const name = source.slice(start + 'const '.length, equals).trim();
    if (!/^err\d+$/.test(name)) {
      out += source.slice(index, start + 'const err'.length);
      index = start + 'const err'.length;
      continue;
    }
    const brace = source.indexOf('{', equals);
    const endBrace = endOfObject(source, brace);
    const objectText = source.slice(brace, endBrace + 1);
    const tail = `;if(vErrors === null){vErrors = [${name}];}else {vErrors.push(${name});}errors++;`;
    if (source.slice(endBrace + 1, endBrace + 1 + tail.length) !== tail) {
      out += source.slice(index, start + 'const err'.length);
      index = start + 'const err'.length;
      continue;
    }
    out += source.slice(index, start);
    out += `[errors,vErrors]=reportContractError(vErrors,errors,${objectText});`;
    index = endBrace + 1 + tail.length;
    count += 1;
  }
  if (count === 0 || /const err\d+ =/.test(out)) {
    throw new Error('Ajv error reports were not shared. The standalone pattern changed.');
  }
  return out;
}

function endOfObject(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 1;
        } else if (source[index] === '"') {
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error('Ajv standalone schema object did not close.');
}

function standaloneValidators(ajv, documentId, names, mapName) {
  const refs = {};
  for (const name of names) {
    const id = `${documentId}:validator:${name}`;
    ajv.addSchema({
      $id: id,
      $ref: `${documentId}#/$defs/${name}`,
    });
    refs[`validate${name}`] = id;
  }
  // standaloneCode emits every function this Ajv instance compiled for these
  // roots, once. Shared $defs are calls, not copies.
  const body = shareErrorReports(standaloneCode(ajv, refs));
  const entries = names.map((name) => `  ${name}: exports.validate${name},`).join('\n');
  // The body stays on Ajv's compact lines. Prettier's width would wrap each
  // check onto its own line and put the whitespace back into the phone bundle.
  // The ignore covers only that generated body.
  return `/* eslint-disable */
${HEADER}function reportContractError(vErrors, errors, error) {
  if (vErrors === null) {
    vErrors = [error];
  } else {
    vErrors.push(error);
  }
  return [errors + 1, vErrors];
}

// The wrapper must not take \`require\` as a parameter: Metro only bundles
// calls to the module's own require, and a shadowed one is left unresolved.
// prettier-ignore
(function (exports) {
${body}
exports.${mapName} = {
${entries}
};
})(exports);
`;
}

function validatorDeclarations(names, mapName) {
  const functions = names
    .map((name) => `export const validate${name}: ContractValidator;`)
    .join('\n');
  const fields = names.map((name) => `  readonly ${name}: ContractValidator;`).join('\n');
  return `${HEADER}import type { ContractValidator } from '../validator-types';

${functions}

export const ${mapName}: {
${fields}
};
`;
}

async function generateTypes(schema, name, filename) {
  const source = await compile(schema, name, {
    ...typeOptions,
    cwd: repoRoot,
  });
  if (!source.includes('generated, do not edit')) {
    throw new Error(`${filename} is missing the generated header.`);
  }
  return format(source, filename);
}

export async function generateArtifacts() {
  const { local, wireDefs } = readSources();
  const localDefs = asRecord(local.$defs, 'local $defs');
  const localNames = schemaNames(localDefs);
  const wireNames = schemaNames(wireDefs);
  const localId = local.$id;
  if (typeof localId !== 'string') {
    throw new Error('Local contract is missing a string $id.');
  }

  const localForTypes = schemaForTypes({
    $schema: local.$schema,
    title: 'Local contract',
    description:
      typeof local.description === 'string' ? local.description : 'Local contract',
    additionalProperties: false,
    $defs: localDefs,
  });
  const wireForTypes = schemaForTypes({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Wire contract',
    description:
      'Phone view of the frozen OpenAPI component schemas. Profile and personal state are not in this document.',
    additionalProperties: false,
    $defs: wireDefs,
  });

  const localDocument = stripAnnotations({
    ...local,
    $defs: localDefs,
  });
  const wireDocument = stripAnnotations({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: WIRE_ID,
    $defs: wireDefs,
  });

  assertRuntimeRoots(localNames, LOCAL_RUNTIME_ROOTS, 'local');
  assertRuntimeRoots(wireNames, WIRE_RUNTIME_ROOTS, 'wire');

  // One Ajv instance per document, so every root in that file shares $def
  // functions. Local and wire are different documents, so they stay separate.
  const localAjv = createAjv();
  localAjv.addSchema(localDocument);
  const wireAjv = createAjv();
  wireAjv.addSchema(wireDocument);

  const artifacts = {
    'local.ts': await generateTypes(localForTypes, 'LocalContract', 'local.ts'),
    'wire.ts': await generateTypes(wireForTypes, 'WireContract', 'wire.ts'),
    'validate-local.js': await format(
      standaloneValidators(localAjv, localId, LOCAL_RUNTIME_ROOTS, 'localValidators'),
      'validate-local.js',
    ),
    'validate-wire.js': await format(
      standaloneValidators(wireAjv, WIRE_ID, WIRE_RUNTIME_ROOTS, 'wireValidators'),
      'validate-wire.js',
    ),
    'validate-local.d.ts': await format(
      validatorDeclarations(LOCAL_RUNTIME_ROOTS, 'localValidators'),
      'validate-local.d.ts',
    ),
    'validate-wire.d.ts': await format(
      validatorDeclarations(WIRE_RUNTIME_ROOTS, 'wireValidators'),
      'validate-wire.d.ts',
    ),
  };

  for (const required of ['ProductSnapshot', 'LocalProfile', 'LocalAssessment']) {
    if (!artifacts['local.ts'].includes(required)) {
      throw new Error(`Generated local types are missing ${required}.`);
    }
  }
  for (const required of ['AnalyzeRequest', 'AnalyzeResponse', 'ProductAnalysisInput']) {
    if (!artifacts['wire.ts'].includes(required)) {
      throw new Error(`Generated wire types are missing ${required}.`);
    }
  }
  assertExportedRoots(artifacts['validate-local.js'], LOCAL_RUNTIME_ROOTS, 'local');
  assertExportedRoots(artifacts['validate-wire.js'], WIRE_RUNTIME_ROOTS, 'wire');
  return artifacts;
}

function assertExportedRoots(source, roots, label) {
  for (const root of roots) {
    if (!source.includes(`exports.validate${root} =`)) {
      throw new Error(`Generated ${label} validators do not export ${root}.`);
    }
  }
  const exported = [...source.matchAll(/exports\.validate([A-Za-z0-9]+) =/g)].map(
    (match) => match[1],
  );
  const allowed = new Set(roots);
  for (const name of exported) {
    if (!allowed.has(name)) {
      throw new Error(`Generated ${label} validators export non-root ${name}.`);
    }
  }
}

function isDirectRun() {
  const entry = globalThis.process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isDirectRun()) {
  const artifacts = await generateArtifacts();
  mkdirSync(generatedDir, { recursive: true });
  for (const [name, source] of Object.entries(artifacts)) {
    writeFileSync(join(generatedDir, name), source);
  }
}
