/**
 * PoC harness — replays one recorded intent script against the baseline and
 * five mutated versions of the same page, under three replay strategies, and
 * prints the result matrix.
 *
 * Usage:  node run-poc.mjs [--arms selector-only,intent-deterministic,intent-full]
 * Env:    SPIKE_MODEL=haiku|sonnet   (transport is the local `claude -p` CLI)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from './lib/server.mjs';
import { replay, grade } from './lib/replay.mjs';
import { ARMS } from './lib/resolve.mjs';
import { BANNED_IN_SNAPSHOT } from './lib/snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = JSON.parse(fs.readFileSync(path.join(HERE, 'recorded', 'settlement-filing.intent.json'), 'utf8'));
const INPUTS = { vendor: '한빛유통', amount: '30000' };

const VARIANTS = [
  ['V0 baseline', 'v0-baseline.html'],
  ['M1 selector churn (id/class hashed)', 'v1-selector-churn.html'],
  ['M2 + copy churn (labels/button reworded)', 'v2-copy-churn.html'],
  ['M3 + structural churn (wrappers, reorder)', 'v3-structural-churn.html'],
  ['M4 + field renames + decoy field', 'v4-full-churn.html'],
  ['M5 id reuse (old #budget = prepayment box)', 'v5-id-reuse.html'],
];

const argArms = process.argv.includes('--arms')
  ? process.argv[process.argv.indexOf('--arms') + 1].split(',')
  : Object.keys(ARMS);

// Guard: the recording must not contain the fixtures' behaviour anchors.
// If it did, every result below would be worthless.
const recordedJson = JSON.stringify(SCRIPT);
for (const banned of BANNED_IN_SNAPSHOT) {
  if (recordedJson.includes(banned)) {
    throw new Error(`recording leaked "${banned}" — resolvers could cheat; aborting`);
  }
}

const server = await startFixtureServer();
const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];
const traces = {};

try {
  for (const arm of argArms) {
    for (const [label, file] of VARIANTS) {
      const page = await browser.newPage();
      await page.goto(`${server.origin}/${file}`);
      const trace = await replay(page, SCRIPT, { arm, inputs: INPUTS });
      const g = grade(trace, INPUTS);
      const tiers = trace.steps.map((s) => `${s.id}:${s.tier ?? '—'}`).join(' ');
      rows.push({ arm, variant: label, verdict: g.verdict, tiers, detail: g.detail });
      traces[`${arm} | ${label}`] = trace;
      console.log(`[${arm}] ${label}\n    ${g.verdict}  (${tiers})\n    ${g.detail}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

// ── matrix ───────────────────────────────────────────────────────
const armList = argArms;
const w = Math.max(...VARIANTS.map(([l]) => l.length));
console.log('\n' + 'VARIANT'.padEnd(w) + ' | ' + armList.map((a) => a.padEnd(20)).join(' | '));
console.log('-'.repeat(w) + '-+-' + armList.map(() => '-'.repeat(20)).join('-+-'));
for (const [label] of VARIANTS) {
  const cells = armList.map((a) => (rows.find((r) => r.arm === a && r.variant === label)?.verdict || '—').padEnd(20));
  console.log(label.padEnd(w) + ' | ' + cells.join(' | '));
}

const modelCalls = Object.values(traces).flatMap((t) => t.model);
if (modelCalls.length) {
  const ms = modelCalls.map((c) => c.ms);
  console.log(`\nmodel calls: ${modelCalls.length}, median ${ms.sort((a, b) => a - b)[ms.length >> 1]}ms`);
}

fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'results.json'), JSON.stringify({ rows, traces }, null, 2) + '\n');
console.log(`\nfull traces -> out/results.json`);
