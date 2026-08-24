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
// ★티켓 RtyOMpOArfI7a5JNSzsg 이후: S2·S5 는 **고쳐졌다**. 그래서 이 두 시나리오는
//   이제 "오염을 실증" 하는 것이 아니라 "오염이 일어나지 않음 + 사유가 돌아옴 +
//   ★남의 초안이 바이트 단위로 살아 있음" 을 잠근다. 나머지(S1·S3·S4·S6)는 회귀
//   가드로 그대로 있다 — 빈 컴포저 경로의 행동이 하나도 안 바뀌었음을 증명한다.
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
  const o = {
    text: "",
    submits: [],
    emptySubmits: 0,
    dialogs: [],
    // fixture 가 리페인트마다 흘리는 컴포저 전문. 마지막 값이 지금 버퍼다 —
    // 초안 보존을 화면 스크레이핑이 아니라 이 값으로 잰다.
    composers: [],
  };
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
    for (const m of chunk.matchAll(/<<<COMPOSER:(.*?)>>>/gs)) {
      try {
        o.composers.push(JSON.parse(m[1]));
      } catch {
        o.composers.push(m[1]);
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
//
// #1160 이 여기서 실측한 것: 답이 초안 뒤에 이어붙어 `"아직 쓰는 중인 초안입니다
// [답변 도착] question_id=…"` 한 덩어리로 제출됐고, 답 원문은 영영 도착하지 않았다.
// 그런데도 writeAndSubmit 은 true 였다.
//
// 티켓 RtyOMpOArfI7a5JNSzsg 의 채택안(D) 이후 계약이 바뀐다 — **쓰지 않는다.**
//   · 제출 0건 (섞인 덩어리가 아예 안 생긴다)
//   · writeAndSubmit=false (발신자가 실패를 안다)
//   · 판정 refused / 사유 composer-occupied (발신자가 **왜**인지도 안다)
//   · ★초안은 바이트 단위로 그대로 살아 있다 — 지우지도, 대신 제출하지도 않았다
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

  const state = pty.composerState(id);
  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(400);

  const obs = lastOutcome(id);
  fact(
    `S2 초안 물림: 판정=${state}, writeAndSubmit=${ok}, ` +
      `제출 ${o.submits.length}건, 사유=${obs && obs.refusal}`,
  );

  check("S2: ★컴포저 판정 = occupied (주입 전에 읽어 낸다)", () => {
    assert.strictEqual(state, "occupied");
  });

  check("S2: ★아무것도 제출되지 않았다 — 초안+답 덩어리가 생기지 않는다", () => {
    assert.strictEqual(o.submits.length, 0, `제출 ${o.submits.length}건`);
  });

  check("S2: ★writeAndSubmit 이 false — 발신자가 실패를 안다", () => {
    assert.strictEqual(ok, false);
  });

  check("S2: ★사유가 발신자에게 돌아간다 (refused / composer-occupied)", () => {
    assert.ok(obs, "판정이 관측되지 않았다");
    assert.strictEqual(obs.outcome, "refused");
    assert.strictEqual(obs.refusal, "composer-occupied");
    assert.strictEqual(obs.composer, "occupied");
    assert.ok(obs.reason && obs.reason.length > 0, "사람이 읽을 근거가 비었다");
  });

  check("S2: ★남의 초안이 바이트 단위로 살아 있다 (지우지 않았다)", () => {
    const now = o.composers[o.composers.length - 1];
    assert.strictEqual(now, DRAFT, `컴포저=${JSON.stringify(now)}`);
  });

  check("S2: ★답 본문이 컴포저에 단 한 글자도 들어가지 않았다", () => {
    const now = o.composers[o.composers.length - 1] || "";
    assert.ok(!now.includes(ANSWER.slice(0, 12)), "답이 섞여 들어갔다");
  });

  check("S2: ★대신 제출하지도 않았다 (CR 만 보내는 안의 회귀 가드)", () => {
    assert.strictEqual(o.submits.length + o.emptySubmits, 0);
  });

  pty.kill(id);
}

// ── S2b — ★풀림: 초안 작성자가 자기 손으로 제출하면 다시 쓸 수 있다 ────────
//
// (D) 안이 "영영 안 보냄" 이 되지 않으려면 **풀리는 순간**이 있어야 한다. 그
// 순간은 우리가 만들지 않는다 — 초안의 주인이 엔터를 치는 그때다. 재시도 정책은
// 폴링이 아니라 이 전이(`PtyManager.onComposerFree`)에 걸려 있다.
async function s2bFreesAfterOwnerSubmits(pty) {
  const id = "ans-draft-free";
  const o = await spawnTui(pty, id);

  const freed = [];
  const off = pty.onComposerFree((sid) => freed.push(sid));

  pty.write(id, "제 초안입니다");
  await sleep(200);
  const blocked = await pty.writeAndSubmit(id, ANSWER);

  check("S2b: 초안이 물린 동안에는 거절된다", () => {
    assert.strictEqual(blocked, false);
  });

  // 초안의 **주인**이 엔터를 친다. 우리가 아니다.
  pty.write(id, "\r");
  await sleep(250);

  check("S2b: ★컴포저가 풀렸다고 알려 온다 (재시도 정책의 트리거)", () => {
    assert.ok(freed.includes(id), `onComposerFree 미발화 (${freed.join(",")})`);
  });

  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(400);

  fact(
    `S2b 풀림: 주인 제출 후 writeAndSubmit=${ok}, 제출 ${o.submits.length}건`,
  );

  check("S2b: ★풀린 뒤에는 답이 온전히 전달된다", () => {
    assert.strictEqual(ok, true);
    assert.strictEqual(o.submits.length, 2, `제출 ${o.submits.length}건`);
    assert.strictEqual(o.submits[0], "제 초안입니다");
    assert.strictEqual(o.submits[1], ANSWER);
  });

  off();
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
//
// #1160 이 여기서 실측한 것: 답의 **첫 글자가 선택으로 소비**되고 나머지만
// 제출됐다. 훼손도 훼손이지만, 그 선택은 되돌릴 수 없다 — 답의 첫 글자가 "네" 든
// "y" 든, 그 키가 무엇을 승인했는지 우리는 모른다.
//
// (D) 안 이후: 쓰지 않는다. 다이얼로그는 손대지 않은 채 그대로 남는다.
async function s5AwaitingInputDialog(pty) {
  const id = "ans-dialog";
  const o = await spawnTui(pty, id, ["--dialog"]);

  const state = pty.composerState(id);
  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(400);

  const obs = lastOutcome(id);
  fact(
    `S5 다이얼로그: 판정=${state}, writeAndSubmit=${ok}, ` +
      `다이얼로그 확정 ${o.dialogs.length}건, 제출 ${o.submits.length}건, ` +
      `사유=${obs && obs.refusal}`,
  );

  check("S5: ★컴포저 판정 = awaiting-choice", () => {
    assert.strictEqual(state, "awaiting-choice");
  });

  check("S5: ★다이얼로그가 확정되지 않았다 — 첫 글자가 소비되지 않는다", () => {
    assert.strictEqual(o.dialogs.length, 0, `확정 ${o.dialogs.length}건`);
  });

  check("S5: ★훼손된 본문이 제출되지도 않았다", () => {
    assert.strictEqual(o.submits.length, 0, `제출 ${o.submits.length}건`);
  });

  check("S5: ★writeAndSubmit=false + 사유 awaiting-choice", () => {
    assert.strictEqual(ok, false);
    assert.ok(obs, "판정이 관측되지 않았다");
    assert.strictEqual(obs.outcome, "refused");
    assert.strictEqual(obs.refusal, "awaiting-choice");
    assert.strictEqual(obs.composer, "awaiting-choice");
  });

  pty.kill(id);
}

// ── S5b — 다이얼로그가 닫히면 풀린다 ─────────────────────────────────────
// 다이얼로그에 답하는 것은 사람(또는 그 에이전트)이지 우리가 아니다. 닫히면
// 컴포저가 돌아오고, 그때 보류된 답이 나간다.
async function s5bFreesAfterDialogClosed(pty) {
  const id = "ans-dialog-free";
  const o = await spawnTui(pty, id, ["--dialog"]);

  const freed = [];
  const off = pty.onComposerFree((sid) => freed.push(sid));

  const stateBefore = pty.composerState(id);
  const blocked = await pty.writeAndSubmit(id, ANSWER);
  check("S5b: 다이얼로그 앞에서는 거절된다", () => {
    assert.strictEqual(stateBefore, "awaiting-choice");
    assert.strictEqual(blocked, false);
  });

  // 사람이 다이얼로그에 답한다(키 하나).
  pty.write(id, "y");
  await sleep(250);

  const ok = await pty.writeAndSubmit(id, ANSWER);
  await sleep(400);

  fact(
    `S5b 다이얼로그 닫힘: 거절=${blocked === false}, 재시도 writeAndSubmit=${ok}, ` +
      `제출 ${o.submits.length}건`,
  );

  check("S5b: ★다이얼로그가 닫히면 풀렸다고 알려 온다", () => {
    assert.ok(freed.includes(id), `onComposerFree 미발화 (${freed.join(",")})`);
  });

  check("S5b: ★그 뒤 답이 온전히 전달된다", () => {
    assert.strictEqual(blocked, false);
    assert.strictEqual(ok, true);
    assert.strictEqual(o.submits.length, 1, `제출 ${o.submits.length}건`);
    assert.strictEqual(o.submits[0], ANSWER);
  });

  off();
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
    console.log("\n[S2b] ★초안 주인이 제출하면 풀린다");
    await s2bFreesAfterOwnerSubmits(pty);
    console.log("\n[S3] ★턴 중(busy) + CR 미등록 — SUBMIT_SIGNAL 오탐");
    await s3BusyFalsePositive(pty);
    console.log("\n[S4] silent + CR 미등록 — S3 대조군");
    await s4SilentExhaustsRetries(pty);
    console.log("\n[S5] 확인 다이얼로그에 서 있음");
    await s5AwaitingInputDialog(pty);
    console.log("\n[S5b] ★다이얼로그가 닫히면 풀린다");
    await s5bFreesAfterDialogClosed(pty);
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
