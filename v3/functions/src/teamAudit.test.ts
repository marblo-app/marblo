// teamAudit.ts 단위검증 — node --test (projectAudit.test.ts 와 같은 규약).
//
// ★이 파일이 지키는 것은 "동작" 이 아니라 **약속**이다:
//   1) 팀 오너 축이 운영자 축과 섞이지 않는다.
//   2) 멤버가 남의 기록을 못 본다.
//   3) 코드·프롬프트·입력 텍스트·금액·원시 uid 가 응답에 실리지 않는다.
//   4) 허용목록 밖 툴은 fail-closed 로 빠진다.
//   5) 페이징이 행을 건너뛰거나 중복시키지 않는다.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHmac } from "node:crypto";

import {
  STALLED_AFTER_MS,
  buildProjectAudit,
  type RawDoc,
} from "./projectAudit";
import {
  DEFAULT_TEAM_AUDIT_LIMIT,
  MAX_TEAM_AUDIT_LIMIT,
  PROJECT_EVENT_TOOLS,
  TEAM_AUDIT_WITHHELD,
  compareEventsDesc,
  containsRawValue,
  decodeAuditCursor,
  deniedTeamAudit,
  encodeAuditCursor,
  eventKindForTool,
  FORBIDDEN_SCAN_EXEMPT_ROOTS,
  OPERATOR_ONLY_PATTERNS,
  REDACTED_IDENTITY,
  allUserFacingTexts,
  scrubIdentityLike,
  findForbiddenKeys,
  findOperatorOnlyText,
  isProjectEventTool,
  TEAM_AUDIT_REASON_CODES,
  TEAM_AUDIT_DELIBERATE_MISMATCHES,
  TEAM_AUDIT_SUMMARY_INVARIANTS,
  TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO,
  runtimeNote,
  narrowAuditForTeam,
  normalizeLimit,
  reasonTextFor,
  scopeForRole,
  toTeamAuditEvent,
  type LedgerEventInput,
  type MergeEventInput,
  type NarrowTeamAuditInput,
  type TeamAuditEvent,
} from "./teamAudit";

// ── 픽스처 ───────────────────────────────────────────────────────────────────

const SALT = "test-salt-do-not-ship";
const ALICE_UID = "uid_alice_28charsAAAAAAAAAAA";
const BOB_UID = "uid_bob_28charsBBBBBBBBBBBBB";

function memberKeyFor(uid: string): string {
  const digest = createHmac("sha256", SALT)
    .update(`teamMember:${uid}`)
    .digest("hex")
    .slice(0, 24);
  return `tm_${digest}`;
}

const memberKeyOf = (uid: string): string | null => memberKeyFor(uid);
const noSaltMemberKeyOf = (): string | null => null;

const T0 = Date.UTC(2026, 7, 20, 0, 0, 0);
const NOW = Date.UTC(2026, 7, 21, 0, 0, 0);

function task(id: string, extra: Record<string, unknown> = {}): RawDoc {
  return {
    id,
    title: `티켓 ${id}`,
    status: "IN_PROGRESS",
    role: "backend",
    updatedAt: new Date(T0),
    createdAt: new Date(T0),
    ...extra,
  };
}

/** 원장 raw — ★`params`/`result`/`instructionRedacted` 가 실제로 들어 있다. */
function ledgerDoc(
  id: string,
  toolName: string,
  extra: Record<string, unknown> = {}
): RawDoc {
  return {
    id,
    toolName,
    taskId: "t1",
    agentId: "backend-1",
    actorUid: ALICE_UID,
    success: true,
    createdAt: new Date(T0),
    params: { instruction: "여기에 자격증명이 섞일 수 있다", path: "/Users/x" },
    result: "const secret = 'do not leak this code';",
    instructionRedacted: "티켓 t1 을 마무리해라 — 이건 프롬프트다",
    ...extra,
  };
}

function ledgerEvent(
  id: string,
  toolName: string,
  extra: Partial<LedgerEventInput> = {}
): LedgerEventInput {
  return {
    id,
    toolName,
    atMs: T0,
    taskId: "t1",
    agentId: "backend-1",
    actorUid: ALICE_UID,
    success: true,
    ...extra,
  };
}

function mergeEvent(
  id: string,
  extra: Partial<MergeEventInput> = {}
): MergeEventInput {
  return {
    id,
    atMs: T0,
    taskId: "t1",
    branch: "feat/x",
    prNumber: 12,
    filesChanged: 3,
    linesAdded: 40,
    linesDeleted: 5,
    ...extra,
  };
}

function baseAudit(
  overrides: {
    tasks?: RawDoc[];
    ledger?: RawDoc[];
    missions?: RawDoc[];
    agents?: RawDoc[];
    merges?: RawDoc[];
    activities?: RawDoc[];
    agentsLoaded?: boolean;
  } = {}
) {
  return buildProjectAudit({
    projects: [
      {
        id: "p1",
        name: "프로젝트",
        ownerId: ALICE_UID,
        members: [ALICE_UID, BOB_UID],
        folderPath: "/Users/alice/code",
      },
    ],
    projectId: "p1",
    tasks: overrides.tasks ?? [task("t1")],
    agents: overrides.agents ?? [
      { id: "backend-1", name: "backend-1", totalCost: 12.34, model: "opus" },
    ],
    activities: overrides.activities ?? [],
    ledger: overrides.ledger ?? [],
    missions: overrides.missions ?? [],
    merges: overrides.merges ?? [],
    agentsLoaded: overrides.agentsLoaded ?? true,
    nowMs: NOW,
    timelineLimit: 1,
  });
}

function narrow(
  overrides: Partial<NarrowTeamAuditInput> = {},
  baseOverrides: Parameters<typeof baseAudit>[0] = {}
) {
  return narrowAuditForTeam({
    base: baseAudit(baseOverrides),
    ledger: [],
    merges: [],
    scope: "team",
    role: "owner",
    projects: [{ id: "p1", name: "프로젝트", role: "owner" }],
    memberKeyOf,
    selfMemberKey: memberKeyFor(ALICE_UID),
    limit: DEFAULT_TEAM_AUDIT_LIMIT,
    cursor: null,
    sourcesIncomplete: false,
    scanTruncated: false,
    agentsLoaded: true,
    agentsTruncated: false,
    projectsTruncated: false,
    activityScannedTaskIds: null,
    nowMs: NOW,
    ...overrides,
  });
}

// ── 1. 축 분리 · 역할 → 스코프 ───────────────────────────────────────────────

test("역할 → 스코프: owner/admin 은 team, member 는 self, none 은 없음", () => {
  assert.equal(scopeForRole("owner"), "team");
  assert.equal(scopeForRole("admin"), "team");
  assert.equal(scopeForRole("member"), "self");
  assert.equal(scopeForRole("none"), null);
});

test("권한 없음 응답은 프로젝트 존재 여부를 말하지 않는다", () => {
  const denied = deniedTeamAudit(NOW, "no_role");
  assert.equal(denied.teamAudit.state, "disabled");
  assert.equal(denied.teamAudit.reasonCode, "no_role");
  assert.equal(denied.teamAudit.role, null);
  assert.equal(denied.projectId, null);
  assert.deepEqual(denied.projects, []);
  assert.deepEqual(denied.events, []);
  assert.equal(denied.summary.eventsInWindow, 0);
  // ★닫힌 응답이 넓은 스코프를 주장하지 않는다.
  assert.equal(denied.teamAudit.scope, "self");
  // ★안 보여주기로 한 목록은 닫힌 응답에도 실린다.
  assert.ok(denied.withheld.length > 0);
});

test("사유 코드는 항상 ko 문장 짝을 갖는다(화면 폴백)", () => {
  const codes = [
    "no_role",
    "no_project",
    "no_events",
    "partial_sources",
    "scan_truncated",
    "self_scope_unattributable",
  ] as const;
  for (const c of codes) {
    assert.equal(typeof reasonTextFor(c), "string");
    assert.ok(reasonTextFor(c).length > 0, `${c} 문장이 비어 있다`);
  }
});

// ── 2. ★허용목록 — fail-closed ───────────────────────────────────────────────

test("허용목록: 공유 산출물을 바꾸는 툴만 사건이 된다", () => {
  for (const t of [
    "create_task",
    "create_tasks_bulk",
    "claim_task",
    "update_task_status",
    "submit_for_review",
    "merge_and_close",
    "spawn_agent",
    "create_flow",
    "update_flow",
  ]) {
    assert.ok(isProjectEventTool(t), `${t} 는 허용목록에 있어야 한다`);
    assert.notEqual(eventKindForTool(t), null);
  }
});

test("★허용목록 밖은 전부 빠진다 — 명령 실행·열람·보고·질문·에스컬레이션", () => {
  const surveillance = [
    // 명령 실행 / 파일 접근 — "무슨 명령을 쳤나"
    "Bash",
    "Read",
    "Edit",
    "Write",
    "Grep",
    // 열람 — "무엇을 봤나"
    "get_task",
    "get_all_tasks",
    "get_available_tasks",
    "get_task_activities",
    "search_tasks",
    "get_agents",
    "get_agent_skill",
    "run_skill",
    // 통신 / 보고
    "add_activity",
    "ask_orchestrator",
    "answer_question",
    "check_feedback",
    "acknowledge_feedback",
    "add_pending_instruction",
    "mark_instruction_delivered",
    "escalate_to_owner",
    // 성과 평가
    "request_model_escalation",
    "resolve_model_escalation",
    // 미션 원장 이벤트
    "mission.created",
  ];
  for (const t of surveillance) {
    assert.equal(isProjectEventTool(t), false, `${t} 가 새고 있다`);
    assert.equal(eventKindForTool(t), null, `${t} 가 분류되고 있다`);
  }
});

test("★fail-closed — 오늘 존재하지 않는 새 툴은 자동으로 빠진다", () => {
  assert.equal(isProjectEventTool("some_future_tool_nobody_classified"), false);
  assert.equal(
    toTeamAuditEvent(
      ledgerEvent("l1", "some_future_tool_nobody_classified"),
      new Map(),
      memberKeyOf
    ),
    null
  );
  // 타입이 아닌 값이 와도 던지지 않고 빠진다.
  assert.equal(isProjectEventTool(null), false);
  assert.equal(isProjectEventTool(42), false);
});

test("허용목록에 감시성 툴이 실수로 들어가 있지 않다(목록 자체를 검사)", () => {
  const banned = [
    "add_activity",
    "ask_orchestrator",
    "get_task",
    "search_tasks",
    "run_skill",
    "request_model_escalation",
  ];
  for (const b of banned) {
    assert.equal(PROJECT_EVENT_TOOLS.has(b), false, `${b} 가 허용목록에 있다`);
  }
  assert.equal(PROJECT_EVENT_TOOLS.size, 9);
});

// ── 3. ★멤버는 남의 기록을 못 본다 ───────────────────────────────────────────

test("★self 스코프: 남의 행이 서버에서 걸러진다", () => {
  const res = narrow({
    scope: "self",
    role: "member",
    selfMemberKey: memberKeyFor(BOB_UID),
    ledger: [
      ledgerEvent("a1", "update_task_status", {
        actorUid: ALICE_UID,
        atMs: T0 + 3,
      }),
      ledgerEvent("b1", "update_task_status", {
        actorUid: BOB_UID,
        atMs: T0 + 2,
      }),
      ledgerEvent("a2", "claim_task", { actorUid: ALICE_UID, atMs: T0 + 1 }),
    ],
  });
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].id, "ledger:b1");
  assert.equal(res.events[0].memberKey, memberKeyFor(BOB_UID));
  // ★창 기준 요약도 self 로 접혀야 한다 — 총계로 남의 활동량이 새면 차분 공격이다.
  assert.equal(res.summary.eventsInWindow, 1);
  assert.equal(res.summary.eventsByKind.task_transition, 1);
  // 응답 어디에도 앨리스의 가명이 없다.
  assert.equal(containsRawValue(res, memberKeyFor(ALICE_UID)), false);
});

test("★team 스코프여야 남의 행이 보인다 — 스코프가 실제로 갈린다", () => {
  const ledger = [
    ledgerEvent("a1", "update_task_status", { actorUid: ALICE_UID }),
    ledgerEvent("b1", "claim_task", { actorUid: BOB_UID, id: "b1" }),
  ];
  const team = narrow({ scope: "team", role: "owner", ledger });
  assert.equal(team.events.length, 2);
  const self = narrow({
    scope: "self",
    role: "member",
    selfMemberKey: memberKeyFor(BOB_UID),
    ledger,
  });
  assert.equal(self.events.length, 1);
});

test("★가명을 못 만들면 self 는 0건으로 닫힌다(열어두는 쪽으로 실패하지 않는다)", () => {
  const res = narrow({
    scope: "self",
    role: "member",
    memberKeyOf: noSaltMemberKeyOf,
    selfMemberKey: null,
    ledger: [ledgerEvent("b1", "claim_task", { actorUid: BOB_UID })],
  });
  assert.deepEqual(res.events, []);
  assert.equal(res.teamAudit.state, "empty");
  assert.equal(res.teamAudit.reasonCode, "self_scope_unattributable");
});

test("가명을 못 만들어도 team 스코프는 사건을 내되 행위자를 '모름' 으로 둔다", () => {
  const res = narrow({
    scope: "team",
    role: "owner",
    memberKeyOf: noSaltMemberKeyOf,
    selfMemberKey: null,
    ledger: [ledgerEvent("a1", "claim_task")],
  });
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].memberKey, null);
  // ★원시 uid 로 대체하지 않는다.
  assert.equal(containsRawValue(res, ALICE_UID), false);
});

// ── 4. ★프라이버시 계약 — 응답에 실리면 안 되는 것 ───────────────────────────

test("★원장 자유 텍스트(params·result·instructionRedacted)가 응답에 없다", () => {
  const res = narrow(
    {
      ledger: [ledgerEvent("a1", "update_task_status")],
    },
    {
      // ★매퍼에는 원문이 그대로 들어간다 — 좁히기가 막는지 보는 것이 목적이다.
      ledger: [ledgerDoc("a1", "update_task_status")],
    }
  );
  const json = JSON.stringify(res);
  assert.equal(json.includes("do not leak this code"), false);
  assert.equal(json.includes("이건 프롬프트다"), false);
  assert.equal(json.includes("자격증명이 섞일 수 있다"), false);
  assert.equal(json.includes("/Users/x"), false);
});

test("★활동 본문이 응답에 없다 — activity 행 자체가 피드에 안 뜬다", () => {
  const res = narrow(
    { ledger: [ledgerEvent("a1", "claim_task")] },
    {
      activities: [
        {
          id: "act1",
          taskId: "t1",
          agentId: "backend-1",
          message: "SECRET_ACTIVITY_BODY: 여기에 코드 덤프가 들어온다",
          createdAt: new Date(T0),
        },
      ],
    }
  );
  assert.equal(JSON.stringify(res).includes("SECRET_ACTIVITY_BODY"), false);
  // 카운트는 남는다 — 주의 필요 판정의 근거이기 때문이다.
  assert.equal(res.tickets[0].activityCount, 1);
  // ★activity 는 사건이 아니다.
  assert.equal(
    res.events.every((e) => e.action !== "활동"),
    true
  );
});

test("★미션 목표(goal)가 응답에 없다 — 사람이 친 지시문이다", () => {
  const res = narrow(
    {},
    {
      missions: [
        {
          id: "m1",
          goal: "SECRET_MISSION_GOAL: 이 문장은 에이전트 프롬프트로 들어간다",
          status: "running",
          taskIds: ["t1"],
        },
      ],
    }
  );
  assert.equal(JSON.stringify(res).includes("SECRET_MISSION_GOAL"), false);
  assert.equal(res.missions.length, 1);
  assert.equal(res.missions[0].id, "m1");
  assert.equal("goal" in res.missions[0], false);
});

test("★금액·토큰 수치가 응답에 하나도 없다(사용량 게이트 우회 방지)", () => {
  const res = narrow({});
  const json = JSON.stringify(res);
  assert.equal(json.includes("totalCost"), false);
  assert.equal(json.includes("12.34"), false);
  assert.equal(res.workload.length, 1);
  assert.equal("totalCost" in res.workload[0], false);
  // 부하 판단에 필요한 카운트는 남는다.
  assert.equal(typeof res.workload[0].openTasks, "number");
});

test("★기기 로컬 경로(repoRoot·folderPath)가 응답에 없다", () => {
  const res = narrow(
    { merges: [mergeEvent("mg1")] },
    {
      merges: [
        {
          id: "mg1",
          taskId: "t1",
          repoRoot: "/Users/alice/code/marblo",
          branch: "feat/x",
          mergedAt: new Date(T0),
        },
      ],
    }
  );
  const json = JSON.stringify(res);
  assert.equal(json.includes("/Users/alice"), false);
  // ★키로 검사한다 — `withheld` 목록이 "repoRoot" 라는 낱말을 **일부러** 담고
  //   있으므로(뺐다는 사실의 고지) 문자열 검색으로는 판정할 수 없다.
  assert.deepEqual(findForbiddenKeys(res.events), []);
  // 머지 사실은 남는다.
  const merge = res.events.find((e) => e.kind === "merge");
  assert.ok(merge);
  assert.equal(merge?.merge?.branch, "feat/x");
});

test("★원시 uid 가 응답 어디에도 없다", () => {
  const res = narrow({
    ledger: [
      ledgerEvent("a1", "claim_task", { actorUid: ALICE_UID }),
      ledgerEvent("b1", "update_task_status", { actorUid: BOB_UID }),
    ],
  });
  assert.equal(containsRawValue(res, ALICE_UID), false);
  assert.equal(containsRawValue(res, BOB_UID), false);
  // 가명은 있다.
  assert.equal(containsRawValue(res, memberKeyFor(ALICE_UID)), true);
});

test("★금지 키 스캔 — 매퍼가 필드를 늘려도 여기서 걸린다", () => {
  const res = narrow(
    {
      ledger: [ledgerEvent("a1", "update_task_status")],
      merges: [mergeEvent("mg1")],
    },
    {
      ledger: [ledgerDoc("a1", "update_task_status")],
      missions: [{ id: "m1", goal: "x", status: "running", taskIds: [] }],
      merges: [
        {
          id: "mg1",
          repoRoot: "/Users/a",
          branch: "b",
          mergedAt: new Date(T0),
        },
      ],
      activities: [
        { id: "act1", taskId: "t1", message: "m", createdAt: new Date(T0) },
      ],
    }
  );
  assert.deepEqual(findForbiddenKeys(res), []);
});

test("★사건 타입에 자유 텍스트 자리가 아예 없다(null 로도 두지 않는다)", () => {
  const ev = toTeamAuditEvent(
    ledgerEvent("a1", "update_task_status"),
    new Map([["t1", "티켓 t1"]]),
    memberKeyOf
  );
  assert.ok(ev);
  for (const forbidden of ["text", "message", "instruction", "result"]) {
    assert.equal(
      forbidden in (ev as object),
      false,
      `${forbidden} 자리가 있다`
    );
  }
});

test("★안 보여주기로 한 목록이 응답에 실린다(문서에만 적지 않는다)", () => {
  const res = narrow({});
  assert.deepEqual(res.withheld, [...TEAM_AUDIT_WITHHELD]);
  assert.ok(res.withheld.length >= 10);
  assert.ok(res.notes.some((n) => n.code === "note_read_only"));
});

// ── 4b. ★i18n 계약 — ko·en·ja 세 로케일이 있다 ───────────────────────────────

test("★withheld 의 모든 줄이 안정 코드를 갖는다(문장만 주면 en/ja 가 한국어를 그린다)", () => {
  const res = narrow({});
  assert.equal(res.withheld.length, 10);
  for (const w of res.withheld) {
    assert.equal(typeof w.code, "string");
    assert.ok(w.code && w.code.startsWith("withheld_"), `${w.code} 접두가 다르다`);
    assert.ok(w.text.length > 0);
  }
  // 코드가 유일해야 화면의 i18n 표가 한 줄을 덮어쓰지 않는다.
  const codes = res.withheld.map((w) => w.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("★모든 note 가 코드를 갖는다 — 번역 불가한 줄이 하나도 없다", () => {
  const res = narrow({ scope: "self", role: "member" });
  assert.ok(res.notes.length > 0);
  for (const n of res.notes) {
    assert.equal(typeof n.code, "string");
    assert.ok(n.text.length > 0);
  }
});

test("★매퍼 note 를 흘리지 않는다 — 팀 뷰에서 거짓이 되는 문장이 있다", () => {
  const res = narrow({}, { ledger: [ledgerDoc("a1", "update_task_status")] });
  const texts = res.notes.map((n) => n.text).join(" ");
  // 매퍼는 "지시문은 scrub 된 요약만 표시한다" 고 말하지만, 팀 응답은 지시문을
  // **아예 싣지 않는다.** 그 문장이 새면 응답이 스스로 거짓말한다.
  assert.equal(texts.includes("scrub"), false);
  assert.equal(texts.includes("Phase2"), false);
  // 대신 팀 뷰에서 참인 사실은 코드로 다시 만들어 남긴다.
  assert.ok(res.notes.some((n) => n.code === "note_stalled_threshold"));
});

test("에이전트 목록을 못 읽었으면 '주인 없는 클레임 판정 생략' 을 밝힌다", () => {
  const ok = narrow({ agentsLoaded: true });
  assert.equal(ok.notes.some((n) => n.code === "note_orphan_claim_unknown"), false);
  const missing = narrow({ agentsLoaded: false });
  assert.ok(missing.notes.some((n) => n.code === "note_orphan_claim_unknown"));
});

test("★코드만 늘리고 문장을 빼먹으면 잡힌다 — Record 전수 검사", () => {
  for (const [code, text] of Object.entries(TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO)) {
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0, `${code} 문장이 비어 있다`);
    assert.deepEqual(runtimeNote(code as never), { code, text });
  }
});

test("★기준값을 문장에 박지 않는다 — 아라비아 숫자도, 한글 수사도", () => {
  // ★이 검사는 한 번 **거짓 안심**을 줬다. 처음엔 /\d/ 만 봤는데
  //   "'정체' 는 **여섯 시간** 동안…" 이 한글 수사라 통과했다 — 규율은 어기고
  //   테스트는 초록이었다(UI 티켓이 잡았다). 규칙의 글자가 아니라 뜻을 검사한다.
  const NUMERAL = "\\d|일|이|삼|사|오|육|칠|팔|구|십|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열";
  const UNIT = "시간|분|초|일|주|개월|년|건|개";
  const re = new RegExp(`(${NUMERAL})\\s*(${UNIT})`);
  const all = [
    ...Object.values(TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO),
    ...allUserFacingTexts().map((t) => t.text),
  ];
  for (const text of all) {
    assert.equal(re.test(text), false, `기준값이 박힌 문장: ${text}`);
  }
});

test("★기준값은 문장이 아니라 criteria 로 나간다 — 판정 상수와 같은 출처", () => {
  const res = narrow({});
  // 판정에 쓰는 상수와 화면에 말하는 숫자가 갈라지면 안 된다.
  assert.equal(
    res.criteria.stalledAfterHours,
    STALLED_AFTER_MS / (60 * 60 * 1000)
  );
  // 권한 없음 응답에도 실린다(화면이 기준을 설명할 수 있게).
  assert.equal(
    deniedTeamAudit(NOW).criteria.stalledAfterHours,
    res.criteria.stalledAfterHours
  );
});

test("★criteria 는 화면이 문장에 끼워 넣어도 참인 값이다 — 양수·유한", () => {
  // ★literal 6 을 박지 않는다. 그건 임계값을 바꾸면 깨지는 **변경 탐지기**이지
  //   성질 검사가 아니다. 화면이 의존하는 성질은 "문장에 넣었을 때 참인가" 다:
  //   0 이나 음수면 "0시간 동안 아무 기록이 없는" 이라는 **거짓 문장**이 그려진다.
  //   (UI 티켓 `pTQuNVOI1MTzwaowegSR` 이 클라 쪽에서 같은 값을 튕겨낸다 — 여기서
  //   서버가 애초에 그런 값을 안 보낸다는 걸 보장하면 그쪽 방어가 이중이 된다.)
  for (const res of [narrow({}), deniedTeamAudit(NOW)]) {
    const h = res.criteria.stalledAfterHours;
    assert.equal(typeof h, "number");
    assert.ok(Number.isFinite(h), `유한하지 않다: ${h}`);
    assert.ok(h > 0, `양수가 아니다: ${h}`);
  }
});

test("★env 키 이름이 응답에 새지 않는다(서버 설정 정보다)", () => {
  const res = narrow({ memberKeyOf: noSaltMemberKeyOf, selfMemberKey: null });
  assert.equal(containsRawValue(res, "ANALYTICS_ID_SALT"), false);
});

test("★금지키 스캐너 제외는 withheld·notes 최상위 둘뿐이다", () => {
  // 제외가 늘면 스캐너가 장식이 된다 — 목록 자체를 못박는다.
  assert.deepEqual([...FORBIDDEN_SCAN_EXEMPT_ROOTS], ["withheld", "notes"]);
  // 제외는 **최상위에서만** 먹는다. 같은 이름이 데이터 안쪽에 있으면 여전히 훑는다.
  assert.deepEqual(findForbiddenKeys({ events: [{ notes: { result: "x" } }] }), [
    "$.events[0].notes.result",
  ]);
});

test("★사용자 문장에 운영자 낱말이 없다 — '문장은 참인데 독자가 틀린' 것을 잡는다", () => {
  // 실패하면 어떤 코드의 어떤 문장이 왜 걸렸는지 그대로 보여준다.
  const violations = findOperatorOnlyText();
  assert.deepEqual(
    violations,
    [],
    `운영자 전용 낱말이 사용자 문장에 있다:\n${violations
      .map((v) => `  [${v.label}] ${v.code}: ${v.text}`)
      .join("\n")}`
  );
});

test("사용자 문장은 전부 코드를 갖고 비어 있지 않다", () => {
  const all = allUserFacingTexts();
  // ★총계를 리터럴로 박지 않는다 — note 를 하나 더할 때마다 깨지는 **변경
  //   탐지기**가 된다(`stalledAfterHours === 6` 에서 이미 한 번 겪었다).
  //   검사할 성질은 "세 출처를 **하나도 빠뜨리지 않고** 모았나" 다.
  assert.equal(
    all.length,
    TEAM_AUDIT_WITHHELD.length +
      Object.keys(TEAM_AUDIT_RUNTIME_NOTE_TEXT_KO).length +
      TEAM_AUDIT_REASON_CODES.length
  );
  assert.ok(all.length > 20, "출처 하나가 통째로 빠졌다");
  for (const { code, text } of all) {
    assert.ok(code.length > 0);
    assert.ok(text.length > 0, `${code} 문장이 비어 있다`);
  }
  assert.equal(new Set(all.map((a) => a.code)).size, all.length);
});

test("★구현 어휘 목록이 넓지 않은지 — 멀쩡한 오너 문장을 잡으면 안 된다", () => {
  // 넓은 검사는 버그를 통과시키는 게 아니라 **멀쩡한 문장을 사람 손으로 고치게**
  // 만든다. 좁은 검사보다 조용하지 않은 대신, 손해가 실제로 발생한다.
  for (const fine of [
    "문제가 계속되면 지원팀에 알려 주세요.",
    "이 기간에 기록된 활동이 없습니다.",
    "요청하신 내용을 처리했습니다.",
    "이 목록에 포함되지 않습니다.",
  ]) {
    assert.equal(
      OPERATOR_ONLY_PATTERNS.some((p) => p.re.test(fine)),
      false,
      `멀쩡한 문장을 잡았다: ${fine}`
    );
  }
});

test("★스캐너가 실제로 잡는다(위양성 아님을 확인)", () => {
  // 패턴이 다 죽어 있으면 위 테스트가 조용히 통과한다 — 그걸 막는다.
  const samples = [
    "TEAM_USAGE_EFFECTIVE_FROM 을 설정해라",
    "audit_logs 에 쓰지 않는다",
    "merge_and_close 원장 행에서 확인한다",
    "저장소 로컬 경로(repoRoot)",
    "npm run provision 을 돌려라",
    "docs/team-usage-overview-design-2026-08-21.md 참조",
    // ★목록에 없는 새 필드명 — 아는 이름만 잡는 패턴은 전부 놓친다.
    //   실제로 기준 시간을 옮기면서 문장에 "criteria" 를 적어 넣었고, 그때
    //   다섯 패턴이 다 통과시켰다. 라틴 낱말 규칙이 그 자리를 막는다.
    "기준 시간은 criteria 에 있습니다",
    "nextCursor 를 그대로 넘기세요",
    // ★한글로 쓴 구현 어휘 — 라틴 규칙이 못 잡는다.
    "다른 구성원의 기록은 서버에서 제외됩니다",
    "콜러블이 응답하지 않았습니다",
    "캐시가 비어 있습니다",
  ];
  for (const sample of samples) {
    assert.ok(
      OPERATOR_ONLY_PATTERNS.some((p) => p.re.test(sample)),
      `스캐너가 못 잡는다: ${sample}`
    );
  }
  // 정상 문장은 안 잡혀야 한다.
  assert.equal(
    OPERATOR_ONLY_PATTERNS.some((p) =>
      p.re.test("이 기간에 기록된 활동이 없습니다.")
    ),
    false
  );
});

// ── 4c. ★값 수준 신원 스크럽 (키 스캐너가 못 잡는 자리) ──────────────────────

test("★에이전트를 이메일로 이름 지어도 응답에 안 실린다", () => {
  const res = narrow(
    {
      ledger: [
        ledgerEvent("a1", "claim_task", { agentId: "alice@example.com" }),
      ],
    },
    {
      tasks: [task("t1", { claimedBy: "alice@example.com" })],
      agents: [{ id: "alice@example.com", name: "alice@example.com" }],
    }
  );
  const json = JSON.stringify(res);
  assert.equal(json.includes("alice@example.com"), false);
  assert.equal(res.events[0].agentId, REDACTED_IDENTITY);
  assert.equal(res.tickets[0].claimedBy, REDACTED_IDENTITY);
  assert.equal(res.workload[0].name, REDACTED_IDENTITY);
  assert.equal(res.workload[0].agentId, REDACTED_IDENTITY);
});

test("★uid 모양 문자열도 가려진다", () => {
  const uid = "aB3dEfGhIjKlMnOpQrStUvWxYz12"; // 28자, 대소문자+숫자
  assert.equal(uid.length, 28);
  assert.equal(scrubIdentityLike(uid), REDACTED_IDENTITY);
});

test("★이메일은 그 부분만 가린다 — 나머지 절반까지 버리지 않는다", () => {
  // 통째로 버리면 어느 에이전트인지도 못 읽게 된다.
  assert.equal(
    scrubIdentityLike("backend-auth <ops@corp.com>"),
    `backend-auth <${REDACTED_IDENTITY}>`
  );
  assert.equal(scrubIdentityLike("ops@corp.com"), REDACTED_IDENTITY);
  // 두 개가 들어와도 둘 다.
  assert.equal(
    scrubIdentityLike("a@x.com, b@y.com"),
    `${REDACTED_IDENTITY}, ${REDACTED_IDENTITY}`
  );
});

// ★아래 넷은 "지금 맞다" 로 넘기면 나중에 깨져도 **조용해서 아무도 모르는** 부류다
//   (형제 티켓 `lt9w8LucYFpSbaEzTsgG` 가 같은 넷을 골랐다). 전부 성질로 고정한다.

test("★상태를 공유하지 않는다 — 같은 입력을 세 번 불러도 같다", () => {
  // `g` 정규식을 모듈 상수로 두면 lastIndex 가 호출 사이에 살아남아 두 번째가
  // 조용히 샌다. 팩토리로 바꿔 그 실수를 불가능하게 했고, 성질은 여기서 지킨다.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      scrubIdentityLike("x <a@b.com>"),
      `x <${REDACTED_IDENTITY}>`,
      `${i + 1}번째 호출에서 놓쳤다`
    );
  }
});

test("★구분자를 삼키지 않는다 — 쉼표·세미콜론·문장 끝 마침표", () => {
  assert.equal(
    scrubIdentityLike("a@x.com, b@y.com"),
    `${REDACTED_IDENTITY}, ${REDACTED_IDENTITY}`
  );
  assert.equal(
    scrubIdentityLike("a@x.com; b@y.com"),
    `${REDACTED_IDENTITY}; ${REDACTED_IDENTITY}`
  );
  assert.equal(
    scrubIdentityLike("메일은 a@b.com 이다."),
    `메일은 ${REDACTED_IDENTITY} 이다.`
  );
});

test("★한 문자열의 여러 개를 전부 가린다 — 첫 개만 가리고 끝나지 않는다", () => {
  const out = scrubIdentityLike("a@x.com b@y.com c@z.com");
  assert.equal(out, [REDACTED_IDENTITY, REDACTED_IDENTITY, REDACTED_IDENTITY].join(" "));
  assert.equal(out?.includes("@"), false);
});

test("★멱등 — 가린 뒤 다시 가려도 같다", () => {
  // 좁히기를 두 번 지나게 되는 날이 와도 `(가려짐)` 이 또 가려지거나 깨지면 안 된다.
  for (const input of ["a@x.com", "backend-auth <ops@corp.com>", "backend-1"]) {
    const once = scrubIdentityLike(input);
    assert.equal(scrubIdentityLike(once), once, `멱등하지 않다: ${input}`);
  }
});

test("★uid 판정 경계 — 길이·대소문자 한 끗 차이", () => {
  // 여기가 정규식이 깨지는 자리다.
  assert.equal(scrubIdentityLike("abcdefghijklmnopqrstuvwxyz12"), "abcdefghijklmnopqrstuvwxyz12"); // 28자, 소문자뿐
  assert.equal(scrubIdentityLike("aB3dEfGhIjKlMnOpQrStUvWxYz123"), "aB3dEfGhIjKlMnOpQrStUvWxYz123"); // 29자
  assert.equal(scrubIdentityLike("aB3dEfGhIjKlMnOpQrStUvW12"), "aB3dEfGhIjKlMnOpQrStUvW12"); // 25자
  assert.equal(scrubIdentityLike("aB3dEfGhIjKlMnOpQrStUvWxYz12"), REDACTED_IDENTITY); // 28자, 혼재
  // uid 토막을 품은 긴 이름은 안 잘린다(부분 일치 금지).
  assert.equal(
    scrubIdentityLike("agent-aB3dEfGhIjKlMnOpQrStUvWxYz12"),
    "agent-aB3dEfGhIjKlMnOpQrStUvWxYz12"
  );
});

test("★권한 없음 문장이 '숨긴다는 사실' 자체를 노출하지 않는다", () => {
  // 존재 여부를 숨긴다고 화면에 적으면 숨기는 목적이 절반 무효화된다
  // ("아, 여기 뭔가 있긴 하구나"). 설계 근거는 주석과 §5.3 에 있어야 한다.
  const text = reasonTextFor("no_role");
  for (const leak of ["존재", "있는지", "없는지", "숨기"]) {
    assert.equal(text.includes(leak), false, `'${leak}' 가 문장에 있다: ${text}`);
  }
});

test("★과잉 차단 금지 — 멀쩡한 에이전트 이름은 그대로 통과한다", () => {
  // 넓게 잡으면 워크로드 표가 전부 "(가려짐)" 이 되어 못 읽는다.
  for (const ok of [
    "backend-1",
    "backend-auth",
    "orchestrator-claude-p1",
    "프론트-2",
    "reviewer",
    "a1b2c3",
  ]) {
    assert.equal(scrubIdentityLike(ok), ok, `${ok} 가 과잉 차단됐다`);
  }
  assert.equal(scrubIdentityLike(null), null);
});

test("가려진 값은 '이름 없음'(null)과 구분된다", () => {
  // 화면이 "이름이 없다" 와 "가렸다" 를 같은 칸으로 그리면 안 된다.
  assert.notEqual(REDACTED_IDENTITY, null);
  assert.ok(REDACTED_IDENTITY.length > 0);
});

// ── 4d. ★조용한 절단 금지 ────────────────────────────────────────────────────
//
// 자르는 것 자체는 읽기 폭주를 막는 정당한 선택이다. **자른 사실을 숨기는 것**이
// 아니다 — 숨기면 화면이 표본을 전량으로 말한다.

test("★에이전트 목록이 잘리면 그 사실을 밝힌다", () => {
  const quiet = narrow({ agentsTruncated: false });
  assert.equal(
    quiet.notes.some((n) => n.code === "note_agents_truncated"),
    false
  );
  const loud = narrow({ agentsTruncated: true, scanTruncated: true });
  assert.ok(loud.notes.some((n) => n.code === "note_agents_truncated"));
});

test("★프로젝트 목록이 잘리면 봉투가 말한다 — 개수는 지어내지 않는다", () => {
  const quiet = narrow({});
  assert.equal(quiet.teamAudit.projectsTruncated, false);
  assert.equal(
    quiet.notes.some((n) => n.code === "note_projects_truncated"),
    false
  );

  const loud = narrow({ projectsTruncated: true, scanTruncated: true });
  assert.equal(loud.teamAudit.projectsTruncated, true);
  assert.ok(loud.notes.some((n) => n.code === "note_projects_truncated"));
  // ★"몇 개가 더 있었나" 는 Firestore 가 안 알려준다 — 모르는 숫자를 필드로
  //   내면 화면이 그걸 사실로 그린다. boolean 이어야 한다.
  assert.equal("projectsOmitted" in loud.teamAudit, false);
});

test("★잘리지 않았으면 없는 경고를 그리지 않는다", () => {
  const res = narrow({});
  for (const code of ["note_agents_truncated", "note_projects_truncated"]) {
    assert.equal(res.notes.some((n) => n.code === code), false);
  }
});

test("★잘린 에이전트 목록으로 '주인 없는 클레임' 을 판정하지 않는다", () => {
  // 잘린 목록은 "없다" 가 아니라 "모른다" 다. 잘린 채로 판정하면 상한 밖
  // 에이전트가 물고 있는 티켓이 전부 거짓 경보로 뜬다.
  // (콜러블이 agentsLoaded:false 로 넘기고, 매퍼가 판정을 생략한다.)
  const judged = narrow(
    { agentsLoaded: true },
    {
      agentsLoaded: true,
      tasks: [task("t1", { claimedBy: "상한-밖-에이전트" })],
      agents: [{ id: "backend-1", name: "backend-1" }],
    }
  );
  assert.ok(
    judged.tickets[0].attention?.kinds.includes("orphanedClaim"),
    "완전한 목록에서는 고아 클레임으로 잡혀야 한다"
  );

  const skipped = narrow(
    { agentsLoaded: false, agentsTruncated: true, scanTruncated: true },
    {
      // ★콜러블은 잘린 목록을 매퍼에도 agentsLoaded:false 로 넘긴다 — 판정 자체를
      //   생략시키는 자리가 거기다.
      agentsLoaded: false,
      tasks: [task("t1", { claimedBy: "상한-밖-에이전트" })],
      agents: [{ id: "backend-1", name: "backend-1" }],
    }
  );
  assert.equal(
    skipped.tickets[0].attention?.kinds.includes("orphanedClaim") ?? false,
    false,
    "잘린 목록으로 거짓 경보를 냈다"
  );
  assert.ok(skipped.notes.some((n) => n.code === "note_orphan_claim_unknown"));
});

test("★활동을 안 읽은 티켓에는 '정체' 를 붙이지 않는다 — 그 라벨은 사람에 대한 판단이다", () => {
  const stale = new Date(NOW - 12 * 60 * 60 * 1000); // 12시간 전
  const base = {
    tasks: [
      task("t1", { status: "IN_PROGRESS", updatedAt: stale }),
      task("t2", { status: "IN_PROGRESS", updatedAt: stale }),
    ],
  };

  // 전부 훑었으면(null) 그대로 판정한다 — "모름" 을 남발하지 않는다.
  const full = narrow({ activityScannedTaskIds: null }, base);
  assert.ok(
    full.tickets.every((t) => t.attention?.kinds.includes("stalled")),
    "완전히 훑었을 때는 정체로 잡혀야 한다"
  );
  assert.equal(
    full.notes.some((n) => n.code === "note_stalled_unknown_for_some"),
    false
  );

  // t1 만 훑었으면 t2 의 정체 판정은 뗀다.
  const partial = narrow(
    { activityScannedTaskIds: new Set(["t1"]), scanTruncated: true },
    base
  );
  const t1 = partial.tickets.find((t) => t.id === "t1");
  const t2 = partial.tickets.find((t) => t.id === "t2");
  assert.ok(t1?.attention?.kinds.includes("stalled"), "훑은 티켓은 그대로");
  assert.equal(t2?.attention, null, "안 훑은 티켓에 정체가 남았다");
  assert.ok(
    partial.notes.some((n) => n.code === "note_stalled_unknown_for_some"),
    "판정을 뗀 사실을 안 밝혔다"
  );
});

test("★'정체 없음' 과 '정체 모름' 이 타입에서 갈린다 — 배열만으로는 같은 모양이다", () => {
  const stale = new Date(NOW - 12 * 60 * 60 * 1000);
  const base = {
    tasks: [
      task("t1", { status: "IN_PROGRESS", updatedAt: stale }),
      task("t2", { status: "IN_PROGRESS", updatedAt: new Date(NOW) }), // 최근 = 정체 아님
    ],
  };
  const res = narrow(
    { activityScannedTaskIds: new Set(["t2"]), scanTruncated: true },
    base
  );
  const t1 = res.tickets.find((t) => t.id === "t1");
  const t2 = res.tickets.find((t) => t.id === "t2");

  // 둘 다 attention 이 null 이다 — 배열만 보면 구분이 안 된다.
  assert.equal(t1?.attention, null);
  assert.equal(t2?.attention, null);
  // ★그런데 뜻이 다르다: t1 은 "모름", t2 는 "정체 아님".
  assert.equal(t1?.stalledJudged, false, "유보한 티켓이 판정된 것으로 보인다");
  assert.equal(t2?.stalledJudged, true, "판정한 티켓이 유보로 보인다");
});

test("★note 와 stalledJudged 는 갈라지지 않는다 — note 있음 ⟺ 유보 티켓 존재", () => {
  const hasNote = (r: ReturnType<typeof narrow>): boolean =>
    r.notes.some((n) => n.code === "note_stalled_unknown_for_some");
  const hasUnjudged = (r: ReturnType<typeof narrow>): boolean =>
    r.tickets.some((t) => !t.stalledJudged);

  const stale = new Date(NOW - 12 * 60 * 60 * 1000);
  const fresh = new Date(NOW);
  const cases: Array<[string, Parameters<typeof narrow>[0], Parameters<typeof narrow>[1]]> = [
    ["전부 훑음", { activityScannedTaskIds: null }, {}],
    [
      // ★고치기 전에 **덜 말하던** 경우: 안 읽은 티켓이 있는데 정체 후보가 아니다.
      //   전에는 note 가 안 나가서 화면이 stalledJudged:false 만 보고 이유를 못 받았다.
      "안 읽었지만 정체 후보 아님",
      { activityScannedTaskIds: new Set(["t1"]), scanTruncated: true },
      { tasks: [task("t1", { updatedAt: fresh }), task("t2", { updatedAt: fresh })] },
    ],
    [
      "안 읽었고 정체 후보임",
      { activityScannedTaskIds: new Set(["t1"]), scanTruncated: true },
      {
        tasks: [
          task("t1", { status: "IN_PROGRESS", updatedAt: stale }),
          task("t2", { status: "IN_PROGRESS", updatedAt: stale }),
        ],
      },
    ],
    ["아무것도 안 읽음", { activityScannedTaskIds: new Set<string>(), scanTruncated: true }, {}],
  ];

  for (const [label, over, baseOver] of cases) {
    const res = narrow(over, baseOver);
    assert.equal(
      hasNote(res),
      hasUnjudged(res),
      `${label}: note 와 stalledJudged 가 어긋난다 (note=${hasNote(res)}, 유보=${hasUnjudged(res)})`
    );
  }
});

test("전부 훑었으면 모든 티켓이 판정됨으로 표시된다", () => {
  const res = narrow({ activityScannedTaskIds: null });
  assert.ok(res.tickets.length > 0);
  assert.equal(res.tickets.every((t) => t.stalledJudged), true);
});

test("★일부러 다른 짝은 이유가 비어 있으면 안 된다 — 근거 없이 미루는 걸 막는다", () => {
  assert.ok(TEAM_AUDIT_DELIBERATE_MISMATCHES.length > 0);
  for (const m of TEAM_AUDIT_DELIBERATE_MISMATCHES) {
    assert.ok(m.pair.length > 0);
    // 하한 자체보다 "이유를 쓰게 만든다" 는 강제가 요점이다.
    assert.ok(
      m.reason.length >= 30,
      `이유가 너무 짧다(근거 없이 미루는 자리): ${m.pair} — "${m.reason}"`
    );
  }
  // ★같은 짝이 불변식과 일부러-다름 양쪽에 있으면 계약이 스스로 모순된다.
  for (const m of TEAM_AUDIT_DELIBERATE_MISMATCHES) {
    assert.equal(
      TEAM_AUDIT_SUMMARY_INVARIANTS.some((i) => i === m.pair),
      false,
      `${m.pair} 가 불변식 목록에도 있다`
    );
  }
});

test("★정체를 떼도 다른 근거는 남고, 심각도는 다시 계산된다", () => {
  const stale = new Date(NOW - 12 * 60 * 60 * 1000);
  const res = narrow(
    { activityScannedTaskIds: new Set<string>(), scanTruncated: true },
    {
      // FAILED 는 정체와 무관한 근거다 — 같이 사라지면 안 된다.
      tasks: [task("t1", { status: "FAILED", updatedAt: stale })],
    }
  );
  const t = res.tickets[0];
  assert.deepEqual(t.attention?.kinds, ["taskFailed"]);
  assert.equal(t.attention?.severity, "critical");
  // 사라진 근거로 남은 값이 없어야 한다.
  assert.equal(t.attention?.idleMs, null);
});

test("★주의 개수가 목록과 어긋나지 않는다 — '3건' 이라 쓰고 2건 보이면 안 된다", () => {
  const stale = new Date(NOW - 12 * 60 * 60 * 1000);
  const res = narrow(
    { activityScannedTaskIds: new Set(["t1"]), scanTruncated: true },
    {
      tasks: [
        task("t1", { status: "IN_PROGRESS", updatedAt: stale }),
        task("t2", { status: "IN_PROGRESS", updatedAt: stale }),
        task("t3", { status: "IN_PROGRESS", updatedAt: stale }),
      ],
    }
  );
  assert.equal(res.summary.attentionCount, res.attention.length);
  assert.equal(
    res.summary.criticalCount,
    res.attention.filter((t) => t.attention?.severity === "critical").length
  );
  // 판정이 떨어진 티켓은 주의 목록에도 없어야 한다.
  assert.equal(res.attention.some((t) => t.attention === null), false);
  assert.equal(res.attention.length, 1);
});

// ── 4e. ★summary 와 목록이 어긋나지 않는다 ───────────────────────────────────
//
// 형제 티켓이 `membersWithNoRows` 에서 카운트 1 / 목록 2 로 어긋난 걸 찾았다.
// 뿌리는 **카운트를 목록과 따로 계산한 것**이다. 전 조합에서 불변식을 돌린다.

test("★summary 불변식 — 전 조합에서 카운트와 목록이 일치한다", () => {
  const stale = new Date(NOW - 12 * 60 * 60 * 1000);
  const scopes = ["team", "self"] as const;
  const scannedSets = [null, new Set(["t1"]), new Set<string>()];

  for (const scope of scopes) {
    for (const scanned of scannedSets) {
      const res = narrow(
        {
          scope,
          role: scope === "team" ? "owner" : "member",
          scanTruncated: scanned !== null,
          activityScannedTaskIds: scanned,
          ledger: [
            ledgerEvent("l1", "claim_task", { actorUid: ALICE_UID }),
            ledgerEvent("l2", "merge_and_close", { actorUid: BOB_UID }),
          ],
          merges: [mergeEvent("m1")],
        },
        {
          tasks: [
            task("t1", { status: "IN_PROGRESS", updatedAt: stale }),
            task("t2", { status: "FAILED", updatedAt: stale }),
          ],
          missions: [{ id: "m1", status: "running", taskIds: ["t1"] }],
          merges: [{ id: "m1", taskId: "t1", mergedAt: new Date(T0) }],
        }
      );
      const where = `scope=${scope} scanned=${scanned ? [...scanned] : "all"}`;

      assert.equal(res.summary.attentionCount, res.attention.length, where);
      assert.equal(
        res.summary.criticalCount,
        res.attention.filter((t) => t.attention?.severity === "critical").length,
        where
      );
      assert.equal(res.summary.agentsTotal, res.workload.length, where);
      assert.equal(res.summary.missionsTotal, res.missions.length, where);
      assert.equal(
        res.summary.eventsInWindow,
        Object.values(res.summary.eventsByKind).reduce((a, b) => a + b, 0),
        where
      );
      // 주의 목록에 판정 없는 티켓이 섞이면 카운트가 곧 거짓이 된다.
      assert.equal(
        res.attention.every((t) => t.attention !== null),
        true,
        where
      );
    }
  }
});

test("★summary 는 전부 정수다 — 허용오차가 필요한 짝이 아예 없다", () => {
  // 형제 티켓(`lt9w8LucYFpSbaEzTsgG`)이 세 번째 실패 모드를 찾았다: "맞는 짝인데
  // 정확히 같지는 않다"(버킷별 반올림 누적으로 Σ byDay ≠ totals, 차 1e-6).
  // 화면이 정확 비교를 걸면 멀쩡한 응답이 매번 빨개지고, 그러면 사람은 원인을
  // 찾는 대신 **검사를 끈다**.
  //
  // ★이 응답에는 그 부류가 **구조적으로 없다** — 금액·토큰을 전부 뺐기 때문에(§12.4)
  //   합산 대상이 전부 정수 카운트다. 그 사실을 여기서 못박는다: 누가 나중에 실수
  //   평균·비율을 summary 에 넣으면 이 테스트가 먼저 죽고, 그때 허용오차를 **의식적으로**
  //   설계하게 된다. 지금 없는 장치를 미리 만들지 않는 대신, 필요해지는 순간을 잡는다.
  const res = narrow({
    ledger: [
      ledgerEvent("l1", "claim_task"),
      ledgerEvent("l2", "merge_and_close", { atMs: T0 + 1 }),
    ],
    merges: [mergeEvent("m1")],
  });
  const numbers: Array<[string, unknown]> = [
    ...Object.entries(res.summary).filter(([, v]) => typeof v === "number"),
    ...Object.entries(res.summary.eventsByKind),
    ...Object.entries(res.summary.tasksByStatus),
    ["criteria.stalledAfterHours", res.criteria.stalledAfterHours],
    ["page.limit", res.page.limit],
    ["page.returned", res.page.returned],
  ];
  for (const [k, v] of numbers) {
    assert.equal(typeof v, "number", k);
    assert.ok(Number.isFinite(v as number), `${k} 가 유한하지 않다: ${v}`);
    assert.ok(
      Number.isInteger(v as number),
      `${k} 가 정수가 아니다(${v}) — 실수가 들어오면 합계 대조에 허용오차가 필요해진다`
    );
  }
  // eventsByKind 합 = eventsInWindow 는 **정확히** 같다(정수 합이므로).
  assert.equal(
    Object.values(res.summary.eventsByKind).reduce((a, b) => a + b, 0),
    res.summary.eventsInWindow
  );
});

test("★self 스코프에서 피드와 모순되는 머지 숫자를 내지 않는다", () => {
  // mergesTotal 은 없앴다. 머지는 피드에도 나오는데 그 숫자만 프로젝트 전체였고,
  // self 스코프에서는 피드에 머지가 0건인데 "머지 12건" 이라고 말하는 화면이 됐다.
  const res = narrow(
    {
      scope: "self",
      role: "member",
      selfMemberKey: memberKeyFor(BOB_UID),
      merges: [mergeEvent("m1"), mergeEvent("m2")],
    },
    { merges: [{ id: "m1", mergedAt: new Date(T0) }] }
  );
  assert.equal("mergesTotal" in res.summary, false);
  // 남은 머지 숫자는 보이는 것과 일치한다.
  assert.equal(res.summary.eventsByKind.merge, 0);
  assert.equal(res.events.filter((e) => e.kind === "merge").length, 0);
});

test("★일부러 다른 짝은 대조하지 않는다(오경보 방지) — 문서와 코드가 같은 말", () => {
  const ledger = Array.from({ length: 5 }, (_, i) =>
    ledgerEvent(`l${i}`, "claim_task", { atMs: T0 + i })
  );
  const res = narrow({ ledger, limit: 2 });
  // 창 기준 vs 한 페이지 — 다른 게 정상이다.
  assert.equal(res.summary.eventsInWindow, 5);
  assert.equal(res.events.length, 2);
  // 불변식 목록에 이 짝이 **없어야** 한다.
  assert.equal(
    TEAM_AUDIT_SUMMARY_INVARIANTS.some((i) => i.includes("events.length")),
    false
  );
  assert.equal(TEAM_AUDIT_SUMMARY_INVARIANTS.length, 5);
});

// ── 5. 사건 조립 ─────────────────────────────────────────────────────────────

test("티켓 제목은 남는다 — 공유 보드에 이미 떠 있는 라벨이다", () => {
  const res = narrow({ ledger: [ledgerEvent("a1", "update_task_status")] });
  assert.equal(res.events[0].taskTitle, "티켓 t1");
  assert.equal(res.events[0].taskId, "t1");
});

test("★merge_history 행의 행위자는 null 이고, 그 사실을 notes 가 밝힌다", () => {
  const res = narrow({ merges: [mergeEvent("mg1")] });
  const merge = res.events.find((e) => e.id === "merge:mg1");
  assert.ok(merge);
  assert.equal(merge?.memberKey, null);
  assert.ok(
    res.notes.some((n) => n.code === "note_merge_actor_absent"),
    "행위자 부재를 밝히는 note 가 없다"
  );
});

test("사건 분류가 화면 축과 맞는다", () => {
  const res = narrow({
    ledger: [
      ledgerEvent("c1", "create_task", { atMs: T0 + 5 }),
      ledgerEvent("t1", "update_task_status", { atMs: T0 + 4 }),
      ledgerEvent("s1", "spawn_agent", { atMs: T0 + 3 }),
      ledgerEvent("f1", "update_flow", { atMs: T0 + 2 }),
      ledgerEvent("m1", "merge_and_close", { atMs: T0 + 1 }),
    ],
  });
  assert.deepEqual(res.summary.eventsByKind, {
    task_create: 1,
    task_transition: 1,
    merge: 1,
    agent_spawn: 1,
    flow_change: 1,
  });
});

// ── 6. 페이징 ────────────────────────────────────────────────────────────────

test("커서 왕복", () => {
  const c = { at: 1_724_000_000_000, id: "ledger:abc" };
  assert.deepEqual(decodeAuditCursor(encodeAuditCursor(c)), c);
});

test("깨진 커서는 null — 호출측이 invalid-argument 로 되돌린다", () => {
  assert.equal(decodeAuditCursor("not-base64!!"), null);
  assert.equal(decodeAuditCursor(""), null);
  assert.equal(decodeAuditCursor(null), null);
  assert.equal(
    decodeAuditCursor(Buffer.from('{"at":"x"}', "utf8").toString("base64url")),
    null
  );
});

test("★페이징이 행을 건너뛰거나 중복시키지 않는다", () => {
  const ledger = Array.from({ length: 7 }, (_, i) =>
    ledgerEvent(`l${i}`, "update_task_status", { atMs: T0 + i })
  );
  const seen: string[] = [];
  let cursor = null as ReturnType<typeof decodeAuditCursor>;
  for (let page = 0; page < 10; page += 1) {
    const res = narrow({ ledger, limit: 3, cursor });
    seen.push(...res.events.map((e) => e.id));
    if (!res.page.nextCursor) {
      assert.equal(res.page.hasMore, false);
      break;
    }
    cursor = decodeAuditCursor(res.page.nextCursor);
  }
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7, "중복 행이 있다");
  // 최신순.
  assert.deepEqual(seen, [
    "ledger:l6",
    "ledger:l5",
    "ledger:l4",
    "ledger:l3",
    "ledger:l2",
    "ledger:l1",
    "ledger:l0",
  ]);
});

test("같은 시각이어도 전순서가 잡혀 커서가 안전하다", () => {
  const ledger = ["b", "a", "c"].map((s) =>
    ledgerEvent(s, "claim_task", { atMs: T0 })
  );
  const first = narrow({ ledger, limit: 2 });
  assert.deepEqual(
    first.events.map((e) => e.id),
    ["ledger:a", "ledger:b"]
  );
  const second = narrow({
    ledger,
    limit: 2,
    cursor: decodeAuditCursor(first.page.nextCursor ?? ""),
  });
  assert.deepEqual(
    second.events.map((e) => e.id),
    ["ledger:c"]
  );
});

test("시각을 못 읽은 행은 버려지지 않고 맨 뒤로 간다(조용한 누락 금지)", () => {
  const rows: TeamAuditEvent[] = [
    { atMs: null, id: "z" } as TeamAuditEvent,
    { atMs: T0, id: "a" } as TeamAuditEvent,
  ];
  rows.sort(compareEventsDesc);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["a", "z"]
  );

  const res = narrow({
    ledger: [
      ledgerEvent("l1", "claim_task", { atMs: null }),
      ledgerEvent("l2", "claim_task", { atMs: T0 }),
    ],
  });
  assert.deepEqual(
    res.events.map((e) => e.id),
    ["ledger:l2", "ledger:l1"]
  );
  assert.equal(res.summary.eventsInWindow, 2);
});

test("페이지 크기는 접히고 던지지 않는다", () => {
  assert.equal(normalizeLimit(undefined), DEFAULT_TEAM_AUDIT_LIMIT);
  assert.equal(normalizeLimit(0), DEFAULT_TEAM_AUDIT_LIMIT);
  assert.equal(normalizeLimit(-5), DEFAULT_TEAM_AUDIT_LIMIT);
  assert.equal(normalizeLimit("abc"), DEFAULT_TEAM_AUDIT_LIMIT);
  assert.equal(normalizeLimit(10_000), MAX_TEAM_AUDIT_LIMIT);
  assert.equal(normalizeLimit(25), 25);
});

// ── 7. 봉투 상태 ─────────────────────────────────────────────────────────────

test("봉투: 사건 0건이면 empty + 사유", () => {
  const res = narrow({});
  assert.equal(res.teamAudit.state, "empty");
  assert.equal(res.teamAudit.reasonCode, "no_events");
  assert.equal(typeof res.teamAudit.reason, "string");
});

test("★소스를 못 읽었으면 행이 0건이어도 empty 라고 말하지 않는다", () => {
  // ★이 케이스가 없어서 버그가 살아남았다. 기존 검사 둘은
  //   "0건 + 소스 정상"(empty) 과 "행 있음 + 소스 실패"(partial) 만 봤고,
  //   **"0건 + 소스 실패"** 라는 교차점을 아무도 안 봤다.
  //
  //   `empty` 는 "사건이 0 건이다" 라는 **적극적 주장**이다. 못 읽었을 때 우리가
  //   아는 건 0 이 아니라 아무것도 없다 — 색인 부재로 쿼리가 통째로 죽어도
  //   `auditQuery` 가 빈 배열로 삼키므로, 이 구분이 없으면 **완전 실패가
  //   "사건 없음" 으로 위장**된다.
  const res = narrow({ ledger: [], merges: [], sourcesIncomplete: true });
  assert.equal(res.summary.eventsInWindow, 0);
  assert.notEqual(res.teamAudit.state, "empty");
  assert.equal(res.teamAudit.state, "partial");
  assert.equal(res.teamAudit.reasonCode, "partial_sources");
});

test("소스를 다 읽었을 때만 0건을 '없음' 이라고 말한다", () => {
  const res = narrow({ ledger: [], merges: [], sourcesIncomplete: false });
  assert.equal(res.teamAudit.state, "empty");
  assert.equal(res.teamAudit.reasonCode, "no_events");
});

test("self 스코프의 0건은 진짜 0 이다 — 서버가 의도적으로 닫은 것", () => {
  // 소스가 멀쩡해도, 안 멀쩡해도 가명을 못 만들면 서버가 스스로 0 으로 만든다.
  // 그건 "모름" 이 아니라 "닫았음" 이라 empty 로 말해도 거짓이 아니다.
  for (const incomplete of [false, true]) {
    const res = narrow({
      scope: "self",
      role: "member",
      memberKeyOf: noSaltMemberKeyOf,
      selfMemberKey: null,
      sourcesIncomplete: incomplete,
    });
    assert.equal(res.teamAudit.state, "empty");
    assert.equal(res.teamAudit.reasonCode, "self_scope_unattributable");
  }
});

test("봉투: 소스 일부 실패면 partial — 빈 칸이 0 으로 읽히지 않게", () => {
  const res = narrow({
    ledger: [ledgerEvent("a1", "claim_task")],
    sourcesIncomplete: true,
  });
  assert.equal(res.teamAudit.state, "partial");
  assert.equal(res.teamAudit.reasonCode, "partial_sources");
});

test("봉투: 스캔 절단이면 partial", () => {
  const res = narrow({
    ledger: [ledgerEvent("a1", "claim_task")],
    scanTruncated: true,
  });
  assert.equal(res.teamAudit.state, "partial");
  assert.equal(res.teamAudit.reasonCode, "scan_truncated");
});

test("봉투: 정상이면 complete + 사유 null, basis 는 항상 실린다", () => {
  const res = narrow({ ledger: [ledgerEvent("a1", "claim_task")] });
  assert.equal(res.teamAudit.state, "complete");
  assert.equal(res.teamAudit.reasonCode, null);
  assert.equal(res.teamAudit.reason, null);
  // ★라벨 없는 목록 금지.
  assert.equal(res.teamAudit.basis, "project_event_ledger");
  assert.equal(res.teamAudit.scope, "team");
  assert.equal(res.teamAudit.role, "owner");
});

test("요약은 페이지가 아니라 창 기준이다(페이지마다 총계가 달라지지 않는다)", () => {
  const ledger = Array.from({ length: 5 }, (_, i) =>
    ledgerEvent(`l${i}`, "claim_task", { atMs: T0 + i })
  );
  const p1 = narrow({ ledger, limit: 2 });
  const p2 = narrow({
    ledger,
    limit: 2,
    cursor: decodeAuditCursor(p1.page.nextCursor ?? ""),
  });
  assert.equal(p1.summary.eventsInWindow, 5);
  assert.equal(p2.summary.eventsInWindow, 5);
  assert.equal(p1.page.returned, 2);
  assert.equal(p1.page.hasMore, true);
});
