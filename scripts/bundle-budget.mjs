import assert from 'node:assert/strict';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const loaded = new Set();
function initial(key) {
  if (loaded.has(key)) return;
  const chunk = manifest[key];
  assert.ok(chunk, `Missing chunk ${key}`);
  loaded.add(key);
  for (const dependency of chunk.imports ?? []) initial(dependency);
}
// main dynamically imports App on every startup; tool and motion chunks do not.
initial('index.html');
const appEntries = (manifest['index.html'].dynamicImports ?? []).filter(key => manifest[key]?.name === 'App');
assert.equal(appEntries.length, 1, 'Expected one startup App chunk');
initial(appEntries[0]);
const assets = [];
for (const key of loaded) {
  const chunk = manifest[key];
  if (!chunk.file.endsWith('.js')) continue;
  const source = await readFile(`dist/${chunk.file}`);
  assets.push({ key, file: chunk.file, bytes: (await stat(`dist/${chunk.file}`)).size, gzipBytes: gzipSync(source).length });
}
const bytes = assets.reduce((n, asset) => n + asset.bytes, 0);
const gzipBytes = assets.reduce((n, asset) => n + asset.gzipBytes, 0);
const evidence = { assets, bytes, gzipBytes, budgets: { bytes: 480 * 1024, gzipBytes: 160 * 1024 },
  deferred: ['BeadStudio', 'WorkMonitorDashboard', 'TravelPage', 'gsap'].map(name => {
    const keys = Object.keys(manifest).filter(key => manifest[key].name === name || (name === 'gsap' && manifest[key].src?.includes('/gsap/')));
    assert.ok(keys.length, `Missing deferred chunk ${name}`);
    return { name, keys, startup: keys.some(key => loaded.has(key)) };
  }),
  scope: 'Startup JavaScript transfer/parse size, not APK size, native cold start, CPU time or CSS/fonts' };
await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/bundle-budget.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
assert.ok(bytes <= evidence.budgets.bytes && gzipBytes <= evidence.budgets.gzipBytes, 'Startup JS budget exceeded');
assert.ok(evidence.deferred.every(item => !item.startup), 'Heavy tools leaked into startup');
