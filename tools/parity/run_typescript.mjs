/** Execute SCI-01 from its public API without editing its source tree. */
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.slice(2).join(' ') !== '--calculation-only') {
  console.error(
    'Use --calculation-only. SCI-01 does not export reviewed scientific reasons; full assessment parity is pending EVD-01.',
  );
  process.exit(2);
}
const temporary = mkdtempSync(join(tmpdir(), 'ingr-ts-parity-'));
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
        skipLibCheck: true,
        types: [],
        ignoreDeprecations: '6.0',
        rootDir: root,
        outDir: output,
      },
      files: [join(root, 'src/domain/scientific/index.ts')],
    }),
  );
  const compiled = spawnSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--project', config],
    { cwd: root, encoding: 'utf8' },
  );
  if (compiled.error || compiled.status !== 0) {
    console.error(compiled.error?.message ?? compiled.stdout + compiled.stderr);
    process.exitCode = 2;
  } else {
    const require = createRequire(import.meta.url);
    const { calculateNutriScore } = require(
      join(output, 'src/domain/scientific/index.js'),
    );
    const vectors = JSON.parse(
      readFileSync(
        join(root, 'resources/vectors/nutriscore-vectors.json'),
        'utf8',
      ),
    ).vectors;
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
      const assessment =
        actual.state === 'graded'
          ? {
              state: actual.state,
              grade: actual.grade,
              score: actual.score,
              route: actual.route,
              method: actual.method,
              issues: actual.issues,
              components: actual.trace
                .map(({ component, points }) => ({ component, points }))
                .sort((a, b) =>
                  a.component < b.component
                    ? -1
                    : a.component > b.component
                      ? 1
                      : 0,
                ),
            }
          : { state: actual.state, issues: actual.issues };
      console.log(
        JSON.stringify({ id: vector.id, scope: 'calculation', assessment }),
      );
    }
  }
} finally {
  // Verify the resolved target before recursively removing only this run's folder.
  if (
    dirname(resolve(temporary)) !== resolve(tmpdir()) ||
    !basename(temporary).startsWith('ingr-ts-parity-')
  ) {
    throw new Error('Unexpected parity compilation directory.');
  }
  rmSync(temporary, { recursive: true, force: true });
}
