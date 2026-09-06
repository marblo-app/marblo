/**
 * 5단 드릴다운 계약 테스트.
 *
 * 이 계약이 실패하는 방식은 다섯이고, 아래 블록이 하나씩 대응한다:
 *   1. ★결측을 0 으로 접는다 → "안 썼다" 라는 없는 사실이 생긴다.
 *   2. ★하네스족을 실제 모델로 승격시킨다 → 발표에서 solar·kimi 가 claude 로 뜬다.
 *   3. ★부분집합을 총계로 그린다 → 총계 − 내 것 = 남의 것(뺄셈 누수).
 *   4. ★두 성공/실패 축을 섞는다 → 계정 축 숫자가 익명 축 성공률로 읽힌다.
 *   5. ★사람이 안 붙은 머지를 아무에게나 붙인다 → 화면이 거짓말한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARNESS_FAMILY_IDS,
  MODEL_UNKNOWN_KEY,
  PERSON_OUTCOME_MIN_SAMPLE,
  buildProjectDetail,
  canDrawSuccessRate,
  classifyModelKey,
  decidePersonScopeAccess,
  drillLevelOf,
  foldLedgerPersonAxis,
  foldModelAxis,
  isSubsetVisible,
  memberModelAxisOf,
  parentDrillPath,
  personCostCell,
  personOutcomeAxisOf,
  personOutcomeEnvelopeFor,
  reconcilePersonSum,
  resolveVisibleMembers,
  successRateOf,
  type DrilldownPersonRow,
} from "./orgDrilldownContract";
import {
  normalizeTeamUsage,
  type ByMemberRow,
} from "../team/teamUsageContract";
import { normalizeTeamAudit } from "../team/teamAuditContract";

const KEY_A = "tm_aaaaaaaa";
const KEY_B = "tm_bbbbbbbb";

function member(over: Partial<ByMemberRow> = {}): ByMemberRow {
  return {
    memberKey: KEY_A,
    displayName: null,
    costUsd: 0,
    tokens: 0,
    share: null,
    hasRows: true,
    byModel: [],
    byActorKind: [],
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 층 — 경로가 층을 정한다
// ════════════════════════════════════════════════════════════════════════════

test("층은 상위가 채워진 만큼만 내려간다", () => {
  assert.equal(drillLevelOf({}), "org");
  assert.equal(drillLevelOf({ teamId: "t1" }), "team");
  assert.equal(drillLevelOf({ teamId: "t1", projectId: "p1" }), "project");
  assert.equal(
    drillLevelOf({ teamId: "t1", projectId: "p1", memberKey: KEY_A }),
    "person"
  );
});

test("★미지정 팀(null)은 '안 내려갔다' 가 아니다 — 팀 단으로 친다", () => {
  assert.equal(drillLevelOf({ teamId: null }), "team");
  assert.equal(drillLevelOf({ teamId: null, projectId: "p1" }), "project");
});

test("★상위가 비었는데 하위만 있으면 상위에서 끊는다", () => {
  assert.equal(drillLevelOf({ projectId: "p1" }), "org");
  assert.equal(drillLevelOf({ memberKey: KEY_A }), "org");
  assert.equal(drillLevelOf({ teamId: "t1", memberKey: KEY_A }), "team");
});

test("★가명 공간 밖 키로는 사람 단이 안 열린다 — 원시 uid 를 경로에 못 싣는다", () => {
  const raw = {
    teamId: "t1",
    projectId: "p1",
    memberKey: "aBcD1234efGH5678ijKL9012",
  };
  assert.equal(drillLevelOf(raw), "project");
  const usKey = { teamId: "t1", projectId: "p1", memberKey: "us_deadbeef" };
  assert.equal(drillLevelOf(usKey), "project");
});

test("한 단 올라가면 그 단의 키만 지워진다", () => {
  assert.deepEqual(
    parentDrillPath({ teamId: null, projectId: "p1", memberKey: KEY_A }),
    { teamId: null, projectId: "p1" }
  );
  assert.deepEqual(parentDrillPath({ teamId: "t1", projectId: "p1" }), {
    teamId: "t1",
  });
  assert.deepEqual(parentDrillPath({ teamId: "t1" }), {});
  assert.deepEqual(parentDrillPath({}), {});
});

// ════════════════════════════════════════════════════════════════════════════
// 2. ★모델 축 — 하네스족을 실제 모델로 승격시키지 않는다
// ════════════════════════════════════════════════════════════════════════════

test("★하네스족 문자열은 모델이 아니다 — 실제 모델 미상으로 분류된다", () => {
  for (const harness of HARNESS_FAMILY_IDS) {
    assert.deepEqual(classifyModelKey(harness), {
      kind: "harnessOnly",
      harnessId: harness,
    });
  }
});

test("구체 모델 id 는 그대로 모델이다", () => {
  assert.deepEqual(classifyModelKey("claude-opus-5"), {
    kind: "model",
    modelId: "claude-opus-5",
  });
  assert.deepEqual(classifyModelKey("solar-pro4"), {
    kind: "model",
    modelId: "solar-pro4",
  });
  assert.deepEqual(classifyModelKey("MiniMax-M3"), {
    kind: "model",
    modelId: "MiniMax-M3",
  });
});

test("효과(@effort)는 벗긴다 — 단가·집계 축은 모델 id 다", () => {
  assert.deepEqual(classifyModelKey("solar-pro4@high"), {
    kind: "model",
    modelId: "solar-pro4",
  });
  // 하네스에 효과가 붙어도 여전히 하네스다 — 벗긴 뒤 판정한다.
  assert.deepEqual(classifyModelKey("gpt@medium"), {
    kind: "harnessOnly",
    harnessId: "gpt",
  });
});

test("★모델명이 없으면 '모른다' 다 — 하네스도 0 도 아니다", () => {
  for (const bad of [null, undefined, "", "   ", MODEL_UNKNOWN_KEY, "@high"]) {
    assert.deepEqual(classifyModelKey(bad), { kind: "unknown" }, String(bad));
  }
});

test("★두 축의 금액을 따로 센다 — 화면이 '이만큼은 모른다' 를 숫자로 말한다", () => {
  const fold = foldModelAxis([
    { model: "claude-opus-5", costUsd: 10, tokens: 100 },
    { model: "claude", costUsd: 4, tokens: 40 },
    { model: MODEL_UNKNOWN_KEY, costUsd: 1, tokens: 10 },
  ]);
  assert.equal(fold.measuredCostUsd, 10);
  assert.equal(fold.harnessOnlyCostUsd, 4);
  assert.equal(fold.unknownCostUsd, 1);
  // 합은 보존된다 — 분류가 금액을 삼키지 않는다.
  assert.equal(
    fold.measuredCostUsd + fold.harnessOnlyCostUsd + fold.unknownCostUsd,
    15
  );
  assert.equal(fold.rows.length, 3);
});

test("금액이 같으면 실제 모델이 먼저 온다 — 표 첫 줄이 '미상' 이 되지 않게", () => {
  const fold = foldModelAxis([
    { model: "claude", costUsd: 5, tokens: 1 },
    { model: "claude-opus-5", costUsd: 5, tokens: 1 },
  ]);
  assert.deepEqual(
    fold.rows.map((r) => r.rawKey),
    ["claude-opus-5", "claude"]
  );
});

test("★하네스 목록이 정본(model-registry)과 어긋나지 않는다", () => {
  const registry = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../v3/electron/model-registry.ts"
    ),
    "utf8"
  );
  const block = registry.match(
    /export const HARNESS_IDS:[^=]*=\s*\[([\s\S]*?)\]\s*as const;/
  );
  assert.ok(block, "정본에서 HARNESS_IDS 를 못 찾았다 — 이름이 바뀌었나?");
  const canonical = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...HARNESS_FAMILY_IDS].sort(),
    canonical.sort(),
    "하네스 목록이 갈라졌다 — 새 하네스가 실제 모델로 둔갑한다"
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 3. ★결측 ≠ 0 — 네 가지 부재를 넷으로 그린다
// ════════════════════════════════════════════════════════════════════════════

test("★기록 없음 · 모름 · 실측 0 은 셋 다 다르다", () => {
  assert.deepEqual(personCostCell(member({ hasRows: true, costUsd: 0 })), {
    kind: "measured",
    costUsd: 0,
    tokens: 0,
  });
  assert.deepEqual(personCostCell(member({ hasRows: false })), {
    kind: "noRecords",
  });
  assert.deepEqual(personCostCell(member({ hasRows: null })), {
    kind: "unknown",
  });
});

test("★모델 분해가 비었을 때 네 가지 뜻을 배열 길이로 접지 않는다", () => {
  // 옛 배포 — 행은 있는데 분해가 안 왔다. "안 썼다" 가 아니다.
  assert.deepEqual(memberModelAxisOf(member({ hasRows: true })), {
    kind: "unwired",
  });
  // 기록 자체가 없다.
  assert.deepEqual(memberModelAxisOf(member({ hasRows: false })), {
    kind: "noRows",
  });
  // 스코프가 잘려 모른다.
  assert.deepEqual(memberModelAxisOf(member({ hasRows: null })), {
    kind: "unknown",
  });
  // 실측.
  const axis = memberModelAxisOf(
    member({
      hasRows: true,
      byModel: [{ model: "claude-opus-5", costUsd: 3, tokens: 30 }],
      byActorKind: [{ actorKind: "worker", costUsd: 3, tokens: 30 }],
    })
  );
  assert.equal(axis.kind, "measured");
});

test("★잘린 스코프에서는 분해가 있어도 '모름' 이 이긴다 — 잘린 표본 위 판정 금지", () => {
  const axis = memberModelAxisOf(
    member({
      hasRows: null,
      byModel: [{ model: "claude-opus-5", costUsd: 3, tokens: 30 }],
    })
  );
  assert.deepEqual(axis, { kind: "unknown" });
});

test("★기록 없는 사람의 토큰은 0 이 아니라 null 이다", () => {
  const detail = buildProjectDetail(
    normalizeTeamUsage({
      teamUsage: { state: "complete" },
      byMember: [
        { memberKey: KEY_A, hasRows: false, costUsd: 0, tokens: 0 },
        { memberKey: KEY_B, hasRows: true, costUsd: 2, tokens: 20 },
      ],
    }),
    normalizeTeamAudit({ teamAudit: { state: "empty" }, events: [] })
  );
  assert.equal(detail.kind, "data");
  if (detail.kind !== "data") return;
  const a = detail.persons.find((p) => p.memberKey === KEY_A);
  const b = detail.persons.find((p) => p.memberKey === KEY_B);
  assert.equal(a?.tokens, null);
  assert.equal(b?.tokens, 20);
});

// ════════════════════════════════════════════════════════════════════════════
// 4. ★불변식 S ⊆ visible(u) — Phase 2 의 프로젝트 집합 검사를 사람 집합으로
// ════════════════════════════════════════════════════════════════════════════

test("집합 포함 검사 자체", () => {
  assert.equal(isSubsetVisible([], []), true);
  assert.equal(isSubsetVisible([KEY_A], [KEY_A, KEY_B]), true);
  assert.equal(isSubsetVisible([KEY_A, KEY_B], [KEY_A]), false);
});

test("★원장이 막히면 가시 집합은 공집합이다 — 부분집합이 없다", () => {
  const restricted = foldLedgerPersonAxis(
    normalizeTeamAudit({
      teamAudit: { state: "disabled", reasonCode: "no_role" },
      events: [],
    })
  );
  assert.equal(restricted.kind, "restricted");
  assert.deepEqual(resolveVisibleMembers(restricted, [KEY_A, KEY_B]), []);
  assert.deepEqual(decidePersonScopeAccess([KEY_A], restricted), {
    kind: "restricted",
    requires: "project_admin",
  });
});

test("★권한이 있으면 전수가 가시 집합이다 — 그 사이(부분집합)는 없다", () => {
  const ok = foldLedgerPersonAxis(
    normalizeTeamAudit({ teamAudit: { state: "complete" }, events: [] })
  );
  assert.deepEqual(resolveVisibleMembers(ok, [KEY_A, KEY_B]), [KEY_A, KEY_B]);
  assert.deepEqual(decidePersonScopeAccess([KEY_A, KEY_B], ok), {
    kind: "full",
  });
});

test("★멤버가 하나라도 가시 집합 밖이면 총계를 그리지 않는다(뺄셈 누수 차단)", () => {
  // 부분 가시 역할이 생겼다고 가정한 상황을 집합으로 직접 만든다 — 판정 함수가
  // 역할 지름길이 아니라 집합 포함으로 도는지 증명한다.
  assert.equal(isSubsetVisible([KEY_A, KEY_B], [KEY_A]), false);
});

test("★원장이 restricted 면 사용량이 보여도 사람 단을 안 연다", () => {
  const detail = buildProjectDetail(
    normalizeTeamUsage({
      teamUsage: { state: "complete" },
      byMember: [{ memberKey: KEY_A, hasRows: true, costUsd: 9, tokens: 90 }],
    }),
    normalizeTeamAudit({
      teamAudit: {
        state: "disabled",
        reasonCode: "no_role",
        reason: "역할이 없습니다",
      },
      events: [],
    })
  );
  assert.equal(detail.kind, "restricted");
  if (detail.kind !== "restricted") return;
  assert.equal(detail.requires, "project_admin");
  // ★숫자 필드가 아예 없다 — 0 으로 접힐 값 자체를 안 만든다.
  assert.equal("persons" in detail, false);
  assert.equal(JSON.stringify(detail).includes("9"), false);
});

// ════════════════════════════════════════════════════════════════════════════
// 5. ★계정 축 원장 — 사람에게 붙는 것과 안 붙는 것
// ════════════════════════════════════════════════════════════════════════════

test("원장 사건이 사람별로 접힌다 — 티켓 수는 중복 제거된다", () => {
  const axis = foldLedgerPersonAxis(
    normalizeTeamAudit({
      teamAudit: { state: "complete" },
      events: [
        {
          id: "1",
          kind: "task_transition",
          action: "claim_task",
          memberKey: KEY_A,
          taskId: "T1",
          success: true,
        },
        {
          id: "2",
          kind: "task_transition",
          action: "update_task_status",
          memberKey: KEY_A,
          taskId: "T1",
          success: false,
        },
        {
          id: "3",
          kind: "merge",
          action: "merge_and_close",
          memberKey: KEY_A,
          taskId: "T2",
          success: true,
        },
        {
          id: "4",
          kind: "task_create",
          action: "create_task",
          memberKey: KEY_B,
          taskId: "T3",
          success: null,
        },
      ],
    })
  );
  assert.equal(axis.kind, "measured");
  if (axis.kind !== "measured") return;
  const a = axis.rows.find((r) => r.memberKey === KEY_A);
  assert.equal(a?.events, 3);
  assert.equal(a?.tasksTouched, 2, "T1 이 두 번 나와도 티켓은 둘이다");
  assert.equal(a?.successes, 2);
  assert.equal(a?.failures, 1);
  assert.equal(a?.merges, 1);
  const b = axis.rows.find((r) => r.memberKey === KEY_B);
  assert.equal(b?.successes, 0);
  assert.equal(b?.failures, 0, "판정 없음(null)은 실패가 아니다");
});

test("★병합 이력 행은 사람이 없다 — 아무에게도 안 붙이고 따로 센다", () => {
  const axis = foldLedgerPersonAxis(
    normalizeTeamAudit({
      teamAudit: { state: "complete" },
      events: [
        {
          id: "1",
          kind: "task_transition",
          action: "claim_task",
          memberKey: KEY_A,
          taskId: "T1",
          success: true,
        },
        {
          id: "m1",
          kind: "merge",
          action: "merge_history",
          memberKey: null,
          taskId: "T1",
          success: null,
          merge: {
            branch: "b",
            prNumber: 1487,
            filesChanged: 3,
            linesAdded: 10,
            linesDeleted: 2,
          },
        },
      ],
    })
  );
  assert.equal(axis.kind, "measured");
  if (axis.kind !== "measured") return;
  assert.equal(axis.unattributedMerges, 1);
  assert.deepEqual(axis.mergeRequestNumbers, [1487]);
  // ★그 머지가 KEY_A 의 머지 건수로 새지 않는다.
  assert.equal(axis.rows.find((r) => r.memberKey === KEY_A)?.merges, 0);
});

test("★가명 공간 밖 행위자는 버린다 — 익명 라벨로 살려 두지 않는다", () => {
  const axis = foldLedgerPersonAxis(
    normalizeTeamAudit({
      teamAudit: { state: "complete" },
      events: [
        {
          id: "1",
          kind: "task_create",
          action: "create_task",
          memberKey: "us_leak",
          taskId: "T1",
          success: true,
        },
      ],
    })
  );
  assert.equal(axis.kind, "measured");
  if (axis.kind !== "measured") return;
  assert.equal(axis.rows.length, 0);
});

test("★잘린 원장은 '전부가 아니다' 를 싣는다 — 조용한 절단 금지", () => {
  const axis = foldLedgerPersonAxis(
    normalizeTeamAudit({
      teamAudit: { state: "partial", reasonCode: "scan_truncated" },
      events: [
        {
          id: "1",
          kind: "task_create",
          action: "create_task",
          memberKey: KEY_A,
          taskId: "T1",
          success: true,
        },
      ],
    })
  );
  assert.equal(axis.kind, "measured");
  if (axis.kind !== "measured") return;
  assert.equal(axis.truncated, true);
});

test("봉투가 없거나 상태 축이 없으면 미배선이다 — 0 건이 아니다", () => {
  assert.deepEqual(foldLedgerPersonAxis(null), { kind: "unwired" });
  assert.deepEqual(foldLedgerPersonAxis(normalizeTeamAudit({})), {
    kind: "unwired",
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. ★익명 설치 축 성과 — T₀ 경계. 오늘은 미배선이고, 표본 미만이면 % 금지
// ════════════════════════════════════════════════════════════════════════════

test("★사람 축 성과는 오늘 미배선이다 — 0% 로 그리지 않는다", () => {
  assert.deepEqual(personOutcomeAxisOf(null), { kind: "unwired" });
  assert.deepEqual(personOutcomeAxisOf(undefined), { kind: "unwired" });
  const detail = buildProjectDetail(
    normalizeTeamUsage({
      teamUsage: { state: "complete" },
      byMember: [{ memberKey: KEY_A, hasRows: true, costUsd: 1, tokens: 1 }],
    }),
    normalizeTeamAudit({ teamAudit: { state: "complete" }, events: [] })
  );
  assert.equal(detail.kind, "data");
  if (detail.kind !== "data") return;
  assert.deepEqual(detail.persons[0].outcome, { kind: "unwired" });
});

test("배선되면 각인 시작일과 판정 건수가 실린다", () => {
  assert.deepEqual(
    personOutcomeAxisOf({
      stampedFrom: "2026-09-01",
      decided: 40,
      successes: 38,
    }),
    {
      kind: "measured",
      stampedFrom: "2026-09-01",
      decided: 40,
      successes: 38,
      byModel: [],
    }
  );
  // 숫자가 아직 없으면 적재 전이다 — 0 이 아니다.
  assert.deepEqual(personOutcomeAxisOf({ stampedFrom: "2026-09-01" }), {
    kind: "pending",
    stampedFrom: "2026-09-01",
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6b. ★모델별 분해 배선 (티켓 85dkAQMiYauFwg1Z9kaH) — getTeamProjectOutcomeAxis
// ════════════════════════════════════════════════════════════════════════════

test("모델별 성공률이 원본 문자열 그대로 실린다 — 분류는 이 함수가 안 한다", () => {
  const axis = personOutcomeAxisOf({
    stampedFrom: "2026-04-01",
    decided: 40,
    successes: 38,
    byModel: [
      { model: "claude-opus-5", decided: 30, successes: 29 },
      { model: "claude", decided: 10, successes: 9 }, // 하네스족 — 분류는 안 한다
    ],
  });
  assert.equal(axis.kind, "measured");
  if (axis.kind !== "measured") return;
  assert.deepEqual(axis.byModel, [
    { model: "claude-opus-5", decided: 30, successes: 29 },
    { model: "claude", decided: 10, successes: 9 },
  ]);
});

test("★뮤테이션 — byModel 항목 중 숫자가 깨지면 그 항목만 버리고 나머지는 산다", () => {
  const axis = personOutcomeAxisOf({
    stampedFrom: "2026-04-01",
    decided: 10,
    successes: 9,
    byModel: [
      { model: "claude-opus-5", decided: 10, successes: 9 },
      { model: "broken", decided: "열" /* 숫자가 아니다 */, successes: 1 },
      "not-an-object",
      null,
    ],
  });
  assert.equal(axis.kind, "measured");
  if (axis.kind !== "measured") return;
  assert.deepEqual(axis.byModel, [
    { model: "claude-opus-5", decided: 10, successes: 9 },
  ]);
});

test("personOutcomeEnvelopeFor — 팀 봉투가 disabled 면 사유를 실어 unwired 로 접는다", () => {
  const axis = personOutcomeAxisOf(
    personOutcomeEnvelopeFor(
      { state: "disabled", reasonCode: "gate_unset", reason: "게이트 미설정" },
      KEY_A
    )
  );
  assert.deepEqual(axis, { kind: "unwired", reason: "게이트 미설정" });
});

test("personOutcomeEnvelopeFor — 로스터엔 있지만 이 사람 결정 건이 아직 없으면 pending", () => {
  const teamEnvelope = {
    state: "measured",
    stampedFrom: "2026-04-01",
    members: [{ memberKey: "tm_other", decided: 5, successes: 5, byModel: [] }],
  };
  const axis = personOutcomeAxisOf(
    personOutcomeEnvelopeFor(teamEnvelope, KEY_A)
  );
  assert.deepEqual(axis, { kind: "pending", stampedFrom: "2026-04-01" });
});

test("personOutcomeEnvelopeFor — 이 사람 몫을 찾으면 그 사람의 byModel 만 실린다(다른 사람과 안 섞인다)", () => {
  const teamEnvelope = {
    state: "measured",
    stampedFrom: "2026-04-01",
    members: [
      {
        memberKey: KEY_A,
        decided: 20,
        successes: 19,
        byModel: [{ model: "claude-opus-5", decided: 20, successes: 19 }],
      },
      {
        memberKey: "tm_other",
        decided: 5,
        successes: 1,
        byModel: [{ model: "gpt-6-astra", decided: 5, successes: 1 }],
      },
    ],
  };
  const axis = personOutcomeAxisOf(
    personOutcomeEnvelopeFor(teamEnvelope, KEY_A)
  );
  assert.deepEqual(axis, {
    kind: "measured",
    stampedFrom: "2026-04-01",
    decided: 20,
    successes: 19,
    byModel: [{ model: "claude-opus-5", decided: 20, successes: 19 }],
  });
});

test("buildProjectDetail 이 outcomeAxis 4번째 인자를 실제로 사람별로 갈라 넣는다", () => {
  const detail = buildProjectDetail(
    normalizeTeamUsage({
      teamUsage: { state: "complete" },
      byMember: [{ memberKey: KEY_A, hasRows: true, costUsd: 1, tokens: 1 }],
    }),
    normalizeTeamAudit({ teamAudit: { state: "complete" }, events: [] }),
    { kind: "unwired" },
    {
      state: "measured",
      stampedFrom: "2026-04-01",
      members: [
        {
          memberKey: KEY_A,
          decided: 40,
          successes: 38,
          byModel: [{ model: "claude-opus-5", decided: 40, successes: 38 }],
        },
      ],
    }
  );
  assert.equal(detail.kind, "data");
  if (detail.kind !== "data") return;
  assert.deepEqual(detail.persons[0].outcome, {
    kind: "measured",
    stampedFrom: "2026-04-01",
    decided: 40,
    successes: 38,
    byModel: [{ model: "claude-opus-5", decided: 40, successes: 38 }],
  });
});

test("★표본이 모자라면 퍼센트를 그리지 않는다", () => {
  assert.equal(PERSON_OUTCOME_MIN_SAMPLE, 35);
  assert.equal(canDrawSuccessRate(34), false);
  assert.equal(canDrawSuccessRate(35), true);
  assert.equal(canDrawSuccessRate(0), false);
});

test("★분모가 0 이면 성공률은 모른다 — 0% 가 아니다", () => {
  assert.equal(successRateOf(0, 0), null);
  assert.equal(successRateOf(0, 4), 0, "실측 0% 는 0 이다");
  assert.equal(successRateOf(2, 4), 0.5);
});

// ════════════════════════════════════════════════════════════════════════════
// 7. ★사람 합 ≠ 프로젝트 합 — 차이를 삼키지 않는다
// ════════════════════════════════════════════════════════════════════════════

function personRow(cost: number | null): DrilldownPersonRow {
  return {
    memberKey: KEY_A,
    displayName: null,
    cost:
      cost === null
        ? { kind: "noRecords" }
        : { kind: "measured", costUsd: cost, tokens: 0 },
    tokens: null,
    models: { kind: "noRows" },
    ledger: null,
    outcome: { kind: "unwired" },
  };
}

test("★귀속 불가 행 때문에 사람 합이 프로젝트 합보다 작으면 차이를 밝힌다", () => {
  const r = reconcilePersonSum([personRow(3), personRow(2)], 7);
  assert.equal(r.personSumUsd, 5);
  assert.equal(r.gapUsd, 2);
  assert.equal(r.hasGap, true);
});

test("반올림 오차는 차이로 치지 않는다 — 오경보 금지", () => {
  const r = reconcilePersonSum([personRow(1.0000001)], 1);
  assert.equal(r.hasGap, false);
});

test("프로젝트 합을 모르면 대조하지 않는다", () => {
  const r = reconcilePersonSum([personRow(3)], null);
  assert.equal(r.gapUsd, null);
  assert.equal(r.hasGap, false);
});

test("★기록 없는 사람은 합에 0 으로도 안 들어간다(칸이 숫자가 아니다)", () => {
  const r = reconcilePersonSum([personRow(3), personRow(null)], 3);
  assert.equal(r.personSumUsd, 3);
  assert.equal(r.hasGap, false);
});

// ════════════════════════════════════════════════════════════════════════════
// 8. 신뢰 경계 — 어떤 입력이 와도 던지지 않는다
// ════════════════════════════════════════════════════════════════════════════

test("깨진 입력에도 던지지 않는다", () => {
  const bads: unknown[] = [null, undefined, 0, "", [], { byMember: "nope" }];
  for (const bad of bads) {
    assert.doesNotThrow(() => {
      buildProjectDetail(normalizeTeamUsage(bad), normalizeTeamAudit(bad));
    }, String(bad));
    assert.doesNotThrow(() => foldLedgerPersonAxis(normalizeTeamAudit(bad)));
    assert.doesNotThrow(() => personOutcomeAxisOf(bad));
  }
});

test("두 봉투가 다 없으면 오류다 — 빈 화면이 아니다", () => {
  assert.deepEqual(buildProjectDetail(null, null), { kind: "error" });
});
