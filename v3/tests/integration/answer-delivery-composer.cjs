#!/usr/bin/env node
// 답 전달의 실측 (티켓 igGI6QpXkEfrkkKN3rU0).
//
// 이 티켓의 1번 완료 기준은 "전달 유실 가설을 **재현으로** 확인" 이다. 오케는
// 55분 공백을 "에이전트가 안 움직였다" 로 읽었지만, answer_question 의 전달도
// 결국 writeAndSubmit 으로 PTY stdin 에 text+CR 을 쓴다 — 그 순간 컴포저가 어떤
// 상태였느냐에 따라 답이 섞이거나, 제출조차 안 되거나, 다이얼로그를 확정한다.
//
// 그래서 이 하네스는 **진짜 PTY** 를 띄우고 **진짜 writeAndSubmit** 을 걸어,
// 화면이 아니라 **에이전트가 실제로 받은 페이로드**를 잰다(fixtures/
// fake-composer-tui.cjs 의 <<<SUBMIT:...>>> 관측 프로토콜).
//
// #1157 의 probe-noninvasive.cjs 와 같은 계보다: 기각/채택이 취향이 아니라
// 실측 결과였음을 코드로 남긴다.
//
//   빌드 먼저:  npx tsc -p electron/tsconfig.json
//   실행:       ~/.nvm/versions/node/v22.13.0/bin/node \
//                 tests/integration/answer-delivery-composer.cjs
//   npm script: npm run test:answer-delivery
"use strict";

const path = require("path");
const assert = require("assert");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== "darwin") {
  console.log(
    `SKIP: 답 전달 실측은 macOS 전용 (platform=${process.platform}).`,
  );
  process.exit(0);
}

const DIST = path.join(__dirname, "..", "..", "dist-electron");
let PtyManager;
try {
  ({ PtyManager } = require(path.join(DIST, "pty-manager.js")));
} catch (err) {
  console.error(
    `FAIL: dist-electron 를 못 읽었다 — 먼저 빌드하세요:\n` +
      `  npx tsc -p electron/tsconfig.json\n${err && err.message}`,
  );
  process.exit(1);
}

const TUI = path.join(__dirname, "..", "fixtures", "fake-composer-tui.cjs");

/** PtyManager.onSubmitOutcome 로 흘러나온 3분기 판정을 모은다. */
const observations = [];
/** 이 세션에 대한 마지막 판정. */
function lastOutcome(id) {
  for (let i = observations.length - 1; i >= 0; i--) {
    if (observations[i].sessionId === id) return observations[i];
  }
  return null;
}

// 실제 전달 본문과 같은 모양(question-channel.formatAnswerDelivery).
const ANSWER = [
  "[답변 도착] question_id=T1#q7 (task=T1, from=orchestrator)",
  "- 질문: 규칙 배포해도 됩니까?",
  "",
  "네, 배포하세요.",
  "",
  "이 답을 반영해 막혔던 부분을 이어서 진행하세요.",
].join("\n");

// ── 관측 유틸 ────────────────────────────────────────────────────────────

/** 세션의 stdout 을 모으면서 관측 마커를 파싱한다. */
function observe(pty, id) {
  const o = { text: "", submits: [], emptySubmits: 0, dialogs: [] };
  pty.onData(id, (chunk) => {
    o.text += chunk;
    for (const m of chunk.matchAll(/<<<SUBMIT:(.*?)>>>/gs)) {
      try {
        o.submits.push(JSON.parse(m[1]));
      } catch {
        o.submits.push(m[1]);
      }
    }
    for (const m of chunk.matchAll(/<<<DIALOG:(.*?)>>>/gs)) {
      try {
        o.dialogs.push(JSON.parse(m[1]));
      } catch {
        o.dialogs.push(m[1]);
      }
    }
    o.emptySubmits += (chunk.match(/<<<EMPTYSUBMIT>>>/g) || []).length;
  });
  return o;
}

/** fixture 가 뜰 때까지 기다린다. */
async function waitReady(o, maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (o.text.includes("<<<READY>>>")) return;
    await sleep(25);
  }
  throw new Error("fixture 가 READY 를 안 뱉었다 — 하네스 문제");
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err && err.message });
    console.log(`  FAIL  ${name}\n        ${err && err.message}`);
  }
}

const facts = [];
function fact(line) {
  facts.push(line);
  console.log(`   · ${line}`);
}

/** fixture 세션을 하나 띄운다. */
async function spawnTui(pty, id, flags = []) {
  pty.create(id, id, process.execPath, [TUI, ...flags], process.cwd());
  const o = observe(pty, id);
  await waitReady(o);
  await sleep(150);
  return o;
}

// ── S1 — 대조군: 빈 컴포저 ────────────────────────────────────────────────
// 정상 경로. 답이 그대로, 한 번, 온전히 제출된다.
async function s1EmptyComposer(pty) {
  const id = "ans-empty";
  const o = await spawnTui(pty, id);

  const t0 = Date.now();
  const ok = await pty.writeAndSubmit(id, ANSWER);
  const elapsed = Date.now() - t0;
  await sleep(400);

  fact(
    `S1 빈 컴포저: writeAndSubmit=${ok}, ${elapsed}ms, 제출 ${o.submits.length}건`,
  );

  check("S1: 빈 컴포저에서는 답이 정확히 1회 제출된다", () => {
    assert.strictEqual(o.submits.length, 1, `제출 ${o.submits.length}건`);
  });
  check("S1: ★제출된 페이로드가 답 원문과 바이트 단위로 같다", () => {
    assert.strictEqual(o.submits[0], ANSWER);
  });
  check("S1: writeAndSubmit 이 true 를 돌려준다", () => {
    assert.strictEqual(ok, true);
  });
  check("S1: ★관측 판정 = confirmed (CR 1회, 스트림이 차가웠다)", () => {
    const o2 = lastOutcome(id);
    assert.ok(o2, "판정이 관측되지 않았다");
    assert.strictEqual(o2.outcome, "confirmed");
    assert.strictEqual(o2.attempts, 1);
    assert.strictEqual(o2.streamHotBeforeCr, false);
  });

  pty.kill(id);
}

// ── S2 — ★본론: 컴포저에 초안이 물려 있다 ────────────────────────────────
// #1157 S2-대조군은 "빈 텍스트 + CR 이 초안을 제출한다" 까지 보였다. 여기서는
// 한 걸음 더 간다: **답 본문을 주입하면 어떻게 되는가**.
async function s2DraftInComposer(pty) {
  const id = "ans-draft";
  const o = await spawnTui(pty, id);

  // 에이전트/사람이 쓰다 만 초안 — 엔터는 안 눌렀다.
  const DRAFT = "아직 쓰는 중인 초안입니다";
  pty.write(id, DRAFT);
  await sleep(250);

  check("S2: 초안 단계에서는 아직 아무것도 제출되지 않았다", () => {
    assert.strictEqual(o.submits.length, 0);
  });

  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(400);

  fact(
    `S2 초안 물림: writeAndSubmit=${ok}, 제출 ${o.submits.length}건, ` +
      `첫 제출 접두 ${JSON.stringify((o.submits[0] || "").slice(0, 24))}`,
  );

  check("S2: 제출은 여전히 1회다 — 답이 따로 도착하지 않는다", () => {
    assert.strictEqual(o.submits.length, 1, `제출 ${o.submits.length}건`);
  });

  check(
    "S2: ★답이 초안과 **한 덩어리로 섞여** 제출된다 (전달 오염 실증)",
    () => {
      assert.strictEqual(
        o.submits[0],
        DRAFT + ANSWER,
        "초안+답 결합이 아니다 — 모형 가정이 깨졌다",
      );
    },
  );

  check(
    "S2: ★에이전트가 받은 것은 답 원문이 아니다 (원문 그대로는 절대 안 온다)",
    () => {
      assert.ok(
        !o.submits.includes(ANSWER),
        "답 원문이 온전히 도착했다 — 오염이 없다",
      );
    },
  );

  check("S2: 그런데도 writeAndSubmit 은 성공(true)을 보고한다", () => {
    assert.strictEqual(ok, true);
  });

  check(
    "S2: ★판정은 confirmed 다 — '제출됐다'는 '올바로 전달됐다'가 아니다",
    () => {
      // 턴은 실제로 시작됐으므로 confirmed 가 맞다. 이 축이 잡는 것은 제출
      // 여부이지 페이로드 무결성이 아니다 — 오염은 별개 문제로 남는다.
      const o2 = lastOutcome(id);
      assert.ok(o2);
      assert.strictEqual(o2.outcome, "confirmed");
    },
  );

  pty.kill(id);
}

// ── S3 — ★핵심: 턴 중(busy) 에이전트에 CR 이 안 먹힐 때 ──────────────────
//
// SUBMIT_SIGNAL 은 /esc to interrupt|스피너|tokens)/ 다. 턴 중인 에이전트는 그
// 문자열을 **상시** 그린다. 그래서 우리 CR 이 제출을 시켰는지와 무관하게
// submitWithRetry 는 첫 시도에 reacted=true 를 본다.
//   → 제출 0건인데 delivered=true. 재시도조차 돌지 않는다.
async function s3BusyFalsePositive(pty) {
  const id = "ans-busy";
  const o = await spawnTui(pty, id, ["--busy", "--ignore-cr"]);

  const t0 = Date.now();
  const ok = await pty.writeAndSubmit(id, ANSWER);
  const elapsed = Date.now() - t0;
  await sleep(400);

  fact(
    `S3 busy+CR무시: writeAndSubmit=${ok}, ${elapsed}ms, 제출 ${o.submits.length}건`,
  );

  check("S3: ★답은 단 한 번도 제출되지 않았다 (에이전트는 못 봤다)", () => {
    assert.strictEqual(o.submits.length, 0, `제출 ${o.submits.length}건`);
  });

  check("S3: ★그런데 writeAndSubmit 은 true — 전달됨으로 기록된다", () => {
    assert.strictEqual(ok, true);
  });

  check(
    "S3: ★판정 = indeterminate — 스피너를 우리 CR 의 반응으로 귀속하지 않는다",
    () => {
      const o2 = lastOutcome(id);
      assert.ok(o2, "판정이 관측되지 않았다");
      assert.strictEqual(o2.outcome, "indeterminate");
      assert.strictEqual(o2.streamHotBeforeCr, true);
    },
  );

  check(
    "S3: ★CR 예산을 끝까지 쓴다 — 오탐 조기종료가 사라졌다(회귀 가드)",
    () => {
      // 종전 동작: 첫 시도에 오탐 성공 → 150+600 ≈ 750ms, CR 1회.
      // 현재 동작: 신호를 신뢰하지 않으므로 3회 전부 → 150+600*3 ≈ 1950ms.
      const o2 = lastOutcome(id);
      assert.strictEqual(o2.attempts, 3, `CR ${o2.attempts}회`);
      assert.ok(elapsed >= 1300, `${elapsed}ms — 예산을 안 썼다`);
    },
  );

  pty.kill(id);
}

// ── S4 — S3 의 대조군: 조용한(silent) 에이전트에 CR 이 안 먹힐 때 ────────
// 같은 "제출 실패" 인데 스피너가 없다. 재시도 3회를 전부 소진하고 — 그래도
// true 를 돌려준다(pty-manager.ts:502 의 의도된 anti-dup 트레이드오프).
// S3 와 나란히 놓으면 결론이 분명해진다: **반환값으로는 두 경우를 구별할 수 없다.**
async function s4SilentExhaustsRetries(pty) {
  const id = "ans-silent";
  const o = await spawnTui(pty, id, ["--ignore-cr"]);

  const t0 = Date.now();
  const ok = await pty.writeAndSubmit(id, ANSWER);
  const elapsed = Date.now() - t0;
  await sleep(300);

  fact(
    `S4 silent+CR무시: writeAndSubmit=${ok}, ${elapsed}ms, 제출 ${o.submits.length}건`,
  );

  check("S4: 제출 0건 (S3 와 같은 결과)", () => {
    assert.strictEqual(o.submits.length, 0);
  });

  check("S4: 재시도 3회를 전부 소진했다 (S3 와 다른 경로)", () => {
    assert.ok(elapsed >= 1300, `${elapsed}ms — 재시도가 안 돌았다`);
  });

  check(
    "S4: ★그래도 true — 반환값은 S3 와 동일. 전달 여부의 증거가 될 수 없다",
    () => {
      assert.strictEqual(ok, true);
    },
  );

  check("S4: ★판정 = unconfirmed (반환값과 달리 관측은 구별해 낸다)", () => {
    const o2 = lastOutcome(id);
    assert.ok(o2);
    assert.strictEqual(o2.outcome, "unconfirmed");
    assert.strictEqual(o2.streamHotBeforeCr, false);
    assert.strictEqual(o2.attempts, 3);
  });

  pty.kill(id);
}

// ── S5 — 확인 다이얼로그에 서 있는 에이전트 ──────────────────────────────
// PtyLiveness 로는 awaiting-input. 답의 첫 글자가 선택으로 소비된다.
async function s5AwaitingInputDialog(pty) {
  const id = "ans-dialog";
  const o = await spawnTui(pty, id, ["--dialog"]);

  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(400);

  fact(
    `S5 다이얼로그: writeAndSubmit=${ok}, 다이얼로그 확정 ${o.dialogs.length}건` +
      `(${JSON.stringify(o.dialogs[0] ?? null)}), 제출 ${o.submits.length}건`,
  );

  check("S5: ★답의 첫 글자가 다이얼로그 선택으로 소비됐다", () => {
    assert.strictEqual(o.dialogs.length, 1, `다이얼로그 ${o.dialogs.length}건`);
    assert.strictEqual(o.dialogs[0], ANSWER[0]);
  });

  check("S5: ★제출된 본문에서 첫 글자가 사라졌다 (답이 훼손됨)", () => {
    assert.strictEqual(o.submits.length, 1);
    assert.strictEqual(o.submits[0], ANSWER.slice(1));
    assert.notStrictEqual(o.submits[0], ANSWER);
  });

  pty.kill(id);
}

// ── S6 — ★회귀 가드: busy 인데 CR 이 **정상 동작**할 때 ──────────────────
//
// S3 의 수정(신호를 못 믿으면 CR 예산을 끝까지 쓴다) 때문에, 정상적으로 제출된
// 뒤에도 CR 이 두 번 더 날아간다. 그 추가 CR 이 **중복 제출**을 만들면 수정이
// 병보다 나쁘다. 여기서 그렇지 않음을 못박는다: 추가 CR 은 빈 컴포저에 떨어져
// no-op(EMPTYSUBMIT)이 되고, 제출은 정확히 1회로 유지된다.
async function s6BusyNoDuplicate(pty) {
  const id = "ans-busy-ok";
  const o = await spawnTui(pty, id, ["--busy"]);

  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(600);

  const obs = lastOutcome(id);
  fact(
    `S6 busy+CR정상: writeAndSubmit=${ok}, 판정=${obs && obs.outcome}, ` +
      `CR ${obs && obs.attempts}회, 제출 ${o.submits.length}건, ` +
      `빈제출 ${o.emptySubmits}건`,
  );

  check("S6: ★제출은 정확히 1회 — 추가 CR 이 중복을 만들지 않는다", () => {
    assert.strictEqual(o.submits.length, 1, `제출 ${o.submits.length}건`);
  });

  check("S6: 제출된 페이로드는 답 원문 그대로다", () => {
    assert.strictEqual(o.submits[0], ANSWER);
  });

  check("S6: 남는 CR 은 빈 컴포저 no-op 으로 흡수된다", () => {
    assert.ok(o.emptySubmits >= 1, `빈제출 ${o.emptySubmits}건 — 흡수 흔적 없음`);
  });

  check("S6: 판정은 indeterminate — 실제로 전달됐어도 확인은 못 한다(정직)", () => {
    assert.ok(obs);
    assert.strictEqual(obs.outcome, "indeterminate");
    assert.strictEqual(obs.attempts, 3);
  });

  pty.kill(id);
}

// ── main ─────────────────────────────────────────────────────────────────

(async () => {
  console.log("답 전달 실측 (티켓 igGI6QpXkEfrkkKN3rU0)\n");
  const pty = new PtyManager();
  pty.onSubmitOutcome((o) => observations.push(o));
  try {
    console.log("[S1] 빈 컴포저 — 대조군");
    await s1EmptyComposer(pty);
    console.log("\n[S2] ★컴포저에 초안이 물려 있음");
    await s2DraftInComposer(pty);
    console.log("\n[S3] ★턴 중(busy) + CR 미등록 — SUBMIT_SIGNAL 오탐");
    await s3BusyFalsePositive(pty);
    console.log("\n[S4] silent + CR 미등록 — S3 대조군");
    await s4SilentExhaustsRetries(pty);
    console.log("\n[S5] 확인 다이얼로그에 서 있음");
    await s5AwaitingInputDialog(pty);
    console.log("\n[S6] ★회귀 가드 — busy + CR 정상: 중복 제출이 없는가");
    await s6BusyNoDuplicate(pty);
  } finally {
    try {
      pty.killAll();
    } catch {
      /* best-effort */
    }
  }

  console.log("\n── 실측 사실 ──");
  for (const f of facts) console.log(`  ${f}`);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} 통과` +
      (failed.length ? ` — 실패 ${failed.length}건` : ""),
  );
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("하네스 자체가 실패했다:", err);
  process.exit(1);
});
