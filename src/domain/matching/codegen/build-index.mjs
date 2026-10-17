/**
 * Builds src/domain/matching/generated/taxonomy-index.json from the pinned
 * Open Food Facts ingredients and additives taxonomies (resources/taxonomy/).
 *
 * Run from the repository root: node src/domain/matching/codegen/build-index.mjs
 *
 * Only identity is kept: each entry's own English and language-neutral (xx)
 * names, which the taxonomy states are the same thing. Parent lines (`<`),
 * global `synonyms:` word groups and every property (descriptions, health,
 * NOVA, vegan) are dropped, so a parent, origin or related term never becomes
 * an alias. The match-time key normalisation lives in normalise-key.mjs and
 * is shared with the app code.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseKey } from './normalise-key.mjs';

const require = createRequire(import.meta.url);
const prettier = require('prettier');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const outPath = join(here, '..', 'generated', 'taxonomy-index.json');

const NAME_LANGUAGES = new Set(['en', 'xx']);
const NAME_LINE = /^([a-z]{2}):\s*(.*)$/;

function readPinned(manifest, bundleId) {
  const bundle = manifest.bundles.find((entry) => entry.bundleId === bundleId);
  if (!bundle) {
    throw new Error(`resources/manifest.json has no bundle ${bundleId}.`);
  }
  const raw = readFileSync(join(root, 'resources', bundle.path));
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== bundle.sha256) {
    throw new Error(
      `${bundle.path} hash ${sha256} does not match the manifest.`,
    );
  }
  return { bundle, text: raw.toString('utf8') };
}

/** Splits a name line on commas that are not escaped as `\,`. */
function splitNames(value) {
  return value
    .split(/(?<!\\),/)
    .map((name) => name.replace(/\\,/g, ',').trim())
    .filter((name) => name.length > 0);
}

/** OFF-style id: language prefix plus a lowercase hyphenated first name. */
function canonicalId(language, firstName, kind) {
  if (kind === 'additive') {
    const code = /^E\s?(\d{3,4}[a-z]?)(?:\(([ivx]+)\))?$/i.exec(firstName);
    if (code) {
      return `en:e${code[1].toLowerCase()}${code[2] ? `(${code[2].toLowerCase()})` : ''}`;
    }
  }
  const slug = firstName.toLowerCase().replace(/ /g, '-');
  return slug.length > 0 ? `${language}:${slug}` : null;
}

function parseEntries(text, kind) {
  const entries = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const names = [];
    let id = null;
    for (const line of block.split(/\r?\n/)) {
      const match = NAME_LINE.exec(line);
      if (!match) {
        continue;
      }
      const [, language, value] = match;
      const lineNames = splitNames(value);
      if (lineNames.length === 0) {
        continue;
      }
      if (language === 'en' && id === null) {
        id = canonicalId(language, lineNames[0], kind);
      }
      if (NAME_LANGUAGES.has(language)) {
        names.push(...lineNames);
      }
    }
    if (id !== null && names.length > 0) {
      entries.push({ id, names });
    }
  }
  return entries;
}

function buildScope(entries) {
  const keys = new Map();
  for (const { id, names } of entries) {
    for (const name of names) {
      const key = normaliseKey(name);
      if (key.length === 0) {
        continue;
      }
      const ids = keys.get(key) ?? new Set();
      ids.add(id);
      keys.set(key, ids);
    }
  }
  const sorted = [...keys.keys()].sort();
  return Object.fromEntries(
    sorted.map((key) => [key, [...keys.get(key)].sort()]),
  );
}

export async function generateIndex() {
  const manifest = JSON.parse(
    readFileSync(join(root, 'resources', 'manifest.json'), 'utf8'),
  );
  const ingredients = readPinned(manifest, 'off-taxonomy-ingredients');
  const additives = readPinned(manifest, 'off-taxonomy-additives');
  const index = {
    note: 'generated, do not edit; node src/domain/matching/codegen/build-index.mjs',
    manifestRevision: manifest.revision,
    sources: [ingredients.bundle, additives.bundle].map((bundle) => ({
      bundleId: bundle.bundleId,
      sha256: bundle.sha256,
      sourceUrl: bundle.sourceUrl,
      licence: bundle.licence,
      attribution: bundle.attribution,
    })),
    languages: [...NAME_LANGUAGES],
    ingredient: buildScope(parseEntries(ingredients.text, 'ingredient')),
    additive: buildScope(parseEntries(additives.text, 'additive')),
  };
  return prettier.format(JSON.stringify(index), { parser: 'json' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, await generateIndex());
  console.log(`wrote ${outPath}`);
}
