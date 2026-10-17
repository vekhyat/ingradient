/** Export actual SCI/EVD results; no expected assessment data supplies outputs. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = mkdtempSync(join(tmpdir(), 'ingr-evidence-export-'));
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
      files: [
        join(root, 'src/domain/scientific/index.ts'),
        join(root, 'src/domain/evidence/index.ts'),
      ],
    }),
  );
  const compiled = spawnSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--project', config],
    { cwd: root, encoding: 'utf8' },
  );
  if (compiled.error || compiled.status !== 0)
    throw new Error(
      compiled.error?.message ?? compiled.stdout + compiled.stderr,
    );
  const require = createRequire(import.meta.url);
  const { calculateNutriScore } = require(
    join(output, 'src/domain/scientific/index.js'),
  );
  const { renderScientificAssessment } = require(
    join(output, 'src/domain/evidence/index.js'),
  );
  const { vectors } = JSON.parse(
    readFileSync(
      join(root, 'resources/vectors/nutriscore-vectors.json'),
      'utf8',
    ),
  );
  for (const vector of vectors) {
    const { category, flags, observations } = vector.inputs;
    const facts = Object.fromEntries(
      Object.entries(flags).map(([key, value]) => [
        key,
        typeof value === 'boolean' ? (value ? 'present' : 'absent') : value,
      ]),
    );
    const nutrients = Object.fromEntries(
      observations.map(({ field, value, unit, basis }) => [
        field,
        { value, unit, basis },
      ]),
    );
    const actual = calculateNutriScore({ category, facts, nutrients });
    // Fixture identity alone is copied; arithmetic/text/trace all come from real modules.
    const rendered = renderScientificAssessment(
      actual,
      vector.expectedAssessment.inputSnapshotId,
    );
    process.stdout.write(
      JSON.stringify({
        id: vector.id,
        scope: 'full-assessment',
        assessment: rendered.scientific,
      }) + '\n',
    );
  }
} finally {
  if (
    dirname(resolve(temporary)) !== resolve(tmpdir()) ||
    !basename(temporary).startsWith('ingr-evidence-export-')
  )
    throw new Error('Unexpected evidence export directory');
  rmSync(temporary, { recursive: true, force: true });
}
