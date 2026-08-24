#!/usr/bin/env node
// 능동 프로브 무해성 실측 (티켓 DQYoyas3ESx33zXJOCOa).
//
// 이 티켓의 완료 기준 중 하나는 말이 아니라 **실측**이다:
//   "작업 중인 에이전트에 프로브를 걸었을 때 그 에이전트의 산출물·프롬프트가
//    불변임을 실측으로 보일 것"
//
// 그래서 이 하네스는 진짜 PTY 를 띄우고, 진짜 프로브(process.kill(pid,0) + `ps`)
// 를 걸고, PTY 가 뱉은 **바이트를 그대로 비교**한다. 그리고 대조군으로 **기각된
// 후보 (c)**(PTY 에 CR 을 넣는 프로브)를 같은 세션에 걸어 그쪽은 실제로 산출물을
// 바꾼다는 것을 함께 보인다 — 기각이 취향이 아니라 실측 결과였음을 남기기 위해.
//
// WHY 표준 vitest 가 아닌 standalone 인가: 진짜 node-pty 네이티브 스폰이 필요하고
// (tests/integration/pty-fd-leak.cjs 와 같은 이유), node 26 은 node-pty 의
// spawn-helper 를 깨뜨린다. macOS + node 22 에서 돌린다.
//
//   빌드 먼저:  npx tsc -p electron/tsconfig.json
//   실행:       ~/.nvm/versions/node/v22.13.0/bin/node \
//                 tests/integration/probe-noninvasive.cjs
//   npm script: npm run test:probe-noninvasive
"use strict";

const path = require("path");
const assert = require("assert");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== "darwin") {
  console.log(
    `SKIP: 프로브 무해성 실측은 macOS 전용 (platform=${process.platform}).`,
  );
  process.exit(0);
}

const DIST = path.join(__dirname, "..", "..", "dist-electron");
let PtyManager;
let probeMod;
try {
  ({ PtyManager } = require(path.join(DIST, "pty-manager.js")));
  probeMod = require(path.join(DIST, "process-cpu-probe.js"));
} catch (err) {
  console.error(
    `FAIL: dist-electron 를 못 읽었다 — 먼저 빌드하세요:\n` +
      `  npx tsc -p electron/tsconfig.json\n${err && err.message}`,
  );
  process.exit(1);
}

// ── 관측 유틸 ────────────────────────────────────────────────────────────

/** 세션 하나의 PTY 출력을 통째로 모으는 수집기. */
function collect(pty, id) {
  const buf = { text: "", bytes: 0 };
  pty.onData(id, (chunk) => {
    buf.text += chunk;
    buf.bytes += Buffer.byteLength(chunk, "utf8");
  });
  return buf;
}

/** 출력이 조용해질 때까지 기다린다(최대 maxMs). */
async function settle(buf, quietMs = 400, maxMs = 5000) {
  const start = Date.now();
  let lastLen = -1;
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    if (buf.text.length !== lastLen) {
      lastLen = buf.text.length;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return;
    }
    await sleep(50);
  }
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

// ── 시나리오 1 — "작업 중인" 에이전트(스트리밍 산출물) ────────────────────
//
// 끊임없이 출력을 뱉는 프로세스 = 턴 중인 에이전트. 프로브를 거는 동안 산출물
// 스트림이 끊기거나 오염되지 않아야 한다.
async function scenarioStreaming(pty) {
  const id = "probe-streaming";
  // 0.05초마다 순번을 찍는다. 순번이 끊기면 스트림이 교란된 것이다.
  pty.create(
    id,
    id,
    "/bin/bash",
    [
      "-c",
      "i=0; while [ $i -lt 200 ]; do echo TICK_$i; i=$((i+1)); sleep 0.05; done",
    ],
    process.cwd(),
  );
  const buf = collect(pty, id);
  await sleep(1200); // 스트림이 확실히 흐르게 둔다

  const pid = pty.getPid(id);
  const before = buf.text;
  const beforeTicks = (before.match(/TICK_\d+/g) || []).length;

  // ★진짜 프로브를 건다 — 여러 번.
  const probes = [];
  for (let i = 0; i < 5; i++) {
    probes.push(await probeMod.sampleProcessProbe(pid, null));
    await sleep(120);
  }

  await sleep(600);
  const after = buf.text;

  check("S1: 프로브가 pid 를 살아있다고 봤다", () => {
    assert.strictEqual(typeof pid, "number");
    assert.ok(
      probes.every((p) => p.alive === true),
      `alive=${JSON.stringify(probes.map((p) => p.alive))}`,
    );
  });

  check("S1: 프로브가 누적 CPU 를 관측했다(macOS)", () => {
    assert.ok(
      probes.some((p) => typeof p.cpuMs === "number"),
      "ps 파싱이 한 번도 성공하지 못했다",
    );
  });

  check(
    "S1: ★프로브 전 산출물이 한 바이트도 변경되지 않았다(prefix 보존)",
    () => {
      assert.ok(
        after.startsWith(before),
        "프로브 이후 스냅샷이 이전 산출물을 접두사로 갖지 않는다 = 기존 출력이 변조됨",
      );
    },
  );

  check(
    "S1: ★프로브가 산출물 스트림을 끊지 않았다(순번 연속·계속 증가)",
    () => {
      const ticks = (after.match(/TICK_(\d+)/g) || []).map((t) =>
        Number(t.slice(5)),
      );
      assert.ok(ticks.length > beforeTicks, "프로브 이후 출력이 멈췄다");
      for (let i = 1; i < ticks.length; i++) {
        assert.strictEqual(
          ticks[i],
          ticks[i - 1] + 1,
          `순번 불연속: ${ticks[i - 1]} → ${ticks[i]} (스트림 교란)`,
        );
      }
    },
  );

  check("S1: ★프로브가 stdin 에 아무것도 쓰지 않았다(에코 흔적 0)", () => {
    // 프로브 경로가 PTY 에 무언가 썼다면 bash 의 에코나 개행이 산출물에 섞인다.
    const noise = after
      .split("\n")
      .filter((l) => l.trim() && !/^TICK_\d+\r?$/.test(l.trim()));
    assert.strictEqual(
      noise.length,
      0,
      `TICK 이외의 출력이 생겼다: ${JSON.stringify(noise.slice(0, 5))}`,
    );
  });

  pty.kill(id);
}

// ── 시나리오 2 — 입력 버퍼에 초안이 물려 있는 에이전트 ────────────────────
//
// 이게 후보 (c) 기각의 핵심 위험이다: performWriteAndSubmit 은 입력 버퍼를
// **확인하지 않고** CR 을 보낸다. 그래서 컴포저에 물려 있던 초안이 제출된다.
// 여기서는 (1) 진짜 프로브는 초안을 건드리지 않고, (2) (c)식 프로브는 실제로
// 초안을 제출해 버린다는 것을 같은 세션에서 나란히 보인다.
async function scenarioDraftInComposer(pty) {
  const id = "probe-draft";
  pty.create(
    id,
    id,
    "/bin/bash",
    ["--norc", "--noprofile", "-i"],
    process.cwd(),
  );
  const buf = collect(pty, id);
  await settle(buf);

  // 입력 버퍼에 초안을 **타이핑만** 한다 — 엔터 없음.
  // 에코와 실행 결과를 구별하려고 따옴표를 끼운다: 화면에 에코되는 문자열은
  // `echo DRAFT''_RAN` 이지만, 실제로 실행되면 `DRAFT_RAN` 이 출력된다.
  pty.write(id, "echo DRAFT''_RAN");
  await settle(buf);

  const beforeProbe = buf.text;
  const pid = pty.getPid(id);

  // ★진짜 프로브 — OS 에게만 묻는다.
  const probes = [];
  for (let i = 0; i < 5; i++) {
    probes.push(await probeMod.sampleProcessProbe(pid, null));
    await sleep(100);
  }
  await settle(buf);
  const afterProbe = buf.text;

  check("S2: ★프로브 후 PTY 출력이 바이트 단위로 완전히 동일하다", () => {
    assert.strictEqual(
      afterProbe,
      beforeProbe,
      `프로브가 화면을 바꿨다 (+${afterProbe.length - beforeProbe.length}자)`,
    );
  });

  check("S2: ★초안이 제출되지 않았다 — 명령이 실행된 흔적이 없다", () => {
    assert.ok(
      !/(^|[^'])DRAFT_RAN/m.test(afterProbe),
      "초안이 실행됐다 = 프로브가 CR 을 넣었다",
    );
  });

  check("S2: 프로브는 이 세션도 살아있다고 봤다", () => {
    assert.ok(probes.every((p) => p.alive === true));
  });

  // ── 대조군: 기각된 후보 (c) 를 실제로 걸어본다 ──────────────────────────
  // writeAndSubmit 은 입력버퍼 확인 없이 CR 을 보낸다. 그 결과를 실측한다.
  pty.writeAndSubmit(id, "");
  await settle(buf, 600, 6000);
  const afterKeystrokeProbe = buf.text;

  check(
    "S2-대조군: ★(c) PTY 문자 주입은 실제로 초안을 제출해 버린다 — 기각이 옳았다",
    () => {
      assert.ok(
        afterKeystrokeProbe.length > afterProbe.length,
        "CR 을 넣었는데 화면이 그대로다 — 대조군이 성립하지 않았다(하네스 문제)",
      );
      assert.ok(
        /(^|[^'])DRAFT_RAN/m.test(afterKeystrokeProbe),
        "CR 주입 후에도 초안이 실행되지 않았다 — 대조군이 성립하지 않았다(하네스 문제)",
      );
    },
  );

  pty.kill(id);
}

// ── 시나리오 3 — 죽은 프로세스는 죽었다고 말한다 ──────────────────────────
async function scenarioDead(pty) {
  const id = "probe-dead";
  pty.create(id, id, "/bin/bash", ["-c", "exit 0"], process.cwd());
  const buf = collect(pty, id);
  const pid = pty.getPid(id);
  await settle(buf, 300, 3000);
  await sleep(600);

  const probe = await probeMod.sampleProcessProbe(pid, null);
  check(
    "S3: ★종료된 프로세스에 프로브 → alive=false (관측 불가가 아니라 사실)",
    () => {
      assert.strictEqual(probe.alive, false);
    },
  );
  try {
    pty.kill(id);
  } catch {
    /* already gone */
  }
}

// ── main ─────────────────────────────────────────────────────────────────

(async () => {
  console.log("능동 프로브 무해성 실측 (티켓 DQYoyas3ESx33zXJOCOa)\n");
  const pty = new PtyManager();
  try {
    console.log("[시나리오 1] 턴 중(스트리밍 산출물) 에이전트에 프로브");
    await scenarioStreaming(pty);
    console.log(
      "\n[시나리오 2] 입력 버퍼에 초안이 물린 에이전트에 프로브 (+ (c) 대조군)",
    );
    await scenarioDraftInComposer(pty);
    console.log("\n[시나리오 3] 이미 종료된 프로세스에 프로브");
    await scenarioDead(pty);
  } finally {
    try {
      pty.killAll();
    } catch {
      /* best-effort */
    }
  }

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
