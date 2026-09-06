/**
 * 실행 원장 축 규율 — 소스 스캔 가드. `org-usage-axis-guard.test.ts` 의 상속이다
 * (티켓 uYcCq9DRPLT8ZEh0rlkh "★#1497 의 축 가드... 원장 행에도 확장해라").
 *
 * ★두 층을 따로 본다:
 *   서버(`teamExecutionLedger.ts`) — 실제 권한 판정이 여기 있다. 역할 문자열을
 *     **받는다**(그게 정본이다) — 대신 owner/admin 만 통과시키는지, 스크럽을
 *     실제로 호출하는지, 미션 목표를 새로 만들지 않는지를 본다.
 *   화면 계약(`teamExecutionLedgerContract.ts`) — 서버가 이미 판정을 끝낸
 *     `envelope.state` 만 옮긴다. ★역할 문자열이 **한 글자도** 없어야 한다 —
 *     있으면 화면이 권한을 다시 계산하려 한 것이고, 그 경로는 §6.1("조직
 *     역할은 프로젝트 내용을 안 준다")을 화면 쪽에서 깰 수 있는 자리다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SERVER_SRC = readFileSync(
  path.resolve(HERE, "../../functions/src/teamExecutionLedger.ts"),
  "utf8",
);
const CONTRACT_SRC = readFileSync(
  path.resolve(
    HERE,
    "../../../marblo-web/src/app/[locale]/team/teamExecutionLedgerContract.ts",
  ),
  "utf8",
);
const VIEW_SRC = readFileSync(
  path.resolve(
    HERE,
    "../../../marblo-web/src/app/[locale]/org/OrgDrilldownView.tsx",
  ),
  "utf8",
);

const FORBIDDEN_EXACT = [
  "marblo_identity",
  "analytics_user_install",
  "v_person_since_link",
  "v_person_all_time",
  "task_outcomes",
  "agent_heartbeats",
  "analytics_user_daily",
  "analytics_install_profile",
];

describe("서버 — S ⊆ visible(u): owner/admin 은 전부, 그 외는 공집합", () => {
  it("★판정 함수가 존재한다(정확한 이름)", () => {
    expect(
      SERVER_SRC.includes("export function narrowExecutionLedgerForTeam("),
    ).toBe(true);
  });

  it("★member/none 은 restricted·no_role 로 접힌다 — 부분집합(자기 행만)이 없다", () => {
    const body = SERVER_SRC.match(
      /export function narrowExecutionLedgerForTeam[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    // owner/admin 이 아니면 즉시 닫는 분기가 있어야 한다.
    expect(body![0].includes('role !== "owner" && role !== "admin"')).toBe(
      true,
    );
    expect(body![0].includes("restricted_role")).toBe(true);
    // ★자기 행만 남기는 부분집합 필터가 없다 — 원장 행 배열에 .filter 를 걸어
    //   "이건 네 것" 이라 주장하는 코드가 있으면 이 검사가 잡는다.
    expect(/rows\.filter\(/.test(body![0])).toBe(false);
  });

  it("★비용 게이트(TEAM_USAGE_EFFECTIVE_FROM)를 역할과 별개로 본다", () => {
    const body = SERVER_SRC.match(
      /export function narrowExecutionLedgerForTeam[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    expect(body![0].includes("gate.open")).toBe(true);
  });

  it("★미션 목표는 원장에서 새로 만들지 않는다 — 항상 null 로 접는다", () => {
    expect(SERVER_SRC.includes("missionGoal: null")).toBe(true);
  });

  it("★값 수준 신원 스크럽을 실제로 호출한다(키 검사만으로 끝내지 않는다)", () => {
    expect(SERVER_SRC.includes("scrubIdentityLike")).toBe(true);
  });

  it("★익명축·링크축 표 이름이 등장하지 않는다", () => {
    for (const name of FORBIDDEN_EXACT) {
      expect(SERVER_SRC.includes(name)).toBe(false);
    }
  });
});

describe("화면 계약 — 역할을 다시 계산하지 않는다(서버 판정을 그대로 옮긴다)", () => {
  it("★역할 문자열 리터럴이 파일에 없다", () => {
    // ★따옴표째로 본다 — "admin" 낱말 자체는 `"../admin/ExecutionLedgerSection"`
    //   경로 문자열에도 합법적으로 나온다(재사용 import). 검사 대상은 역할
    //   **값**으로 비교하는 코드이지 경로 세그먼트가 아니다.
    for (const roleLiteral of [
      '"owner"',
      '"admin"',
      '"member"',
      "org_owner",
      "org_admin",
      "org_member",
      "OrgRole",
      "TeamProjectRole",
    ]) {
      expect(CONTRACT_SRC.includes(roleLiteral)).toBe(false);
    }
  });

  it("★정규화 함수는 서버의 state 를 그대로 읽지, 부분집합을 새로 만들지 않는다", () => {
    const body = CONTRACT_SRC.match(
      /export function normalizeTeamExecutionLedger[\s\S]*?\n}/,
    );
    expect(body).not.toBeNull();
    for (const narrowing of [".filter(", ".slice(", ".splice("]) {
      expect(body![0].includes(narrowing)).toBe(false);
    }
  });

  it("★미션 목표는 화면 계약에서도 다시 한번 null 로 접는다(이중 방어)", () => {
    expect(CONTRACT_SRC.includes("missionGoal: null")).toBe(true);
  });

  it("★익명축 표 이름과 실행 로그 원문 필드가 없다", () => {
    for (const name of FORBIDDEN_EXACT) {
      expect(CONTRACT_SRC.includes(name)).toBe(false);
    }
    for (const field of ["toolArgs", "stdout", "transcript"]) {
      expect(CONTRACT_SRC.includes(field)).toBe(false);
    }
  });

  it("★firebase·firestore 를 import 하지 않는다(순수 모듈 유지)", () => {
    const specifiers = [...CONTRACT_SRC.matchAll(/\bfrom\s+"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(/firebase|firestore/.test(spec)).toBe(false);
    }
  });
});

describe("드릴다운 화면 — 원장 섹션도 계약이 정규화한 값만 그린다", () => {
  it("★실행 원장 컴포넌트를 재사용한다 — 두 번 만들지 않는다", () => {
    expect(VIEW_SRC.includes('from "../admin/ExecutionLedgerSection"')).toBe(
      true,
    );
    // ★JSX 사용은 정확히 한 곳 — 여러 자리에서 각자 다르게 게이팅하면 그중
    //   하나가 조용히 새로운 노출 경로가 된다.
    const usages = VIEW_SRC.match(/<ExecutionLedgerSection\b/g) ?? [];
    expect(usages.length).toBe(1);
  });

  it("★firebase·httpsCallable 을 이 화면에서 직접 부르지 않는다(기존 규율 유지)", () => {
    for (const call of ["onSnapshot(", "httpsCallable(", "getDocs("]) {
      expect(VIEW_SRC.includes(call)).toBe(false);
    }
  });
});
