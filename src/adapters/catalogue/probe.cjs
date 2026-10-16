// Development probe only. Run the actual adapter in Node without native Jest mocks.
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (loadedModule, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  loadedModule._compile(compiled.outputText, filename);
};

const { createCatalogueAdapter } = require('./off-adapter.ts');
const barcode = process.argv[2] ?? '3274080005003';

async function main() {
  const result = await createCatalogueAdapter({
    baseUrl: 'https://world.openfoodfacts.net',
    userAgent: 'Ingradient/0.1 (https://github.com/vekhyat/ingradient)',
    // OFF publishes these staging credentials in its API deployment guide:
    // https://openfoodfacts.github.io/openfoodfacts-server/api/#api-deployments
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...init?.headers, Authorization: 'Basic b2ZmOm9mZg==' },
      }),
    timeoutMs: 20000,
  }).lookupBarcode(barcode);

  const summary =
    result.state === 'found'
      ? {
          environment: 'Open Food Facts staging',
          state: result.state,
          barcode: result.snapshot.barcode,
          name: result.snapshot.name,
          observedFields: result.snapshot.observations.map((item) => ({
            field: item.field,
            kind: item.kind,
            basis: item.basis,
          })),
          sources: result.snapshot.sourceRefs,
        }
      : result;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (result.state !== 'found') process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
