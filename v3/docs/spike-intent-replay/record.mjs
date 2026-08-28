/**
 * RECORD — produce an intent script from a human session on the baseline page.
 *
 * The "human" here is a scripted Playwright session against V0 (trusted DOM
 * events, same capture path a real person's clicks take). What matters is the
 * artifact: the recorder writes down BOTH the intent of each step and the
 * selectors as *hints*, never as the sole address of an element.
 *
 * Output: recorded/settlement-filing.intent.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from './lib/server.mjs';
import { RECORDER_HOOK } from './lib/recorder-hook.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'recorded', 'settlement-filing.intent.json');

/**
 * Turn raw captured events into intent steps. In production a model writes the
 * `intent` / `description` prose from the captured context and the human edits
 * it in a review screen; here it is generated deterministically from the label
 * and group the recorder saw ON V0, so nothing about the mutated pages can leak
 * into the recording.
 */
function toSteps(raw, bindings) {
  return raw.map((ev, i) => {
    const name = ev.accessibleName || ev.hints.text || ev.hints.attrs.name;
    const where = ev.group ? `'${ev.group}' 그룹의 ` : '';
    const bind = bindings[name];

    const step = {
      id: `s${i + 1}`,
      kind: ev.kind,
      intent:
        ev.kind === 'click'
          ? `${where}'${name}' 버튼을 누른다`
          : ev.kind === 'select'
            ? `${where}'${name}' 선택칸에서 거래처를 고른다`
            : `${where}'${name}' 입력칸에 값을 넣는다`,
      target: {
        description:
          ev.kind === 'click'
            ? `'${name}' 라고 적힌, 폼을 제출하는 기본 버튼`
            : `'${name}' 라벨이 붙은 ${ev.role === 'combobox' ? '선택칸' : '입력칸'}`,
        role: ev.role,
        name,
        hints: ev.hints,
      },
      onResolveFail: 'escalate',
    };

    if (ev.kind !== 'click') {
      step.value = bind ? { from: 'input', ref: bind } : { from: 'literal', text: ev.value };
      step.verify = { kind: 'valueEquals', expect: bind ? `{{${bind}}}` : ev.value };
    }
    return step;
  });
}

const server = await startFixtureServer();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.addInitScript(RECORDER_HOOK);
  const startUrl = `${server.origin}/v0-baseline.html`;
  await page.goto(startUrl);

  // ── the recorded human session ────────────────────────────────
  await page.selectOption('#vendor', '한빛유통');
  await page.fill('#budget', '30000');
  await page.fill('#memo', '8월 정산');
  await page.click('#submit-btn');
  await page.waitForFunction(() => document.querySelector('#result').dataset.state === 'ok');
  // ──────────────────────────────────────────────────────────────

  const raw = await page.evaluate(() => window.__spikeRec);
  const resultText = await page.textContent('#result');

  const script = {
    schemaVersion: '1.0',
    id: 'flow_settlement_filing',
    name: '정산 등록',
    recordedAt: new Date().toISOString(),
    origin: server.origin,
    startUrl,
    inputs: [
      { name: 'vendor', type: 'string', example: '한빛유통', required: true },
      { name: 'amount', type: 'string', example: '30000', required: true },
    ],
    steps: toSteps(raw, { 거래처: 'vendor', '정산 금액': 'amount' }),
    outcome: {
      kind: 'textContains',
      description: "'처리 결과' 영역의 본문",
      hints: { css: '#result' },
      expect: '등록 완료',
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(script, null, 2) + '\n');
  console.log(`recorded ${script.steps.length} steps -> ${path.relative(HERE, OUT)}`);
  console.log(`baseline outcome: ${resultText}`);
} finally {
  await browser.close();
  await server.close();
}
