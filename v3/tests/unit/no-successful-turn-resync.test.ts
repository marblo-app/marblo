// "성공 턴 0" 축의 실배선 회귀 (티켓 IOAvYsfHz72Ov5BDy8NO — #1500 gPIC5k65hGKcTOpq4NQZ
// 의 후속). #1500 은 순수 판정(`classifyResyncAttention`)과 판정 재료
// (`agent-manager.ts` 의 `sessionHasSuccessfulTurn`/`readSessionSuccessfulTurnStatus`)
// 까지만 만들었고, `main.ts` 의 `listAttentionTasks` 가 실제로 그 재료를 채우는
// 배선은 없었다 — 즉 판정 함수는 있는데 아무도 안 불렀다. 이 파일은 그 배선이
// 실제로 있다면 무엇이 보여야 하는가를, main.ts 를 직접 import 하지 않고(Electron/
// Firebase 부팅 없이) `OrchestratorBoardResync` 에 **main.ts 와 같은 모양의
// listAttentionTasks** 를 주입해 검증한다 — 다른 "-resync.test.ts" 들과 같은
// 경계(main.ts 는 얇은 접착 코드, 실질 로직은 여기서 실제 fs 픽스처로 돈다).
//
// 고정하는 계약:
//   ① ★실사고와 같은 모양(세션 jsonl 이 성공 턴 0)이면 통보가 오케 PTY 까지
//      실제로 도달한다(injects 에 "성공 턴 0" 메시지가 실린다) — #1500 이 만든
//      판정 함수가 실제 호출 경로에서 진짜로 값을 만들어 낸다는 것.
//   ② ★뮤테이션: main.ts 의 배선(hasSuccessfulTurn 채우기)이 빠지면 이 테스트가
//      실제로 빨개진다 — "판정 함수는 있는데 안 불린다"는 사고 재현.
//   ③ 정상 세션(성공 턴 있음)은 통보되지 않는다 — 오탐 금지.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  OrchestratorBoardResync,
  type BoardResyncDeps,
  type ResyncTaskRow,
} from "../../electron/orchestrator-board-resync";
import { readSessionSuccessfulTurnStatus } from "../../electron/agent-manager";

const MIN_AGE = 180_000;
const ORPHAN_MIN_AGE = 600_000;

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "fixtures",
  "session-zero-turn-429.jsonl",
);

/**
 * main.ts 의 `listAttentionTasks` 가 실제로 하는 일(#1500 배선)을 그대로
 * 흉내낸다: 세션 jsonl 을 읽어 `hasSuccessfulTurn` 을 채운다. main.ts 자신을
 * import 하지 않는 이유는 Electron/Firebase 부팅 없이는 그 파일을 로드할 수
 * 없어서다(다른 "-resync.test.ts" 전부가 같은 경계를 쓴다) — 대신 main.ts 가
 * 부르는 것과 **같은 프로덕션 함수**(`readSessionSuccessfulTurnStatus`)를
 * **같은 실제 파일**(픽스처)에 대고 그대로 부른다. main.ts 쪽 배선 자체가
 * 실제로 존재하는지는 아래 "배선 소스 스캔" describe 가 grep 으로 고정한다.
 */
function rowFromFixtureSession(
  over: Partial<ResyncTaskRow> = {},
): ResyncTaskRow {
  return {
    taskId: "t-zero-turn",
    projectId: "p1",
    status: "IN_PROGRESS",
    title: "backend-claude-gz5g",
    role: "backend",
    prUrl: null,
    contextId: "board",
    isMission: false,
    claimedBy: "agent-1",
    ageMs: MIN_AGE, // 실사고: 1시간 35분(>> minAgeMs) — 게이트 통과를 보수적으로 최소치로 고정
    branch: null,
    hasSuccessfulTurn: readSessionSuccessfulTurnStatus(FIXTURE_PATH),
    ...over,
  };
}

interface Harness {
  resync: OrchestratorBoardResync;
  injects: string[];
}

function harness(
  rows: ResyncTaskRow[],
  over: Partial<BoardResyncDeps> = {},
): Harness {
  const injects: string[] = [];
  const resync = new OrchestratorBoardResync({
    listBoardOrchestratorProjects: () => ["p1"],
    getOrchestratorSession: () => ({ ptySessionId: "s1", status: "running" }),
    listAttentionTasks: async () => rows,
    isAgentAliveInFleet: () => true, // ★실사고와 같다 — 에이전트는 플릿에 살아 있었다(orphan 은 못 잡는다).
    listReadyChainItems: async () => [],
    inject: async (_p, m) => {
      injects.push(m);
      return true;
    },
    log: () => {},
    logError: () => {},
    minAgeMs: MIN_AGE,
    orphanMinAgeMs: ORPHAN_MIN_AGE,
    ...over,
  });
  return { resync, injects };
}

describe("★실사고 재현 — 성공 턴 0 픽스처가 실제로 오케 PTY 에 닿는다", () => {
  it("red→green: readSessionSuccessfulTurnStatus(실사고 픽스처) → false 가 classifyResyncAttention 을 거쳐 injects 에 실린다", async () => {
    // 사전 조건 확인 — 이 값이 우연히 true 로 바뀌면 아래 assertion 이 무의미해진다.
    expect(readSessionSuccessfulTurnStatus(FIXTURE_PATH)).toBe(false);

    const h = harness([rowFromFixtureSession()]);
    await h.resync.tickOnce();

    expect(h.injects).toHaveLength(1);
    expect(h.injects[0]).toContain("성공 턴 0");
    expect(h.injects[0]).toContain("t-zero-turn");
  });

  it("정상 세션(성공 턴 있음)은 통보되지 않는다 — 오탐 금지", async () => {
    const h = harness([
      rowFromFixtureSession({
        taskId: "t-healthy",
        hasSuccessfulTurn: true, // main.ts 가 정상 세션을 읽었다면 이 값이 나온다
      }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0);
  });
});

describe("★뮤테이션 — main.ts 배선이 빠지면(hasSuccessfulTurn 을 안 채우면) 위 테스트가 빨개진다", () => {
  it("hasSuccessfulTurn 을 안 채운(undefined) 채로 두면(#1500 직후 상태 재현) 통보가 안 간다", async () => {
    // ★이것이 이 티켓 전체의 사고 재현이다: 판정 함수(#1500)는 있지만
    // main.ts 가 그 결과를 row 에 실어주지 않으면(배선 전) 위와 똑같은
    // 픽스처·똑같은 age·똑같은 alive 조건에서도 아무 통보가 안 나간다.
    const h = harness([
      rowFromFixtureSession({ hasSuccessfulTurn: undefined }),
    ]);
    await h.resync.tickOnce();
    expect(h.injects).toHaveLength(0); // 배선 전(#1500 직후)의 실제 동작 — 이번 PR 이 이걸 뒤집는다
  });
});

describe("배선 소스 스캔 — main.ts 가 실제로 이 값을 채우는지(로직이 아니라 배선 자체를 고정)", () => {
  // orchestrator-cost-collection.test.ts 와 같은 규율: 순수 로직만 테스트하면
  // "판정은 맞는데 아무도 안 부른다" 는 이번 사고를 또 놓친다. main.ts 는
  // Electron/Firebase 부팅 없이 import 할 수 없어 소스 텍스트로 배선 자체를
  // 고정한다.
  const mainTs = fs.readFileSync(
    path.join(__dirname, "..", "..", "electron", "main.ts"),
    "utf-8",
  );

  it("hasSuccessfulTurn 변수 대입 자체가 resolveHasSuccessfulTurn(claimedBy) 호출 결과다 — null 하드코딩이면 깨진다", () => {
    // ★단순히 "resolveHasSuccessfulTurn(" 문자열이 파일 어딘가(함수 정의부
    // 포함)에 있는지가 아니라, `const hasSuccessfulTurn =` 대입의 우변이
    // 실제로 그 호출을 담고 있는지를 본다 — 함수는 정의돼 있는데 호출부만
    // `null` 로 하드코딩되는 회귀(이 사고의 정확한 모양)를 잡기 위함.
    expect(mainTs).toMatch(
      /const hasSuccessfulTurn =[\s\S]{0,120}resolveHasSuccessfulTurn\(\s*claimedBy\s*\)/,
    );
    // 그 값이 실제로 ResyncTaskRow 객체 리터럴의 필드로 실린다(계산만 하고
    // 안 쓰는 회귀도 잡는다).
    expect(mainTs).toMatch(/hasSuccessfulTurn,\s*\n\s*\}\)/);
  });

  it("resolveHasSuccessfulTurn 자신은 #1500 의 판정 함수(readSessionSuccessfulTurnStatus)를 실제로 부른다", () => {
    expect(mainTs).toMatch(
      /function resolveHasSuccessfulTurn\([\s\S]{0,400}readSessionSuccessfulTurnStatus\(/,
    );
    expect(mainTs).toMatch(
      /function resolveHasSuccessfulTurn\([\s\S]{0,400}resolveClaudeSessionIdForAgent\(/,
    );
  });
});
