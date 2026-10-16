// Builds src/domain/ingredients/generated/additive-names.json from the pinned
// Open Food Facts additives taxonomy (resources/taxonomy/additives.txt).
//
// Only identity is kept: the English name and the functional classes. No
// health, safety or evaluation text is copied, so the app never shows an
// uncited health claim from this table.
//
// Usage: node tools/resources/build_additive_names.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourcePath = join(root, 'resources', 'taxonomy', 'additives.txt');
const manifest = JSON.parse(
  readFileSync(join(root, 'resources', 'manifest.json'), 'utf8'),
);
const bundle = manifest.bundles.find((b) => b.bundleId === 'off-taxonomy-additives');
const raw = readFileSync(sourcePath);
const sha256 = createHash('sha256').update(raw).digest('hex');
if (bundle && bundle.sha256 !== sha256) {
  throw new Error(`additives.txt hash ${sha256} does not match the manifest.`);
}

const CLASS_NAMES = {
  'en:acid': 'acid',
  'en:acidity-regulator': 'acidity regulator',
  'en:anti-caking-agent': 'anti-caking agent',
  'en:anti-foaming-agent': 'anti-foaming agent',
  'en:antioxidant': 'antioxidant',
  'en:bulking-agent': 'bulking agent',
  'en:colour': 'colour',
  'en:emulsifier': 'emulsifier',
  'en:firming-agent': 'firming agent',
  'en:flavour-enhancer': 'flavour enhancer',
  'en:flour-treatment-agent': 'flour treatment agent',
  'en:gelling-agent': 'gelling agent',
  'en:glazing-agent': 'glazing agent',
  'en:humectant': 'humectant',
  'en:preservative': 'preservative',
  'en:propellent-gas': 'propellant gas',
  'en:raising-agent': 'raising agent',
  'en:sequestrant': 'sequestrant',
  'en:stabiliser': 'stabiliser',
  'en:sweetener': 'sweetener',
  'en:thickener': 'thickener',
};

const names = {};
const entries = raw.toString('utf8').split(/\r?\n\r?\n/);
for (const entry of entries) {
  const lines = entry.split(/\r?\n/);
  const en = lines.find((line) => /^en: E\d/.test(line));
  if (!en) {
    continue;
  }
  const parts = en
    .slice(4)
    .split(/(?<!\\),/)
    .map((part) => part.replace(/\\,/g, ',').trim());
  const codeMatch = /^E(\d{3,4}[a-z]?(?:\([ivx]+\))?)$/i.exec(parts[0] ?? '');
  if (!codeMatch || !parts[1]) {
    continue;
  }
  const classesLine = lines.find((line) => line.startsWith('additives_classes:en:'));
  const classes = classesLine
    ? classesLine
        .slice('additives_classes:en:'.length)
        .split(',')
        .map((tag) => CLASS_NAMES[tag.trim()])
        .filter(Boolean)
    : [];
  names[codeMatch[1].toLowerCase()] = { name: parts[1], classes };
}

const output = {
  source: bundle?.sourceUrl ?? 'resources/taxonomy/additives.txt',
  sha256,
  licence: bundle?.licence ?? 'ODbL v1.0',
  attribution: bundle?.attribution ?? 'Open Food Facts contributors',
  count: Object.keys(names).length,
  names,
};
const target = join(root, 'src', 'domain', 'ingredients', 'generated', 'additive-names.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(output) + '\n');
console.log(`Wrote ${output.count} additive names to ${target}`);
