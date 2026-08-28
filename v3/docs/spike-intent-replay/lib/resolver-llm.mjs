/**
 * Tier 3 — the model resolver. Every recorded hint has missed; the only thing
 * left is the step's stated intent plus a snapshot of what is on screen now.
 *
 * Transport for the spike is the local `claude -p` CLI (no product wiring, no
 * new dependency, no network call to a target site). Production would route
 * this through the existing credit proxy; the interface is the same —
 *   (intent, description, role, snapshot) -> ref | NONE
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderSnapshot } from './snapshot.mjs';

const execFileAsync = promisify(execFile);
const MODEL = process.env.SPIKE_MODEL || 'haiku';

export function buildPrompt(step, nodes) {
  return [
    '너는 웹 자동화 재생기다. 아래 "단계"가 가리키는 요소를 현재 화면에서 다시 찾아라.',
    '녹화 당시의 셀렉터는 사이트가 바뀌어 더 이상 맞지 않는다.',
    '',
    '## 단계',
    `의도: ${step.intent}`,
    `대상 설명: ${step.target.description}`,
    `대상 역할(role): ${step.target.role}`,
    '',
    '## 현재 화면의 조작 가능한 요소',
    renderSnapshot(nodes),
    '',
    '## 규칙',
    '- 위 목록의 ref 하나만 고른다. 뜻이 같은 것이 없으면 NONE.',
    '- 문구가 조금 달라도 같은 뜻이면 고른다 (예: "정산 금액" ≈ "정산액").',
    '- 비슷해 보이지만 다른 항목(예: 선결제액 vs 정산액)을 고르지 않도록 주의한다.',
    '- 설명이나 이유를 쓰지 마라. @e숫자 또는 NONE 한 토큰만 출력한다.',
  ].join('\n');
}

export async function resolveWithModel(step, nodes, { attempts = 2 } = {}) {
  const prompt = buildPrompt(step, nodes);
  const tries = [];

  for (let i = 0; i < attempts; i++) {
    const started = Date.now();
    let raw = '';
    try {
      const { stdout } = await execFileAsync(
        'claude',
        ['-p', '--model', MODEL, '--output-format', 'text', prompt],
        { timeout: 120_000, maxBuffer: 1 << 22 }
      );
      raw = stdout.trim();
    } catch (err) {
      raw = `ERROR: ${String(err).slice(0, 160)}`;
    }
    const ms = Date.now() - started;
    const m = raw.match(/@e\d+/);
    const ref = m && nodes.some((n) => n.ref === m[0]) ? m[0] : null;
    tries.push({ raw, ref, ms });
    // A bare NONE or a transport error is retried once: the model tier is
    // nondeterministic and a single sample is not a verdict. Measured
    // separately in out/reliability.json.
    if (ref) return { ref, raw, ms, tries, prompt };
  }
  const last = tries[tries.length - 1];
  return { ref: null, raw: last.raw, ms: last.ms, tries, prompt };
}
