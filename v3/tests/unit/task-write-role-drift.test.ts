/**
 * 역할표 ↔ firestore.rules drift 가드 — 보드 티켓 write (티켓 aMVwzZY1QeJSFxDm4N4K).
 *
 * 무엇이 갈라졌었나: `src/types/invitation.ts` 의 `ROLE_PERMISSIONS` 는 viewer
 * 에게 `read` 만 준다. 그런데 `firestore.rules` 의 tasks 블록은 **프로젝트
 * 멤버이기만 하면** create/update/delete 를 허용했고 REVIEW→DONE 전이만 막았다.
 * 즉 "읽기 전용"으로 초대한 사람이 보드 티켓을 만들고 지울 수 있었다. 저장소
 * push 는 같은 `write` 퍼미션으로 이미 막혀 있었으므로(githubApp.roleCanWriteRepo)
 * 룰 한쪽만 넓었던 드리프트다.
 *
 * 왜 소스를 스캔하나: 룰은 TS 를 import 할 수 없어 판정이 두 벌로 존재한다
 * (TEAM_COLLAB_PLANS 와 같은 MIRROR 규약). 에뮬레이터 테스트
 * (`firestore.rules.test.ts`)는 "지금의 viewer 가 막히는가"를 확인하지만,
 * **역할이 새로 늘었을 때** 룰이 그 역할을 빠뜨리는 것은 못 잡는다 — 새 역할용
 * 케이스를 아무도 안 써 주기 때문이다. 그래서 여기서는 두 소스의 **집합**을
 * 직접 맞춰 본다: 룰이 배제하는 역할 집합 == 역할표에서 `write` 가 없는 역할 집합.
 *
 * 이 테스트가 깨지면 고칠 곳은 둘 중 하나다.
 *   - 역할표에 write 없는 역할을 추가했다면 → firestore.rules 의 canWriteTasks
 *     에 그 역할을 배제 조건으로 추가한다.
 *   - 룰만 조였다면 → 역할표를 진실원으로 되돌린다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROLE_PERMISSIONS,
  type InvitationRole,
} from "../../src/types/invitation";
import {
  canWriteTasksAsRole,
  resolveBoardWriteGate,
} from "../../src/lib/teamRoles";
import { PLAN_LIMITS } from "../../src/lib/planLimits";
import type { PlanType } from "../../src/types/subscription";

const V3_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const RULES_SRC = readFileSync(path.join(V3_DIR, "firestore.rules"), "utf8");

const ALL_ROLES: InvitationRole[] = ["owner", "admin", "member", "viewer"];

/**
 * `<헤더>` 부터 중괄호 균형이 맞는 지점까지의 원문을 잘라낸다. 정규식 한 줄
 * 매칭으로는 여러 줄에 걸친 룰 블록을 통째로 놓친다.
 *
 * ★균형 계산은 헤더의 **마지막 `{`** 부터 시작한다 — `match /tasks/{taskId} {`
 * 처럼 헤더 자체에 와일드카드 중괄호가 들어 있으면 그걸 블록 여는 괄호로 세서
 * 헤더 한 줄만 잘라 오게 된다.
 */
function extractBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start === -1) {
    throw new Error(`firestore.rules 에서 '${header}' 를 찾지 못했다`);
  }
  const bodyStart = start + header.lastIndexOf("{");
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`'${header}' 블록의 중괄호가 닫히지 않았다`);
}

/** `allow <op>:` 부터 다음 `allow` 또는 블록 끝까지 — 그 op 의 조건식 원문. */
function extractAllowClause(block: string, op: string): string {
  const re = new RegExp(`allow\\s+${op}\\s*:`);
  const m = re.exec(block);
  if (!m) throw new Error(`tasks 블록에 'allow ${op}:' 이 없다`);
  const rest = block.slice(m.index + m[0].length);
  const next = /\ballow\s+\w+\s*:/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

describe("보드 티켓 write 권한 — 역할표 ↔ firestore.rules MIRROR", () => {
  it("canWriteTasksAsRole 은 ROLE_PERMISSIONS 의 write 를 그대로 파생한다", () => {
    // 별도 목록을 두는 순간 갈라진다 — 표에서 파생하는지 자체를 고정한다.
    for (const role of ALL_ROLES) {
      expect(canWriteTasksAsRole(role)).toBe(
        ROLE_PERMISSIONS[role].includes("write"),
      );
    }
    // 현재 값의 스냅샷 — 표가 조용히 바뀌면 여기서 먼저 걸린다.
    expect(ALL_ROLES.map(canWriteTasksAsRole)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(canWriteTasksAsRole(null)).toBe(false);
    expect(canWriteTasksAsRole(undefined)).toBe(false);
  });

  it("tasks 의 create/update/delete 는 전부 canWriteTasks 게이트를 탄다", () => {
    const tasksBlock = extractBlock(RULES_SRC, "match /tasks/{taskId} {");
    for (const op of ["create", "update", "delete"]) {
      const clause = extractAllowClause(tasksBlock, op);
      expect(
        clause,
        `tasks allow ${op} 이 canWriteTasks 를 타지 않는다`,
      ).toContain("canWriteTasks(");
      // 멤버십만 보는 옛 게이트로 되돌아가면 viewer 가 다시 열린다.
      expect(
        clause.includes("isProjectMember("),
        `tasks allow ${op} 이 다시 isProjectMember 로 열렸다`,
      ).toBe(false);
    }
    // read 는 그대로 멤버 경계여야 한다 — viewer 는 "읽기 전용"이지 "안 보임"이 아니다.
    expect(extractAllowClause(tasksBlock, "read")).toContain(
      "isProjectMember(",
    );
  });

  it("룰이 배제하는 역할 집합 == 역할표에서 write 가 없는 역할 집합", () => {
    const fn = extractBlock(RULES_SRC, "function canWriteTasks(projectId) {");

    // `getMemberRole(...) != '<role>'` 형태로 배제된 역할을 전부 모은다.
    const excludedInRules = new Set(
      [...fn.matchAll(/!=\s*'([a-z]+)'/g)].map((m) => m[1]),
    );
    const excludedInTable = new Set(
      ALL_ROLES.filter((r) => !ROLE_PERMISSIONS[r].includes("write")),
    );

    expect([...excludedInRules].sort()).toEqual([...excludedInTable].sort());
  });

  it("canWriteTasks 는 ownerId 우선 + 문서 없음=member 규약을 유지한다", () => {
    const fn = extractBlock(RULES_SRC, "function canWriteTasks(projectId) {");
    // ownerId 가 역할 문서를 이긴다 — memberRoles 에 'viewer' 가 잘못 써져도
    // 프로젝트 owner 가 자기 보드에서 잠기면 안 된다.
    expect(fn).toContain("isProjectOwner(projectId)");
    // 역할 문서가 없는 레거시 멤버는 getMemberRole 이 'member' 로 접는다.
    // 여기를 memberRoleExists 기반의 fail-closed 로 바꾸면 그들이 전부 잠긴다.
    expect(fn).toContain("getMemberRole(projectId, request.auth.uid)");
    // 멤버십 경계는 그대로 유지된다(남의 프로젝트에 쓰기 금지).
    expect(fn).toContain("isProjectMember(projectId)");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 팀 협업 엔타이틀먼트 — 플랜표 ↔ firestore.rules MIRROR (티켓 gT9EXiONpzqFwY1xjc3n)
//
// TEAM_COLLAB_PLANS 는 이제 세 벌이다: functions/src/githubApp.ts ·
// src/lib/planLimits.ts(hasTeamCollab) · firestore.rules(planGrantsTeamCollab).
// 앞 둘의 drift 는 githubApp.test.ts 가 잡고, 룰 사본은 여기서 소스 스캔으로
// 잡는다 — 플랜이 늘거나 이름이 바뀌면 세 곳이 함께 움직여야 한다.
// ─────────────────────────────────────────────────────────────────────────
describe("팀 협업 엔타이틀먼트 — 플랜표 ↔ firestore.rules MIRROR", () => {
  const teamCollabPlansInTable = (
    Object.keys(PLAN_LIMITS) as PlanType[]
  ).filter((p) => PLAN_LIMITS[p].hasTeamCollab);

  it("룰의 플랜 목록 == planLimits 의 hasTeamCollab 집합", () => {
    const fn = extractBlock(
      RULES_SRC,
      "function planGrantsTeamCollab(sub) {",
    );
    const listMatch = /in\s*\[([^\]]+)\]/.exec(fn);
    expect(listMatch, "planGrantsTeamCollab 에 플랜 목록이 없다").toBeTruthy();
    const plansInRules = [...listMatch![1].matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(plansInRules.sort()).toEqual([...teamCollabPlansInTable].sort());
  });

  it("canWriteTasks 는 비오너 분기에서 ownerHasTeamCollab 를 탄다", () => {
    const fn = extractBlock(RULES_SRC, "function canWriteTasks(projectId) {");
    expect(fn).toContain("ownerHasTeamCollab(projectId)");
    // 오너 분기가 남아 있어야 한다 — 지우면 free 솔로 사용자가 자기 보드에서
    // 잠긴다(유료 게이트가 아니라 제품 파손).
    expect(fn).toContain("isProjectOwner(projectId)");
  });

  it("tasks read 는 플랜 게이트를 타지 않는다 — '보기만 가능' 유지", () => {
    const tasksBlock = extractBlock(RULES_SRC, "match /tasks/{taskId} {");
    expect(extractAllowClause(tasksBlock, "read")).not.toContain(
      "ownerHasTeamCollab",
    );
  });

  it("invitations create 는 플랜 게이트를 탄다 — 신규 초대 초크포인트", () => {
    const invBlock = extractBlock(
      RULES_SRC,
      "match /invitations/{invitationId} {",
    );
    expect(extractAllowClause(invBlock, "create")).toContain(
      "ownerHasTeamCollab(",
    );
    // read/update/delete 는 플랜 축이 없다 — 기존 초대의 수락·취소·열람을
    // 소급으로 죽이지 않는다.
    for (const op of ["read", "update", "delete"]) {
      expect(extractAllowClause(invBlock, op)).not.toContain(
        "ownerHasTeamCollab",
      );
    }
  });

  it("엔타이틀먼트 판정이 entitlement.ts 규칙 요소를 모두 갖춘다", () => {
    const fn = extractBlock(
      RULES_SRC,
      "function planGrantsTeamCollab(sub) {",
    );
    // planType 킬스위치(목록 밖 = free 포함 전부 거부)는 `in [...]` 가 담당.
    // active: 기간 미기록은 유료 유지 + 기간 있으면 3일 갱신유예.
    expect(fn).toContain("'active'");
    expect(fn).toContain("duration.value(3, 'd')");
    // canceled: 잔여기간만, 유예 없음.
    expect(fn).toContain("'canceled'");
  });

  it("resolveBoardWriteGate 는 룰과 같은 판정 + 사유를 가른다", () => {
    // 오너: 플랜 무관 통과(free 솔로 보존).
    expect(
      resolveBoardWriteGate({
        role: "owner",
        isProjectOwner: true,
        ownerPlanHasTeamCollab: false,
      }),
    ).toEqual({ canWrite: true, reason: null });
    // viewer: 플랜이 있어도 역할 사유.
    expect(
      resolveBoardWriteGate({
        role: "viewer",
        isProjectOwner: false,
        ownerPlanHasTeamCollab: true,
      }),
    ).toEqual({ canWrite: false, reason: "role" });
    // member + 플랜 없음: 요금제 사유 — 역할 사유와 갈라진다.
    expect(
      resolveBoardWriteGate({
        role: "member",
        isProjectOwner: false,
        ownerPlanHasTeamCollab: false,
      }),
    ).toEqual({ canWrite: false, reason: "plan" });
    // 미상은 낙관하지 않는다(룰이 fail-closed 인데 화면만 열리면 조용한 실패).
    expect(
      resolveBoardWriteGate({
        role: "member",
        isProjectOwner: false,
        ownerPlanHasTeamCollab: undefined,
      }),
    ).toEqual({ canWrite: false, reason: "plan" });
    // member + 팀 플랜: 통과.
    expect(
      resolveBoardWriteGate({
        role: "member",
        isProjectOwner: false,
        ownerPlanHasTeamCollab: true,
      }),
    ).toEqual({ canWrite: true, reason: null });
  });
});
