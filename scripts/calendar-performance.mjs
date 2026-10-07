import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const result = await build({ entryPoints: ['src/calendarEvents.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { calendarEventIndex } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const samples = [];
for (const count of [100, 1000, 10000]) {
  const tasks = Array.from({ length: count }, (_, i) => ({ id: String(i), title: 'Synthetic calendar benchmark',
    startDate: `2026-10-${String(i % 28 + 1).padStart(2, '0')}`, dueDate: `2026-10-${String((i + 3) % 28 + 1).padStart(2, '0')}`, completedAt: null }));
  const durations = [];
  for (let round = 0; round < 31; round++) {
    const start = performance.now();
    const index = calendarEventIndex(tasks, []);
    assert.equal([...index.values()].reduce((n, events) => n + events.length, 0), count * 2);
    if (round) durations.push(performance.now() - start);
  }
  samples.push({ tasks: count, rounds: durations.length, indexP95Ms: p95(durations), events: count * 2 });
}
const evidence = { actualNative: false, browserRender: false, engine: process.version, scope: 'Node calendar index CPU only; excludes rendering, IPC, storage and network', samples };
await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/calendar-performance.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
