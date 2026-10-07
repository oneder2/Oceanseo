import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

const execute = promisify(execFile);
const session = process.argv[2] ?? 'quality-audit';
const label = process.argv[3] ?? 'after';
assert.match(label, /^[a-z-]+$/);
const wrapper = '/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh';
const cli = async (...args) => (await execute('bash', [wrapper, `-s=${session}`, ...args], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 })).stdout;
const owned = !process.argv[2] && !process.argv.includes('--capture');
try {
  if (owned) await cli('open', 'http://127.0.0.1:1439');
  if (!process.argv.includes('--capture')) await cli('run-code', '--filename=scripts/ui-quality-audit.js');
  const evidence = JSON.parse(await cli('eval', '() => window.__uiQualityEvidence', '--raw'));
  assert.equal(evidence.samples.length, 72);
  const overflow = evidence.samples.filter(s => s.workspaceScroll > s.workspaceClient + 1 || s.documentWidth > s.width + 1);
  const tiny = evidence.samples.filter(s => s.smallText.length);
  await mkdir('output/playwright', { recursive: true });
  await writeFile(`output/playwright/ui-quality-${label}.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ label, samples: evidence.samples.length, overflow: overflow.map(s => ({ name: s.name, width: s.width })),
    tinyTextSamples: tiny.length, mobileSmallTargets: evidence.samples.filter(s => s.mobile).reduce((n, s) => n + s.narrowTargets.length, 0), errors: evidence.errors }));
  if (label === 'after') {
    assert.equal(overflow.length, 0, 'Workspace overflow remains');
    assert.equal(tiny.length, 0, 'Visible text below 12px remains');
    assert.equal(evidence.samples.filter(s => s.mobile).reduce((n, s) => n + s.narrowTargets.length, 0), 0, 'Small mobile targets remain');
    assert.deepEqual(evidence.errors, []);
  }
} finally {
  if (owned) await cli('close');
}
