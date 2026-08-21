// 팀 오버뷰 — 순수 로직(BigQuery/Firebase 무의존). `personAxis.ts` 와 같은 규약으로
// index.ts 의 콜러블에서 떼어내 `node --test` 로 단위검증한다.
//
// 설계 정본: docs/team-usage-overview-design-2026-08-21.md (PR #1103).
// 프론트 계약: docs/team-usage-summary-contract-2026-08-21.md
//   — `state` 다섯 값의 뜻, 사유가 i18n 키인지 문장인지, 역할에 따라 봉투가
//     어떻게 달라지는지가 거기 있다. ★타입을 바꾸면 그 문서도 같은 커밋에서 고쳐라.
// ★이 파일은 그 문서를 구현한다. 다르게 가야 할 이유를 찾으면 여기서 고치지 말고
//   문서를 고치는 티켓을 내라 — 코드와 문서가 갈리면 다음 사람이 코드를 믿는다.
//
// ── 이 모듈이 지키는 다섯 ────────────────────────────────────────────────────
//
//  1) ★게이트. `TEAM_USAGE_EFFECTIVE_FROM` 이 unset 이면 팀 스코프는 **0행 + 사유**다.
//     던지지도(팀 탭 전체가 죽는다), 조용히 전체를 보여주지도(고지 없이 열린다) 않는다.
//     본인(self) 스코프는 게이트 밖이다 — 배포된 처리방침이 이미 "본인 정산 확인"
//     목적을 고지하고 있고 `getCostSummary` 로 제공 중인 기능이라 새 목적이 아니다.
//
//  2) ★`0` 과 `미수집` 과 `적재 전` 은 **셋 다 다른 뜻**이고, 이 화면에서는 그
//     구분이 전부다.
//       - `0`      : 행이 있고 합이 0 이다.            → state `complete`/`partial` + 합계 0
//       - `미수집` : 수집 배선이 없어 행이 안 생긴다.  → `orchestratorAxis.state`
//       - `적재 전`: 파이프라인(뷰 프로비저닝)이 안 돌았다. → state `not_provisioned`
//     오케 칸을 `0` 으로 그리면 오너가 "오케는 공짜" 로 읽는다. 2026-06 실측으로는
//     전체 지출의 **29%** 였고, 2026-06-22 이후로 한 행도 안 잡힌다.
//
//  3) ★금액은 **'청구액' 이 아니다.** 좌석(seat) 개념이 코드에 존재하지 않아
//     ("누구 몫으로 청구되나" 를 답할 원장이 없다) 이 화면이 답할 수 있는 것은
//     "누가 얼마 썼나" 뿐이다. 라벨은 '사용량 환산 비용(추정)' 하나로 고정한다.
//
//  4) ★일반 멤버는 **자기 것만** 본다. 팀 총계도 못 본다 — 2인 팀에서
//     `팀_총계 − 내_사용량 = 상대방 사용량` 이라 총계를 여는 순간 약속이 산술로
//     깨진다(차분 공격). 그리고 지금 유일한 다중 멤버 프로젝트가 정확히 2인이다.
//
//  5) ★원시 uid·이메일은 응답·캐시·로그 어디에도 안 남긴다. 밖으로 나가는 것은
//     이 화면 전용 가명 공간(`tm_`)뿐이고, 그 공간은 다른 축의 조인 키와 **다르다**.
//
// ── ★익명축을 읽지 않는다 ───────────────────────────────────────────────────
//   이 화면이 읽는 표는 계정 원장 하나(`cost_logs`)와 그 파생 뷰 둘뿐이다. 익명축
//   표 이름이 이 파일 소스에 **등장하는 것 자체**를 소스 스캔 가드가 실패로 잡는다
//   (`v3/tests/unit/team-usage-axis-guard.test.ts`). 오케 사용량이 없다고 익명축
//   활동으로 추정해 채우는 것은 금지다 — 정답은 추정이 아니라 수집이다.
//
// ── ★솔트를 SQL 에 넣지 마라 ────────────────────────────────────────────────
//   BigQuery 는 쿼리 본문을 job 히스토리에 수개월 보관한다(#915 계승). 가명화는
//   전부 Node 안에서, 결과를 받은 뒤에 한다. 그래서 뷰는 계정 uid 를 그대로 내고
//   (그 값은 원장에 이미 있다) BQ 밖으로 나가는 것은 가명뿐이다.

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";

// ════════════════════════════════════════════════════════════════════════════
// 1. 게이트 — 만들되 켜지 않는다
// ════════════════════════════════════════════════════════════════════════════

/** env 키. 값은 'YYYY-MM-DD'(UTC 날짜). ★기본값을 코드에 두지 않는다. */
export const TEAM_USAGE_EFFECTIVE_FROM_ENV = "TEAM_USAGE_EFFECTIVE_FROM";

// ── ★사유는 독자가 둘이다: 화면(오너)과 로그(운영자) ───────────────────────
//
// 이 구분을 안 하면 배포 직후 **가장 흔한 상태**에서 사고가 난다. 화면규칙 1 이
// `state === "disabled"` 일 때 **`disabledReason` 문장만** 그리라고 하는데, 게이트는
// 고지 개정 전까지 닫혀 있는 게 정상이다. 즉 이 화면의 기본 모습이 그 문장 하나다.
// 거기에 env 키 이름이나 내부 문서 경로가 박혀 있으면 오너가 보는 것은 제품이
// 아니라 **남의 배포 런북**이다.
//
// ★그래서 두 벌로 나눈다. `…_NOTE` 는 화면이 그대로 그려도 되는 문장이고,
//   `…_OPERATOR_NOTE` 는 **서버 로그 전용**이다 — 봉투에 싣지 않는다.
//   (형제 티켓 IcjPf2SEs0ORUGLZgCHS 가 같은 부류의 버그를 자기 쪽에서 잡았다:
//    공용 매퍼의 note 를 그대로 흘렸더니 그 뷰에서는 참이 아닌 문장이 나갔다.
//    재사용은 맞지만, 재사용한 문장이 **내 뷰에서도 참인지**는 별개다.)

/**
 * ★기본값을 두지 않는 이유는 `personAxis` 와 같다: 기본값이 있으면 "어느 환경이
 * 열려 있는지" 를 env 가 아니라 배포 시점이 정하게 되고, 되돌릴 때 코드 배포가
 * 필요해진다. 그리고 env 를 빠뜨린 환경에서 조용히 열리는 길이 된다.
 */
export const TEAM_USAGE_EFFECTIVE_FROM_UNSET_NOTE =
  "팀 사용량 열람이 아직 열려 있지 않습니다. 사용량·비용 기록은 지금 " +
  "'본인의 구독·정산 확인' 목적으로만 보관한다고 안내하고 있어, 팀 오너가 " +
  "개별 멤버의 사용량을 보는 기능은 안내 개정과 사전 통지 뒤에 열립니다. " +
  "본인 사용량은 지금도 볼 수 있습니다.";

/** ★서버 로그 전용. 봉투에 싣지 않는다 — 오너에게 보여줄 문장이 아니다. */
export const TEAM_USAGE_EFFECTIVE_FROM_UNSET_OPERATOR_NOTE =
  "TEAM_USAGE_EFFECTIVE_FROM 미설정 — 팀 스코프가 닫혀 있다. 이건 설계된 " +
  "기본 상태다(고지 개정 전). 개정·통지 배포 후 그 발효일을 이 키에 넣어라. " +
  "(설계 §5.1 / docs/team-usage-overview-design-2026-08-21.md §10-T10)";

const TEAM_USAGE_EFFECTIVE_FROM_INVALID_NOTE =
  "팀 사용량 열람이 아직 열려 있지 않습니다. 본인 사용량은 지금도 볼 수 있습니다.";

/** ★서버 로그 전용. 이건 **설정 실수**이므로 운영자가 봐야 한다. */
export const TEAM_USAGE_EFFECTIVE_FROM_INVALID_OPERATOR_NOTE =
  "TEAM_USAGE_EFFECTIVE_FROM 값이 'YYYY-MM-DD' 가 아니다 — 상한을 못 세우므로 " +
  "닫은 채로 둔다. 잘못된 상한으로 여는 것보다 닫힌 편이 안전하다. " +
  "★이건 설계된 상태가 아니라 설정 오류다.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 게이트 판정 결과. 닫혀 있으면 **반드시** 사유를 들고 다닌다. */
export type TeamUsageGate =
  | {
      readonly open: false;
      readonly reasonCode: "unset" | "invalid";
      /** ★화면이 그대로 그려도 되는 문장. */
      readonly reason: string;
      /** ★서버 로그 전용. 봉투에 싣지 않는다. */
      readonly operatorReason: string;
      readonly effectiveFrom: null;
    }
  | {
      readonly open: true;
      readonly reasonCode: null;
      readonly reason: null;
      readonly operatorReason: null;
      readonly effectiveFrom: string;
    };

/** 'YYYY-MM-DD' 가 실재하는 날짜인가(2026-02-31 같은 값을 거른다). */
function isRealDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * 게이트를 연다/닫는다. ★던지지 않는다 — 닫힘은 정상 상태다.
 *
 * 호출측은 `gate.open === false` 면 **질의 자체를 하지 않고** 0행과 `gate.reason`
 * 을 돌려주면 된다(`buildTeamUsageEnvelope` 가 그 모양을 만든다).
 */
export function resolveTeamUsageGate(
  env: Record<string, string | undefined> = process.env
): TeamUsageGate {
  const raw = env[TEAM_USAGE_EFFECTIVE_FROM_ENV];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) {
    return {
      open: false,
      reasonCode: "unset",
      reason: TEAM_USAGE_EFFECTIVE_FROM_UNSET_NOTE,
      operatorReason: TEAM_USAGE_EFFECTIVE_FROM_UNSET_OPERATOR_NOTE,
      effectiveFrom: null,
    };
  }
  if (!isRealDate(trimmed)) {
    return {
      open: false,
      reasonCode: "invalid",
      reason: TEAM_USAGE_EFFECTIVE_FROM_INVALID_NOTE,
      operatorReason: TEAM_USAGE_EFFECTIVE_FROM_INVALID_OPERATOR_NOTE,
      effectiveFrom: null,
    };
  }
  return {
    open: true,
    reasonCode: null,
    reason: null,
    operatorReason: null,
    effectiveFrom: trimmed,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 라벨 — ★기준 라벨 없는 숫자 금지 (#1090/#1076 규약 계승)
// ════════════════════════════════════════════════════════════════════════════
//
// ── ★문장이냐 키냐 (프론트 계약) ────────────────────────────────────────────
//
// 봉투에 실리는 사유·라벨은 **둘 다** 나간다:
//
//   `xxxReasonCode` / `xxxNoteCode` : **안정 식별자**. 프론트의 i18n 키다.
//                                     ★이 값이 계약이고, 바뀌면 파괴적 변경이다.
//   `xxxReason` / `xxxNote`         : ko-KR 원문. **번역이 없을 때의 폴백**이다.
//
// 왜 둘 다 내나: 설계 §7 은 "화면이 이 문장을 그대로 그린다" 였는데, marblo-web
// 에는 영문 로케일이 있다. 문장만 내면 영어 화면에 한국어가 박히고, 키만 내면
// 번역이 안 붙은 순간 화면이 **아무 사유도 못 그린다** — 그게 이 화면에서 제일
// 나쁜 결과다(왜 비었는지 말 못 하는 빈 화면). 그래서 키로 그리되 없으면 원문을
// 그린다.
//
// ★코드 목록은 **더하는 형태로만** 관리한다. 지우면 프론트의 번역이 조용히
//   빈 문자열이 된다.

export const TEAM_USAGE_NOTE_CODES = [
  // 게이트
  "gate_unset",
  "gate_invalid",
  // 데이터 상태
  "not_provisioned",
  // 스코프
  "no_team_scope",
  "member_self_only",
  "projects_truncated",
  "coverage_partial_scope",
  "member_rows_unknown",
  // 오케 축
  "orchestrator_not_collected",
  "orchestrator_legacy_segment",
  // 커버리지
  "telemetry_opt_out",
  "rows_zero",
  "rows_without_task",
  "unattributed_rows",
  // 라벨
  "basis_account_ledger",
  "cost_estimated_usage",
  "cost_not_billing",
] as const;

export type TeamUsageNoteCode = typeof TEAM_USAGE_NOTE_CODES[number];


/** 응답에 항상 실리는 집계 근거. 화면은 이걸 배지로 그린다. */
export const TEAM_USAGE_BASIS = "account_ledger";

export const TEAM_USAGE_BASIS_LABEL =
  "실행한 기기에 **로그인한 계정** 기준으로 집계합니다. 작업을 시킨 사람이 " +
  "아니라 실제로 돌린 계정입니다 — 한 사람 기기에서 남의 작업을 돌리면 " +
  "그 사람 앞으로 잡힙니다.";

/**
 * ★금액 라벨. 이 문자열 말고 다른 이름을 쓰지 마라.
 *
 * 좌석(seat) 엔티티가 코드에 존재하지 않는다. 결제 원장은 전부 개인 uid 키이고
 * 팀 좌석·팀 결제라는 개념 자체가 없다. 그래서 이 화면은 "누가 얼마 썼나" 는
 * 답하되 **"누구 몫으로 청구되나" 는 답하지 않는다.** 없는 답을 있는 척하는 게
 * 이 화면이 할 수 있는 가장 나쁜 일이다.
 */
export const TEAM_USAGE_COST_LABEL = "사용량 환산 비용(추정)";

export const TEAM_USAGE_COST_NOT_BILLING_NOTE =
  "★이 금액은 청구액이 아닙니다. 사용량을 그 시점 모델 단가로 환산한 " +
  "추정치이고, '누구 몫으로 청구되는지' 는 이 화면이 답하지 않습니다.";

/**
 * ★"안 썼다" 와 "안 보냈다" 는 다르다. 텔레메트리를 끈 멤버는 행을 남기지 않으므로
 * 화면에서 0 으로 보인다. 오너가 이 숫자로 사람을 평가하면 옵트아웃한 사람이
 * 가장 일 안 한 사람이 된다. 멤버 순위 옆에 이 문장을 항상 그린다.
 */
export const TELEMETRY_OPT_OUT_NOTE =
  "0 은 '안 썼다' 가 아니라 '안 보냈다' 일 수 있습니다 — 사용량 전송을 끈 " +
  "멤버는 기록을 남기지 않습니다. ★이 순위는 근무 평가 자료가 아닙니다.";

/** 팀 스코프 권한이 없을 때. ★프로젝트의 존재 여부를 말하지 않는다. */
export const TEAM_SCOPE_DENIED_NOTE =
  "볼 수 있는 팀 사용량이 없습니다 — 팀 전체 사용량은 그 프로젝트의 " +
  "소유자 또는 관리자만 볼 수 있습니다.";

/**
 * ★조용한 절단 금지. 프로젝트가 상한을 넘으면 **합계가 전체의 합이 아니다** —
 * 그 사실을 말하지 않으면 화면이 "이게 전부" 라고 거짓말한다.
 */
export const PROJECTS_TRUNCATED_NOTE =
  "프로젝트가 많아 일부만 집계했습니다 — 아래 숫자는 전체 프로젝트의 합이 " +
  "아닙니다. 보고 싶은 프로젝트를 골라서 다시 조회해 주세요.";

/**
 * ★잘린 스코프 위에서 계산한 비율·집계의 분모를 밝힌다.
 *
 * 비율 자체는 표시된 숫자와 일관되지만, 화면에 라벨이 없으면 오너는 그것을
 * **전량 기준**으로 읽는다. 어느 분모인지 말해야 비율이 거짓말을 안 한다.
 */
export const COVERAGE_PARTIAL_SCOPE_NOTE =
  "아래 비율과 집계는 **집계에 포함된 프로젝트만** 기준입니다 — 전체 기준이 아닙니다.";

/**
 * ★판정을 뗀 것이 "문제 없음" 으로 읽히면, 오탐을 고치려다 **반대쪽 거짓말**이 된다.
 *
 * `hasRows: null` 은 타입으로 오독을 막는다 — 프론트가 `false` 로 접을 수 없다.
 * 그런데 타입은 **프론트가 지켜야** 성립하고, 화면이 뭘 그리든 오너에게 닿는 것은
 * **문장**이다. 그래서 둘 다 둔다: 타입이 접기를 막고, 문장이 오독을 막는다.
 * (형제 티켓 IcjPf2SEs0ORUGLZgCHS 가 자기 '정체' 판정을 뗄 때 문장 쪽을 먼저
 *  세웠고, 그쪽 방어선이 한 겹 더 앞이라는 게 맞다.)
 */
export const MEMBER_ROWS_UNKNOWN_NOTE =
  "일부 멤버는 기록 여부를 확인하지 못했습니다 — ★**기록이 없다는 뜻이 아닙니다.** " +
  "집계에 포함되지 않은 프로젝트에 기록이 있을 수 있습니다.";

/** 일반 멤버가 team 스코프를 요청했을 때. */
export const MEMBER_SELF_ONLY_NOTE =
  "멤버는 자기 사용량만 봅니다. 팀 합계도 보이지 않습니다 — 2인 팀에서는 " +
  "'팀 합계 − 내 사용량' 이 곧 상대방의 사용량이 되기 때문입니다.";

/** 뷰가 아직 없을 때. ★`0` 으로 그리면 거짓말이다. */
export const TEAM_USAGE_NOT_PROVISIONED_NOTE =
  "사용량 집계가 아직 준비되지 않았습니다(적재 전). " +
  "★이건 사용량이 0 이라는 뜻이 아닙니다 — 아직 집계를 못 읽고 있다는 뜻입니다.";

/** ★서버 로그 전용. 조치가 있는 쪽은 운영자다. */
export const TEAM_USAGE_NOT_PROVISIONED_OPERATOR_NOTE =
  "팀 사용량 뷰가 없다(프로비저닝 미실행). " +
  "`cd v3/functions && npm run provision:team-usage -- --apply` 를 돌려라.";

/** projectId 결측 행. 금액을 빼는 이유는 §3.1 참조. */
export const UNATTRIBUTED_ROWS_NOTE =
  "어느 프로젝트의 사용량인지 알 수 없는 기록은 팀 집계에서 제외했습니다 — " +
  "건수만 밝히고 금액은 세지 않습니다. ★이 화면은 전부가 아닙니다.";

/** 델타 0 행 비율. */
export const ROWS_ZERO_NOTE =
  "기록 중에는 사용량이 0 인 빈 기록이 섞여 있습니다(주기적으로 남는 기록). " +
  "★건수는 활동량이 아닙니다 — 금액과 토큰으로만 읽어 주세요.";

/** taskId 결측 비율. */
export const ROWS_WITHOUT_TASK_NOTE =
  "어떤 작업에서 나온 사용량인지 알 수 없는 기록의 비율입니다. " +
  "작업별로 나눠 보는 화면은 이만큼 덜 정확합니다.";

// ── 오케 축 ──────────────────────────────────────────────────────────────────

/**
 * ★오케 사용량은 **0 이 아니라 미수집이다.**
 *
 * 실측: `agentId LIKE 'orchestrator-%'` 기준으로 2026-06 에 $22,329(전체 지출의
 * 29%)였다가 2026-06-22 부로 **0행**이 됐다. 코드에도 붙을 자리가 없다 —
 * 오케 세션은 비용 트래커에 도달하지 않고, PTY 훅은 `agent-` 접두 세션에서만
 * 트래커를 부른다. 별건 티켓이 그 배선을 복구 중이다.
 *
 * ★`0` 으로 그리면 오너가 "오케는 공짜" 로 읽는다. 빈 칸 + 이 사유로 그려라.
 */
export const ORCHESTRATOR_NOT_COLLECTED_NOTE =
  "오케스트레이터 사용량은 아직 수집되지 않습니다 — 0 이 아니라 미수집입니다. " +
  "2026-06-22 이후 한 건도 기록되지 않았습니다. 마지막으로 기록되던 2026-06 " +
  "기준으로는 전체 사용량의 29% 였습니다. 수집을 복구하는 작업이 진행 중이며, " +
  "복구되면 이 칸이 열립니다. ★그때까지 아래 숫자는 **전부가 아닙니다.**";

/** ★서버 로그·런북 전용. 어느 키를 넣어야 열리는지는 운영자만 알면 된다. */
export const ORCHESTRATOR_NOT_COLLECTED_OPERATOR_NOTE =
  "오케 수집 배선이 배포되면 그 날짜를 " +
  "TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE 에 넣어라 — 코드 배포 없이 열린다.";

/** 수집 배선 배포일을 넣는 env 키. unset 이면 `not_collected` 그대로다. */
export const TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE_ENV =
  "TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE";

/**
 * ★2026-05-05 ~ 2026-06-22 구간의 오케 행은 **규약 이전의 잔재**다.
 * `orchestrator-` 접두 id 14개 중 `orchestrator-<projectId>` 규약과 맞는 것이
 * 4개뿐이다. 살아있는 시계열이 아니므로 오케 시계열로 그리면 안 된다.
 */
export const ORCHESTRATOR_LEGACY_SEGMENT = {
  from: "2026-05-05",
  to: "2026-06-22",
} as const;

export const ORCHESTRATOR_LEGACY_SEGMENT_NOTE =
  "이 구간에 남아 있는 오케스트레이터 기록은 지금과 다른 방식으로 적힌 " +
  "옛 기록입니다. 이어지는 추세가 아니므로 증감으로 읽지 마세요.";

/** 오케 판정식. 코드 정본(`isOrchestratorAgentId`)과 같은 접두 규약이다. */
export const ORCHESTRATOR_AGENT_ID_PREFIX = "orchestrator-";

export type ActorKind = "worker" | "orchestrator";

export type OrchestratorAxis = {
  readonly state: "not_collected" | "collecting";
  /** ★i18n 키. `not_collected` 일 때만 채워진다. */
  readonly reasonCode: TeamUsageNoteCode | null;
  /** ko-KR 원문(번역 폴백). */
  readonly reason: string | null;
  readonly collectingSince: string | null;
  readonly legacySegment: {
    readonly from: string;
    readonly to: string;
    readonly noteCode: TeamUsageNoteCode;
    readonly note: string;
  } | null;
};

/**
 * ★코드 → ko-KR 원문. 프론트는 **코드로 번역하고**, 번역이 없을 때만 이 문장을
 * 그린다. 두 벌을 한 자리에 두는 이유: 코드를 추가하고 문장을 빼먹는 실수를
 * 타입이 잡아 준다(`Record<TeamUsageNoteCode, string>` 이 전수를 요구한다).
 */
export const TEAM_USAGE_NOTE_TEXT_KO: Readonly<
  Record<TeamUsageNoteCode, string>
> = {
  gate_unset: TEAM_USAGE_EFFECTIVE_FROM_UNSET_NOTE,
  gate_invalid: TEAM_USAGE_EFFECTIVE_FROM_INVALID_NOTE,
  not_provisioned: TEAM_USAGE_NOT_PROVISIONED_NOTE,
  no_team_scope: TEAM_SCOPE_DENIED_NOTE,
  member_self_only: MEMBER_SELF_ONLY_NOTE,
  projects_truncated: PROJECTS_TRUNCATED_NOTE,
  coverage_partial_scope: COVERAGE_PARTIAL_SCOPE_NOTE,
  member_rows_unknown: MEMBER_ROWS_UNKNOWN_NOTE,
  orchestrator_not_collected: ORCHESTRATOR_NOT_COLLECTED_NOTE,
  orchestrator_legacy_segment: ORCHESTRATOR_LEGACY_SEGMENT_NOTE,
  telemetry_opt_out: TELEMETRY_OPT_OUT_NOTE,
  rows_zero: ROWS_ZERO_NOTE,
  rows_without_task: ROWS_WITHOUT_TASK_NOTE,
  unattributed_rows: UNATTRIBUTED_ROWS_NOTE,
  basis_account_ledger: TEAM_USAGE_BASIS_LABEL,
  cost_estimated_usage: TEAM_USAGE_COST_LABEL,
  cost_not_billing: TEAM_USAGE_COST_NOT_BILLING_NOTE,
};

// ════════════════════════════════════════════════════════════════════════════
// 3. 표 좌표 + 뷰 (T2) — ★원본 표는 읽기만 한다
// ════════════════════════════════════════════════════════════════════════════

/** 원본과 같은 데이터셋. 축 분리는 데이터셋이 아니라 **표와 컬럼**으로 한다. */
export const TEAM_USAGE_DATASET = "marblo_telemetry";

/** ★유일한 원장. 이 표는 **읽기만** 한다 — 스키마 변경·파티셔닝·삭제 전부 범위 밖. */
export const SOURCE_TABLE_COST_LOGS = "cost_logs";

export const VIEW_TEAM_USAGE_DAILY = "v_team_usage_daily";
export const VIEW_TEAM_USAGE_UNATTRIBUTED = "v_team_usage_unattributed";

/** 새 뷰 목록 — `analyticsProfiles.ACCOUNT_AXIS_TABLES` 가 이걸 등재해 검사한다. */
export const TEAM_USAGE_VIEWS: ReadonlyArray<string> = [
  VIEW_TEAM_USAGE_DAILY,
  VIEW_TEAM_USAGE_UNATTRIBUTED,
];

export type TeamUsageBqField = {
  name: string;
  type: string;
  mode: string;
  description?: string;
};

/**
 * ★계정축 뷰의 컬럼 목록. `assertAxisPurity` 가 이 목록을
 * `FORBIDDEN_ON_ACCOUNT_AXIS` 로 검사한다 — 누가 나중에 익명축 조인키를 더하면
 * 테스트가 깨진다. 주석이 아니라 빨간불이다.
 */
export const TEAM_USAGE_DAILY_SCHEMA: ReadonlyArray<TeamUsageBqField> = [
  { name: "day", type: "DATE", mode: "REQUIRED", description: "UTC 일자." },
  { name: "project_id", type: "STRING", mode: "REQUIRED" },
  {
    name: "account_uid",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "★원장에 이미 있는 계정 uid. 뷰가 새로 만드는 값이 아니다. " +
      "BQ 밖으로 나가는 것은 가명(tm_…)뿐이다.",
  },
  { name: "model", type: "STRING", mode: "NULLABLE" },
  {
    name: "actor_kind",
    type: "STRING",
    mode: "REQUIRED",
    description: "worker | orchestrator — agentId 접두 규약의 파생.",
  },
  { name: "rows_n", type: "INT64", mode: "REQUIRED" },
  { name: "rows_zero", type: "INT64", mode: "REQUIRED" },
  { name: "input_tokens", type: "INT64", mode: "NULLABLE" },
  { name: "output_tokens", type: "INT64", mode: "NULLABLE" },
  { name: "cache_read_tokens", type: "INT64", mode: "NULLABLE" },
  { name: "cache_write_tokens", type: "INT64", mode: "NULLABLE" },
  {
    name: "cost_usd",
    type: "FLOAT64",
    mode: "NULLABLE",
    description: "★사용량 환산 비용(추정). 청구액이 아니다.",
  },
  { name: "distinct_agents", type: "INT64", mode: "REQUIRED" },
  { name: "distinct_tasks", type: "INT64", mode: "REQUIRED" },
  { name: "rows_without_task", type: "INT64", mode: "REQUIRED" },
];

/** ★금액·토큰 없음 — 귀속 못 하는 행은 규모만 센다(§3.1/§5.3-3). */
export const TEAM_USAGE_UNATTRIBUTED_SCHEMA: ReadonlyArray<TeamUsageBqField> = [
  { name: "day", type: "DATE", mode: "REQUIRED" },
  { name: "account_uid", type: "STRING", mode: "REQUIRED" },
  { name: "rows_n", type: "INT64", mode: "REQUIRED" },
];

function sqlString(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const DAILY_VIEW_DESCRIPTION =
  "팀 오버뷰 전용 계정축 뷰. 원장을 (day, project, account, model, actor_kind) 로 " +
  "접는다. ★계정축이다 — 익명축 조인키는 컬럼 자리조차 없다" +
  "(FORBIDDEN_ON_ACCOUNT_AXIS). ★익명축 표와 조인하지 마라. ★링크축과도 무관하다 — " +
  "계정 uid 가 원장에 이미 있어 설치를 거칠 이유가 원리적으로 없다. 조인하는 순간 " +
  "사람 축 게이트를 우회하는 것이다. ★금액은 사용량 환산 추정치이고 청구액이 아니다.";

const UNATTRIBUTED_VIEW_DESCRIPTION =
  "프로젝트 식별자가 없는 원장 행의 규모만 센다. ★금액·토큰을 내지 않는다 — " +
  "그 행은 조회자가 속하지 않은 프로젝트의 지출일 수 있다(§5.3-3). " +
  "화면이 '이 화면은 전부가 아니다' 를 말하게 하는 용도다.";

/** 일별 팀 사용량 뷰 본문. ★`CREATE VIEW` 만이다 — 원본 표는 건드리지 않는다. */
export function buildTeamUsageDailyViewSql(projectId: string): string {
  const source = `\`${projectId}.${TEAM_USAGE_DATASET}.${SOURCE_TABLE_COST_LOGS}\``;
  return [
    "SELECT",
    "  DATE(timestamp)                        AS day,",
    "  projectId                              AS project_id,",
    "  -- ★원장에 이미 있는 값. 가명화는 Node 안에서 한다(솔트를 SQL 에 넣지 않는다).",
    "  userId                                 AS account_uid,",
    "  model,",
    "  -- actor_kind 는 새 컬럼이 아니라 기존 agentId 접두 규약의 파생이다.",
    `  IF(STARTS_WITH(agentId, ${sqlString(ORCHESTRATOR_AGENT_ID_PREFIX)}),`,
    "     'orchestrator', 'worker')           AS actor_kind,",
    "  COUNT(*)                               AS rows_n,",
    "  -- 델타 0 행 비율을 화면이 스스로 말할 수 있게 같이 낸다.",
    "  COUNTIF(totalCost = 0 AND inputTokens = 0 AND outputTokens = 0)",
    "                                         AS rows_zero,",
    "  SUM(inputTokens)                       AS input_tokens,",
    "  SUM(outputTokens)                      AS output_tokens,",
    "  SUM(cacheReadTokens)                   AS cache_read_tokens,",
    "  SUM(cacheWriteTokens)                  AS cache_write_tokens,",
    "  SUM(totalCost)                         AS cost_usd,",
    "  COUNT(DISTINCT agentId)                AS distinct_agents,",
    "  COUNT(DISTINCT NULLIF(taskId, ''))     AS distinct_tasks,",
    "  COUNTIF(taskId IS NULL OR taskId = '') AS rows_without_task",
    `FROM ${source}`,
    "-- ★프로젝트 식별자 결측 행은 어느 테넌트 것인지 모르므로 팀에 귀속할 수 없다.",
    "--   규모는 옆의 unattributed 뷰가 행 수로만 낸다.",
    "WHERE projectId IS NOT NULL AND projectId != ''",
    "GROUP BY day, project_id, account_uid, model, actor_kind",
  ].join("\n");
}

/** 귀속 불가 행의 규모 뷰. ★금액·토큰 컬럼이 **자리조차** 없다. */
export function buildTeamUsageUnattributedViewSql(projectId: string): string {
  const source = `\`${projectId}.${TEAM_USAGE_DATASET}.${SOURCE_TABLE_COST_LOGS}\``;
  return [
    "SELECT",
    "  DATE(timestamp) AS day,",
    "  userId          AS account_uid,",
    "  COUNT(*)        AS rows_n",
    `FROM ${source}`,
    "WHERE projectId IS NULL OR projectId = ''",
    "GROUP BY day, account_uid",
  ].join("\n");
}

export function buildTeamUsageDailyViewDdl(projectId: string): string {
  const name = `\`${projectId}.${TEAM_USAGE_DATASET}.${VIEW_TEAM_USAGE_DAILY}\``;
  return [
    `CREATE OR REPLACE VIEW ${name}`,
    `OPTIONS(description=${sqlString(DAILY_VIEW_DESCRIPTION)})`,
    "AS",
    buildTeamUsageDailyViewSql(projectId),
  ].join("\n");
}

export function buildTeamUsageUnattributedViewDdl(projectId: string): string {
  const name = `\`${projectId}.${TEAM_USAGE_DATASET}.${VIEW_TEAM_USAGE_UNATTRIBUTED}\``;
  return [
    `CREATE OR REPLACE VIEW ${name}`,
    `OPTIONS(description=${sqlString(UNATTRIBUTED_VIEW_DESCRIPTION)})`,
    "AS",
    buildTeamUsageUnattributedViewSql(projectId),
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 질의 — ★경계를 파라미터로 받는다(L0 결과 캐시가 공짜로 먹게)
// ════════════════════════════════════════════════════════════════════════════
//
// 기존 어드민 쿼리는 `CURRENT_TIMESTAMP()` 를 SQL 안에서 부른다. 비결정적 함수라
// BigQuery 가 결과를 캐시하지 않아서 같은 대시보드를 두 번 열면 두 번 다 과금된다.
// 여기서는 경계를 호출측이 UTC 일 단위로 절삭해 파라미터로 넘긴다 — 같은 날 같은
// 창의 쿼리가 문자 그대로 동일해지고, BQ 결과 캐시(24h, 무료)가 받쳐 준다.

/** 팀 스코프 질의. `@projectIds` 는 서버가 도출한 집합이지 클라 입력이 아니다. */
export function buildTeamUsageDailyQuery(bqProjectId: string): string {
  const view = `\`${bqProjectId}.${TEAM_USAGE_DATASET}.${VIEW_TEAM_USAGE_DAILY}\``;
  return [
    "SELECT",
    "  FORMAT_DATE('%F', day) AS day,",
    "  project_id, account_uid, model, actor_kind,",
    "  rows_n, rows_zero, input_tokens, output_tokens,",
    "  cache_read_tokens, cache_write_tokens, cost_usd,",
    "  distinct_agents, distinct_tasks, rows_without_task",
    `FROM ${view}`,
    "WHERE day >= @fromDay AND day < @toDayExclusive",
    "  AND project_id IN UNNEST(@projectIds)",
  ].join("\n");
}

/** 본인 스코프 질의. 게이트 밖이고, 계정 uid 로만 좁힌다. */
export function buildSelfUsageDailyQuery(bqProjectId: string): string {
  const view = `\`${bqProjectId}.${TEAM_USAGE_DATASET}.${VIEW_TEAM_USAGE_DAILY}\``;
  return [
    "SELECT",
    "  FORMAT_DATE('%F', day) AS day,",
    "  project_id, account_uid, model, actor_kind,",
    "  rows_n, rows_zero, input_tokens, output_tokens,",
    "  cache_read_tokens, cache_write_tokens, cost_usd,",
    "  distinct_agents, distinct_tasks, rows_without_task",
    `FROM ${view}`,
    "WHERE day >= @fromDay AND day < @toDayExclusive",
    "  AND account_uid = @accountUid",
    "  AND project_id IN UNNEST(@projectIds)",
  ].join("\n");
}

/** 귀속 불가 행의 규모. ★행 수만 — 금액·토큰을 고르지 않는다. */
export function buildUnattributedRowsQuery(bqProjectId: string): string {
  const view = `\`${bqProjectId}.${TEAM_USAGE_DATASET}.${VIEW_TEAM_USAGE_UNATTRIBUTED}\``;
  return [
    "SELECT SUM(rows_n) AS rows_n",
    `FROM ${view}`,
    "WHERE day >= @fromDay AND day < @toDayExclusive",
    "  AND account_uid IN UNNEST(@accountUids)",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 창 계산 — UTC 일 단위 절삭
// ════════════════════════════════════════════════════════════════════════════

export type UsageWindow = {
  readonly rangeDays: number;
  /** 포함 경계(UTC 일자). */
  readonly fromDay: string;
  /** ★배제 경계. `day < toDayExclusive` — 오늘 구간을 포함하되 미완임을 표시한다. */
  readonly toDayExclusive: string;
  readonly todayUtc: string;
  /** 캐시 키의 일부. 날짜가 바뀌면 자동으로 새 키가 된다. */
  readonly windowKey: string;
  /** 게이트 상한에 잘렸나. 잘렸으면 화면은 `partial` 로 그린다. */
  readonly clippedByGate: boolean;
  /** 잘려서 남은 구간이 0일인가(창 전체가 발효일 이전). */
  readonly empty: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 최대 조회 구간. #1090 의 `days` 상한 365 와 같다. */
export const TEAM_USAGE_MAX_RANGE_DAYS = 365;
export const TEAM_USAGE_DEFAULT_RANGE_DAYS = 30;

function toUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addUtcDays(day: string, delta: number): string {
  return toUtcDay(dayToMs(day) + delta * DAY_MS);
}

/**
 * 조회 창을 만든다. 경계는 **UTC 일 단위로 절삭**한다 — 그래야 같은 날 같은 창의
 * 쿼리가 문자 그대로 동일해져 BQ 결과 캐시가 먹는다(§6.2 L0).
 */
export function computeUsageWindow(nowMs: number, rangeDays: number): UsageWindow {
  const days = Math.min(
    Math.max(1, Math.floor(rangeDays) || TEAM_USAGE_DEFAULT_RANGE_DAYS),
    TEAM_USAGE_MAX_RANGE_DAYS
  );
  const todayUtc = toUtcDay(nowMs);
  const fromDay = addUtcDays(todayUtc, -(days - 1));
  const toDayExclusive = addUtcDays(todayUtc, 1);
  return {
    rangeDays: days,
    fromDay,
    toDayExclusive,
    todayUtc,
    windowKey: `d${days}@${todayUtc}`,
    clippedByGate: false,
    empty: false,
  };
}

/**
 * ★게이트 상한을 창에 적용한다. 경계는 `day >= effectiveFrom` **포함**
 * (`personAxis.buildOpenGateSql` 과 같은 경계).
 *
 * 잘렸다는 사실을 숨기지 않는다 — 화면이 `partial` 로 그려야 오너가 "지난달이
 * 왜 비었지" 를 묻지 않는다.
 */
export function clampWindowToGate(
  window: UsageWindow,
  effectiveFrom: string
): UsageWindow {
  if (effectiveFrom <= window.fromDay) return window;
  if (effectiveFrom >= window.toDayExclusive) {
    return {
      ...window,
      fromDay: window.toDayExclusive,
      clippedByGate: true,
      empty: true,
    };
  }
  return { ...window, fromDay: effectiveFrom, clippedByGate: true, empty: false };
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 테넌트 해석 — ★클라가 준 projectId 를 권한 근거로 쓰지 않는다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 서버가 uid 로 만든 `allowed` 집합과 클라 입력의 **교집합**만 돌려준다.
 * 확장은 구조적으로 불가능하다 — 클라 입력은 필터로만 쓰인다.
 *
 * 요청이 없으면 allowed 전체. 교집합이 비면 빈 배열이고, 호출측은 그때
 * "권한 없음"(존재 여부는 말하지 않는다)으로 0행을 돌려준다.
 */
/** 한 응답이 합산하는 프로젝트 상한. ★넘으면 조용히 자르지 않고 **센다**. */
export const TEAM_USAGE_MAX_PROJECTS_IN_SCOPE = 25;

/**
 * 상한을 적용하되 **잘린 개수를 돌려준다.**
 *
 * ★`slice()` 만 하면 합계가 전체의 합이 아닌데도 화면은 그걸 모른다 — 오너가
 * "우리 팀 이번 달 지출" 로 읽는 숫자가 조용히 틀린다. 자르는 것 자체는 읽기
 * 폭주를 막으려는 정당한 선택이지만, **자른 사실을 숨기는 것**은 아니다.
 */
export function capProjectScope(
  ids: ReadonlyArray<string>,
  max: number = TEAM_USAGE_MAX_PROJECTS_IN_SCOPE
): { ids: string[]; omitted: number } {
  if (ids.length <= max) return { ids: [...ids], omitted: 0 };
  return { ids: ids.slice(0, max), omitted: ids.length - max };
}

export function intersectProjectScope(
  requested: ReadonlyArray<string> | null | undefined,
  allowed: ReadonlyArray<string>
): string[] {
  const allowedSet = new Set(allowed);
  if (requested == null || requested.length === 0) {
    return [...allowedSet].sort();
  }
  const out = new Set<string>();
  for (const raw of requested) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id !== "" && allowedSet.has(id)) out.add(id);
  }
  return [...out].sort();
}

export type TeamRole = "owner" | "admin" | "member" | "viewer";

/** 팀 전체를 볼 수 있는 역할 — `firestore.rules` 의 `isAdminOrOwner` 와 같은 판정. */
export function canSeeTeamBreakdown(role: TeamRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type UsageScope = "team" | "self";

/**
 * 요청 스코프를 판정한다. ★멤버가 team 을 요청해도 self 로 **내려간다** —
 * 던지지 않고 사유를 들고 내려간다(화면 절반은 살아야 한다).
 */
export function resolveUsageScope(
  requested: unknown,
  hasAnyTeamProject: boolean
): { scope: UsageScope; downgradedReasonCode: TeamUsageNoteCode | null } {
  const want = requested === "self" ? "self" : "team";
  if (want === "self") return { scope: "self", downgradedReasonCode: null };
  if (!hasAnyTeamProject) {
    // ★존재 여부를 말하지 않는다 — "네 팀이 아니다" 가 아니라 "볼 게 없다" 다.
    return { scope: "self", downgradedReasonCode: "no_team_scope" };
  }
  return { scope: "team", downgradedReasonCode: null };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 가명 — ★이 화면 전용 공간. 축을 넘나드는 가명은 만들지 않는다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 팀 멤버 가명의 접두. ★`us_`(계정축 사람 키)와 **달라야** 한다.
 *
 * 왜 재사용하면 안 되나: 이 응답은 가명 옆에 표시명을 싣는다. 그런데 사람 축의
 * 계정 키는 링크축 표의 조인 키다. 두 가명이 같으면
 *
 *     (팀 응답) 키 → 표시명    ⨝    (링크표) 키 → 설치 키
 *   ⇒ 설치 키 → 사람 이름
 *
 * 이 성립한다. 즉 팀 오버뷰가 링크표의 **이름 사전**이 된다 — 익명 설치 기록이
 * 이름으로 되짚어지고, `PERSON_AXIS_EFFECTIVE_FROM` 게이트가 막으려던 결과가
 * 게이트를 건드리지도 않고 성립한다. 가명 공간(kind)을 달리하면 같은 솔트라도
 * 다이제스트가 달라져 조인이 성립하지 않는다.
 *
 * ★규칙 한 줄: 바깥으로 나가는 가명은 그 화면 전용 공간이다.
 */
export const TEAM_MEMBER_KEY_PREFIX = "tm_";

/**
 * 계정 uid → 팀 전용 가명. 솔트가 없으면 null(원시값 폴백 금지 —
 * `analyticsPseudonym` 의 fail-safe 규약 그대로).
 */
export function teamMemberKey(uid: string, salt: string | null): string | null {
  const v = pseudonymizeAnalyticsId("teamMember", uid, salt);
  return typeof v === "string" ? v : null;
}

// ════════════════════════════════════════════════════════════════════════════
// 7.5 ★값 수준 신원 차단 — 키 검사만으로는 안 막힌다
// ════════════════════════════════════════════════════════════════════════════
//
// §5.4 의 경계는 "원시 uid·이메일을 응답 어디에도 남기지 않는다" 다. 그 경계를
// **필드 이름**으로만 지키면 뚫린다 — 봉투에는 **사람이 자유롭게 지은 문자열**이
// 실리는 자리가 둘 있다:
//
//   `byMember[].displayName`  ← 사용자가 정한 표시명. 이메일로 정할 수 있다.
//   `byProject[].projectName` ← 사용자가 정한 프로젝트 이름.
//
// ★표시명을 자기 이메일로 해 둔 멤버가 하나라도 있으면, 이름 필드 하나 안 쓰고도
//   응답에 이메일이 실린다. 필드명은 `displayName` 이라 어떤 키 검사도 안 걸린다.
//   (형제 티켓 IcjPf2SEs0ORUGLZgCHS 가 자기 쪽 `claimedBy`/`agentId` 에서 같은
//    구멍을 찾았다 — 에이전트 이름을 이메일로 지으면 키 스캐너를 그대로 통과했다.)
//
// ★그렇다고 세게 막으면 반대쪽으로 거짓말한다. `backend-1` 이나
//   `orchestrator-claude-p1` 같은 멀쩡한 이름을 가리면 화면이 "가려진 이름" 투성이가
//   되고, 그건 오너에게 있지도 않은 문제를 보고하는 것이다. 그래서 판정을 좁힌다:
//     - 이메일: 그 **부분만** 가린다. "홍길동 <a@b.com>" → "홍길동 <(가려짐)>"
//     - uid   : **정확히 28자** 영숫자 + 대·소문자·숫자가 **전부** 섞인 토큰만
//               (계정 uid 의 실제 모양). 사람이 짓는 이름은 이 모양이 되지 않는다.
//   차단과 통과를 **양쪽 다** 테스트한다.
//
// ★`null`(이름을 모른다)과 `(가려짐)`(있는데 못 보여준다)은 다른 뜻이다. 화면이
//   그 둘을 같게 그리면 안 된다.

/** 가려진 값의 표시. ★`null`(이름 미상)과 **다른 값**이다. */
export const REDACTED_IDENTITY_LABEL = "(가려짐)";

// ── ★`g` 플래그 정규식을 **모듈 상수로 두지 않는다** ────────────────────────
//
// `g` 가 붙은 정규식 객체는 `lastIndex` 를 **호출 간에 들고 다닌다.** 모듈 상수로
// 두면 그 상태가 다음 호출까지 살아남아, 어느 호출이 조용히 못 잡는 길이 열린다.
// `String.replace` 는 스펙상 되감아 주므로 지금 이 코드는 정상 동작한다 — 그런데
// 그건 **우연히 안전한 것**이다. 다음 사람이 방어 삼아 `if (EMAIL_LIKE.test(v))`
// 한 줄을 더하는 순간 상태가 섞이고, 그 실패는 **조용하다**(예외도 안 나고 값만
// 틀린다). 그래서 문서로 막지 않고 **공유 상태 자체를 없앤다** — 매 호출 새로
// 만든다. 호출 수는 응답당 멤버·프로젝트 수 정도라 비용이 무의미하다.
//
// (형제 티켓 IcjPf2SEs0ORUGLZgCHS 가 부분 치환으로 옮기다 이 자리에서 실제로
//  데였다. 거기서는 `test()` 와 `replace()` 를 섞어 두 번째 호출이 샜다.)

/**
 * 이메일 모양.
 *
 * ★TLD 를 `[^\s@]+` 같은 넓은 클래스로 두면 **구분자를 삼킨다** —
 * `"a@x.com, b@y.com"` 의 첫 매치가 쉼표까지 먹어 목록이 뭉개진다. `[A-Za-z]{2,}`
 * 로 좁혀 둔다(형제 티켓이 같은 자리에서 데였고, 아래 테스트가 그 케이스를 건다).
 */
function emailLikeRe(): RegExp {
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
}

/** 계정 uid 의 실제 모양: 정확히 28자 영숫자, 대·소문자·숫자가 전부 섞여 있다. */
function uidLikeRe(): RegExp {
  return /(?<![A-Za-z0-9])[A-Za-z0-9]{28}(?![A-Za-z0-9])/g;
}

function looksLikeUid(token: string): boolean {
  return (
    token.length === 28 &&
    /[a-z]/.test(token) &&
    /[A-Z]/.test(token) &&
    /[0-9]/.test(token)
  );
}

/**
 * 사람이 지은 자유 문자열에서 신원 모양을 가린다.
 *
 * ★값 수준 검사는 키 수준 검사와 **별개**다. 키를 아무리 잘 골라도 값 안에
 * 이메일이 들어 있으면 경계가 뚫린다.
 *
 * 과잉 차단도 결함으로 본다 — 멀쩡한 이름을 가리면 화면이 없는 문제를 보고한다.
 */
export function scrubIdentityLike(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let out = trimmed.replace(emailLikeRe(), REDACTED_IDENTITY_LABEL);
  out = out.replace(uidLikeRe(), (m) =>
    looksLikeUid(m) ? REDACTED_IDENTITY_LABEL : m
  );
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 집계 접기
// ════════════════════════════════════════════════════════════════════════════

/** BQ 뷰 한 행(형이 흔들려도 죽지 않게 unknown 으로 받는다). */
export type TeamUsageDailyRow = {
  day?: unknown;
  project_id?: unknown;
  account_uid?: unknown;
  model?: unknown;
  actor_kind?: unknown;
  rows_n?: unknown;
  rows_zero?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_write_tokens?: unknown;
  cost_usd?: unknown;
  distinct_agents?: unknown;
  distinct_tasks?: unknown;
  rows_without_task?: unknown;
};

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  // BigQuery 는 DATE/NUMERIC 을 { value: "…" } 로 돌려주기도 한다.
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return num((v as Record<string, unknown>).value);
  }
  return 0;
}

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).value;
    return typeof inner === "string" ? inner : "";
  }
  return "";
}

/** 부동소수 잡음을 자른다. 표시용 반올림이지 회계값이 아니다(추정치니까). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export type TeamUsageTotals = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** ★IO 토큰(input+output). 캐시 토큰은 위에 따로 있다 — 라벨 없이 합치지 않는다. */
  tokens: number;
};

export type TeamUsageByDay = {
  day: string;
  costUsd: number;
  tokens: number;
  /** 오늘 구간은 정의상 미완이다. 전일 대비 계산에서 빼라. */
  partial: boolean;
};

export type TeamUsageByMember = {
  memberKey: string;
  displayName: string | null;
  costUsd: number;
  tokens: number;
  share: number;
  /**
   * ★행이 하나라도 있었나. **세 값이다.**
   *
   *   `true`  — 기록이 있다.
   *   `false` — 기록이 **없다**. 단 "안 썼다" 가 아니라 "안 보냈다" 일 수 있다
   *             (텔레메트리 옵트아웃). 화면은 0 과 이 플래그를 같이 그려야 한다.
   *   `null`  — ★**모른다.** 스코프가 상한에 잘려서 이 멤버의 기록이 빠진
   *             프로젝트에 있었을 수 있다. 판정하지 않는다.
   *
   * ★`null` 을 `false` 로 접으면 **없던 문제를 만들어낸다**: 잘린 프로젝트에서만
   * 일한 멤버가 "기록 없음(미사용 또는 미전송)" 으로 찍힌다. 그 문장은 사람에
   * 대한 판단이라, 절단 부작용을 개인의 성실성 문제로 바꿔 놓는 셈이다.
   * (형제 티켓 IcjPf2SEs0ORUGLZgCHS 가 잘린 에이전트 목록으로 '주인 없는 클레임'
   *  을 판정해 멀쩡한 티켓을 거짓 경보로 띄운 것과 같은 부류다 —
   *  ★조용한 절단이 파생 판정에 물리면 누락이 아니라 **오탐**이 된다.)
   */
  hasRows: boolean | null;
};

export type TeamUsageByProject = {
  projectId: string;
  projectName: string | null;
  costUsd: number;
  tokens: number;
};

export type TeamUsageByModel = { model: string; costUsd: number; tokens: number };

export type TeamUsageByActorKind = {
  actorKind: ActorKind;
  costUsd: number;
  tokens: number;
};

export type TeamUsageCoverage = {
  rowsInWindow: number;
  rowsZeroPct: number;
  rowsWithoutTaskPct: number;
  unattributedRows: number;
  /** ★`null` = 모른다(스코프가 잘려 판정 생략). `0` 과 다른 뜻이다. */
  membersWithNoRows: number | null;
  /** 잘린 스코프 위의 비율임을 밝히는 사유. 안 잘렸으면 null. */
  scopeNoteCode: TeamUsageNoteCode | null;
  scopeNote: string | null;
  /**
   * ★`hasRows: null` / `membersWithNoRows: null` 이 "기록 없음" 으로 읽히지 않게
   * 하는 사유. 멤버 분해가 있고 스코프가 잘렸을 때만 실린다.
   */
  memberRowsUnknownNoteCode: TeamUsageNoteCode | null;
  memberRowsUnknownNote: string | null;
  /** ★i18n 키 4벌. 값은 항상 실린다(상수) — 화면이 조건 없이 그릴 수 있게. */
  telemetryOptOutNoteCode: TeamUsageNoteCode;
  rowsZeroNoteCode: TeamUsageNoteCode;
  rowsWithoutTaskNoteCode: TeamUsageNoteCode;
  unattributedRowsNoteCode: TeamUsageNoteCode;
  /** ko-KR 원문(번역 폴백). */
  telemetryOptOutNote: string;
  rowsZeroNote: string;
  rowsWithoutTaskNote: string;
  unattributedRowsNote: string;
};

export type FoldedTeamUsage = {
  totals: TeamUsageTotals;
  byDay: TeamUsageByDay[];
  byMember: TeamUsageByMember[];
  byProject: TeamUsageByProject[];
  byModel: TeamUsageByModel[];
  byActorKind: TeamUsageByActorKind[];
  coverage: TeamUsageCoverage;
  /** 창 안에 오케 행이 실제로 있었나(레거시 잔재 판정용). */
  hasOrchestratorRows: boolean;
};

export type FoldTeamUsageOptions = {
  todayUtc: string;
  /** 가명 솔트. 없으면 memberKey 가 안 만들어져 멤버 분해가 비고, 사유가 붙는다. */
  memberSalt: string | null;
  /** 멤버 분해를 낼지. ★owner/admin 이 아니면 false — 계약상 self 는 빈 배열. */
  includeMemberBreakdown: boolean;
  /** 팀 명부(계정 uid). 행이 없는 멤버도 0 으로 그리기 위해 필요하다. */
  rosterUids?: ReadonlyArray<string>;
  /**
   * 멤버 키 → 표시명. 라이브 경로에서는 계정 uid 로, 캐시 경로에서는 가명으로
   * 키가 잡힌다(캐시에 uid 가 없으므로). ★이메일을 폴백으로 쓰지 않는다(§5.4) —
   * 이름을 모르면 null 이고, 화면이 "이름 미상" 으로 그린다.
   */
  displayNames?: ReadonlyMap<string, string | null>;
  /** projectId → 프로젝트명. */
  projectNames?: ReadonlyMap<string, string | null>;
  /** 귀속 불가 행 수(별도 뷰에서 온다). */
  unattributedRows?: number;
  /**
   * ★캐시 경로 전용. 캐시 행의 `account_uid` 자리에는 **이미 가명**이 들어 있다
   * (원시 uid 는 캐시에 넣지 않는다 — §5.4). 그때는 다시 가명화하지 않고 그 값을
   * 그대로 멤버 키로 쓴다. 다시 HMAC 을 씌우면 같은 사람이 두 사람으로 갈린다.
   */
  memberKeysArePreHashed?: boolean;
  /**
   * ★스코프가 상한에 잘렸나. 잘렸으면 **"기록 없음" 류의 판정을 생략**한다 —
   * 잘린 표본 위의 부정 판정은 누락이 아니라 오탐이다.
   */
  scopeTruncated?: boolean;
};

/**
 * 뷰 행을 화면이 쓰는 모양으로 접는다. ★원시 uid 는 이 함수 밖으로 나가지 않는다 —
 * 들어오자마자 가명으로 바뀌고, 반환값에는 계정 uid 필드 자체가 없다.
 */
export function foldTeamUsage(
  rows: ReadonlyArray<TeamUsageDailyRow>,
  opts: FoldTeamUsageOptions
): FoldedTeamUsage {
  const totals: TeamUsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokens: 0,
  };
  const byDay = new Map<string, { costUsd: number; tokens: number }>();
  const byUid = new Map<string, { costUsd: number; tokens: number }>();
  const byProject = new Map<string, { costUsd: number; tokens: number }>();
  const byModel = new Map<string, { costUsd: number; tokens: number }>();
  const byActor = new Map<ActorKind, { costUsd: number; tokens: number }>();

  let rowsN = 0;
  let rowsZero = 0;
  let rowsWithoutTask = 0;
  let hasOrchestratorRows = false;

  const bump = (
    m: Map<string, { costUsd: number; tokens: number }>,
    key: string,
    cost: number,
    tokens: number
  ): void => {
    const cur = m.get(key) ?? { costUsd: 0, tokens: 0 };
    cur.costUsd += cost;
    cur.tokens += tokens;
    m.set(key, cur);
  };

  for (const row of rows) {
    const cost = num(row.cost_usd);
    const input = num(row.input_tokens);
    const output = num(row.output_tokens);
    const tokens = input + output;
    const actorKind: ActorKind =
      str(row.actor_kind) === "orchestrator" ? "orchestrator" : "worker";
    if (actorKind === "orchestrator") hasOrchestratorRows = true;

    totals.costUsd += cost;
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += num(row.cache_read_tokens);
    totals.cacheWriteTokens += num(row.cache_write_tokens);
    totals.tokens += tokens;

    rowsN += num(row.rows_n);
    rowsZero += num(row.rows_zero);
    rowsWithoutTask += num(row.rows_without_task);

    const day = str(row.day);
    if (day !== "") bump(byDay, day, cost, tokens);

    const uid = str(row.account_uid);
    if (uid !== "") bump(byUid, uid, cost, tokens);

    const projectId = str(row.project_id);
    if (projectId !== "") bump(byProject, projectId, cost, tokens);

    // ★모델명이 비어 있으면 '(미상)' 으로 접는다. 빈 라벨로 그리면 화면이
    //   "모델 없이 돈이 나갔다" 로 읽힌다.
    bump(byModel, str(row.model) || "(미상)", cost, tokens);

    const cur = byActor.get(actorKind) ?? { costUsd: 0, tokens: 0 };
    cur.costUsd += cost;
    cur.tokens += tokens;
    byActor.set(actorKind, cur);
  }

  const displayNames = opts.displayNames ?? new Map<string, string | null>();
  const projectNames = opts.projectNames ?? new Map<string, string | null>();

  // ★행이 없는 멤버도 명부에 있으면 0 으로 그린다. 목록에서 빠지면 오너가
  //   "이 사람은 왜 없지" 를 물을 자리조차 없다 — 그게 빈 상태를 잘못 그리는 것이다.
  const memberUids = new Set<string>(byUid.keys());
  for (const uid of opts.rosterUids ?? []) {
    if (uid.trim() !== "") memberUids.add(uid.trim());
  }

  const byMember: TeamUsageByMember[] = [];
  if (opts.includeMemberBreakdown) {
    for (const uid of memberUids) {
      const key = opts.memberKeysArePreHashed
        ? uid
        : teamMemberKey(uid, opts.memberSalt);
      // 솔트가 없으면 가명을 못 만든다 → 원시값으로 폴백하지 않고 **버린다**.
      if (key === null || key === "") continue;
      // ★밖으로 나가는 값이 이 화면 전용 가명 공간인지 마지막으로 확인한다.
      if (!key.startsWith(TEAM_MEMBER_KEY_PREFIX)) continue;
      const agg = byUid.get(uid);
      byMember.push({
        memberKey: key,
        // ★값 수준 차단. 표시명을 이메일로 해 둔 멤버가 있어도 새지 않는다.
        displayName: scrubIdentityLike(displayNames.get(uid) ?? null),
        costUsd: round6(agg?.costUsd ?? 0),
        tokens: agg?.tokens ?? 0,
        share:
          totals.costUsd > 0 ? round6((agg?.costUsd ?? 0) / totals.costUsd) : 0,
        // ★스코프가 잘렸으면 "기록 없음" 을 **단정하지 않는다.** 있는 건 사실이므로
        //   true 는 그대로 두고, 없는 쪽만 null(모름)로 남긴다.
        hasRows: agg != null ? true : opts.scopeTruncated ? null : false,
      });
    }
    byMember.sort(
      (a, b) => b.costUsd - a.costUsd || a.memberKey.localeCompare(b.memberKey)
    );
  }

  // ★"몇 명이 기록이 없나" 는 **목록에서 센다.** 따로 계산하면 목록과 어긋난다.
  //
  //   실측으로 두 자리가 어긋나고 있었다(형제 티켓 IcjPf2SEs0ORUGLZgCHS 가
  //   자기 `attentionCount` 에서 같은 걸 찾고 알려줬다):
  //
  //   1) 명부에 없는 **전(前) 멤버**가 이번 창에 행을 남기면 `byUid` 에는 있고
  //      명부에는 없다. `명부수 − byUid수` 는 그만큼 작게 나와서 "2명 없음" 인데
  //      화면은 "1명" 이라고 말했다.
  //   2) 솔트가 없어 가명을 못 만든 멤버는 목록에서 **빠지는데** 카운트에는 남았다.
  //
  //   ★"주의 3건" 이라 써 놓고 2건만 보이는 화면은, 숫자가 틀린 것보다 나쁘다 —
  //   오너가 못 찾은 1건을 계속 찾는다.
  //
  //   그리고 두 경우엔 아예 세지 않는다(`null` = 모른다):
  //   - 멤버 분해를 안 내보내는 스코프(self) — 목록이 없으니 셀 대상이 없다.
  //   - 스코프가 잘린 경우 — 셀 수 있는 척하면 그 숫자가 곧 사람에 대한
  //     잘못된 판단이 된다.
  const membersWithNoRows =
    !opts.includeMemberBreakdown || opts.scopeTruncated
      ? null
      : byMember.filter((m) => m.hasRows === false).length;

  return {
    totals: {
      costUsd: round6(totals.costUsd),
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      tokens: totals.tokens,
    },
    byDay: [...byDay.entries()]
      .map(([day, v]) => ({
        day,
        costUsd: round6(v.costUsd),
        tokens: v.tokens,
        // ★오늘 구간은 정의상 미완이다.
        partial: day === opts.todayUtc,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byMember,
    byProject: [...byProject.entries()]
      .map(([projectId, v]) => ({
        projectId,
        // ★프로젝트 이름도 사용자가 짓는다 — 같은 문을 지난다.
        projectName: scrubIdentityLike(projectNames.get(projectId) ?? null),
        costUsd: round6(v.costUsd),
        tokens: v.tokens,
      }))
      .sort((a, b) => b.costUsd - a.costUsd || a.projectId.localeCompare(b.projectId)),
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, costUsd: round6(v.costUsd), tokens: v.tokens }))
      .sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model)),
    // ★오케 항목은 행이 실제로 있을 때만 실린다. 없는데 0 으로 실으면
    //   오너가 "오케는 공짜" 로 읽는다 — 그 자리는 orchestratorAxis 가 말한다.
    byActorKind: [...byActor.entries()]
      .map(([actorKind, v]) => ({
        actorKind,
        costUsd: round6(v.costUsd),
        tokens: v.tokens,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    coverage: {
      rowsInWindow: rowsN,
      rowsZeroPct: pct(rowsZero, rowsN),
      rowsWithoutTaskPct: pct(rowsWithoutTask, rowsN),
      unattributedRows: opts.unattributedRows ?? 0,
      membersWithNoRows,
      scopeNoteCode: opts.scopeTruncated ? "coverage_partial_scope" : null,
      scopeNote: opts.scopeTruncated ? COVERAGE_PARTIAL_SCOPE_NOTE : null,
      // ★멤버 목록이 있는데 판정을 못 한 경우에만. 목록이 없으면 오독할 대상도 없다.
      memberRowsUnknownNoteCode:
        opts.scopeTruncated && opts.includeMemberBreakdown
          ? "member_rows_unknown"
          : null,
      memberRowsUnknownNote:
        opts.scopeTruncated && opts.includeMemberBreakdown
          ? MEMBER_ROWS_UNKNOWN_NOTE
          : null,
      telemetryOptOutNoteCode: "telemetry_opt_out",
      rowsZeroNoteCode: "rows_zero",
      rowsWithoutTaskNoteCode: "rows_without_task",
      unattributedRowsNoteCode: "unattributed_rows",
      telemetryOptOutNote: TELEMETRY_OPT_OUT_NOTE,
      rowsZeroNote: ROWS_ZERO_NOTE,
      rowsWithoutTaskNote: ROWS_WITHOUT_TASK_NOTE,
      unattributedRowsNote: UNATTRIBUTED_ROWS_NOTE,
    },
    hasOrchestratorRows,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 오케 축 상태
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★수집 배선이 배포되기 전까지는 `not_collected` 다 — **0 이 아니다.**
 * 배선이 배포되면 env 에 그 날짜를 넣어 `collecting` 으로 바뀐다. 코드 배포가
 * 아니라 env 로 바꾸는 이유는 게이트와 같다(되돌리기가 배포를 안 타야 한다).
 */
export function resolveOrchestratorAxis(
  window: Pick<UsageWindow, "fromDay" | "toDayExclusive">,
  hasOrchestratorRows: boolean,
  env: Record<string, string | undefined> = process.env
): OrchestratorAxis {
  const raw = env[TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE_ENV];
  const since = typeof raw === "string" ? raw.trim() : "";
  const collecting = since.length > 0 && isRealDate(since);

  // 창이 레거시 구간과 겹치고 실제로 오케 행이 있으면, 그 숫자는 살아있는
  // 시계열이 아니라 규약 이전의 잔재다 — 화면이 그렇게 라벨하게 알려 준다.
  const overlapsLegacy =
    hasOrchestratorRows &&
    window.fromDay <= ORCHESTRATOR_LEGACY_SEGMENT.to &&
    window.toDayExclusive > ORCHESTRATOR_LEGACY_SEGMENT.from;

  return {
    state: collecting ? "collecting" : "not_collected",
    reasonCode: collecting ? null : "orchestrator_not_collected",
    reason: collecting ? null : ORCHESTRATOR_NOT_COLLECTED_NOTE,
    collectingSince: collecting ? since : null,
    legacySegment: overlapsLegacy
      ? {
          from: ORCHESTRATOR_LEGACY_SEGMENT.from,
          to: ORCHESTRATOR_LEGACY_SEGMENT.to,
          noteCode: "orchestrator_legacy_segment",
          note: ORCHESTRATOR_LEGACY_SEGMENT_NOTE,
        }
      : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 10. 봉투 (§7 응답 계약)
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★다섯 상태. `0`·`미수집`·`적재 전` 이 셋 다 다른 뜻이라는 것이 이 화면의 전부다.
 *
 *  - `disabled`        : 게이트가 닫혔다. **숫자를 아예 그리지 않고** 사유만 그린다.
 *  - `not_provisioned` : 뷰가 아직 없다(= 적재 전). ★0 이 아니다.
 *  - `empty`           : 창 안에 행이 0. 팀이 아직 안 들어왔을 때의 정상 상태다.
 *  - `partial`         : 행이 있고 창이 게이트 상한에 잘렸다.
 *  - `complete`        : 행이 있고 창 전체가 읽혔다.
 */
export type TeamUsageState =
  | "disabled"
  | "not_provisioned"
  | "empty"
  | "partial"
  | "complete";

export type TeamUsageEnvelopeMeta = {
  state: TeamUsageState;
  /** ★i18n 키. `disabled`/`not_provisioned` 일 때만 채워진다. */
  disabledReasonCode: TeamUsageNoteCode | null;
  /** ko-KR 원문(번역 폴백). */
  disabledReason: string | null;
  effectiveFrom: string | null;
  /** 집계 근거. ★어떤 상태에서도 항상 실린다 — 라벨 없는 숫자 금지. */
  basis: string;
  basisLabelCode: TeamUsageNoteCode;
  basisLabel: string;
  costLabelCode: TeamUsageNoteCode;
  costLabel: string;
  costNotBillingNoteCode: TeamUsageNoteCode;
  costNotBillingNote: string;
  scope: UsageScope;
  scopeNoteCode: TeamUsageNoteCode | null;
  scopeNote: string | null;
  projectsInScope: number;
  /** ★상한 때문에 집계에서 빠진 프로젝트 수. 0 이 아니면 합계는 전체가 아니다. */
  projectsOmitted: number;
  projectsTruncatedNoteCode: TeamUsageNoteCode | null;
  projectsTruncatedNote: string | null;
  fromDay: string | null;
  toDayExclusive: string | null;
};

/**
 * ★화면이 문장에 숫자를 박지 않게, 판정에 쓴 상한을 **값으로** 준다.
 *
 * 문장에 "최대 365일" 이라고 적어 두면 상한을 바꿀 때마다 세 로케일 번역이 낡고,
 * 코드의 판정 상수와 화면이 말하는 숫자가 **조용히 갈라진다.** 값의 출처는 판정에
 * 쓰는 상수 **그 자체**라 갈라질 자리가 없다.
 * (형제 티켓 IcjPf2SEs0ORUGLZgCHS 가 같은 자리에서 데였다 — 문장에 박힌 임계값이
 *  주석의 규율과 정면으로 어긋났는데, 검사가 아라비아 숫자만 봐서 한글 수사를
 *  놓쳤다.)
 */
export type TeamUsageCriteria = {
  maxRangeDays: number;
  maxProjectsInScope: number;
  cacheTtlSeconds: number;
  manualRefreshMinIntervalSeconds: number;
};

export type TeamUsageSummary = {
  rangeDays: number;
  generatedAt: string;
  criteria: TeamUsageCriteria;
  cache: { hit: boolean; ageSeconds: number; ttlSeconds: number };
  teamUsage: TeamUsageEnvelopeMeta;
  orchestratorAxis: OrchestratorAxis;
  totals: TeamUsageTotals;
  byDay: TeamUsageByDay[];
  byMember: TeamUsageByMember[];
  byProject: TeamUsageByProject[];
  byModel: TeamUsageByModel[];
  byActorKind: TeamUsageByActorKind[];
  coverage: TeamUsageCoverage;
};

const EMPTY_TOTALS: TeamUsageTotals = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  tokens: 0,
};

function emptyCoverage(): TeamUsageCoverage {
  return {
    rowsInWindow: 0,
    rowsZeroPct: 0,
    rowsWithoutTaskPct: 0,
    unattributedRows: 0,
    membersWithNoRows: 0,
    scopeNoteCode: null,
    scopeNote: null,
    memberRowsUnknownNoteCode: null,
    memberRowsUnknownNote: null,
    telemetryOptOutNoteCode: "telemetry_opt_out",
    rowsZeroNoteCode: "rows_zero",
    rowsWithoutTaskNoteCode: "rows_without_task",
    unattributedRowsNoteCode: "unattributed_rows",
    telemetryOptOutNote: TELEMETRY_OPT_OUT_NOTE,
    rowsZeroNote: ROWS_ZERO_NOTE,
    rowsWithoutTaskNote: ROWS_WITHOUT_TASK_NOTE,
    unattributedRowsNote: UNATTRIBUTED_ROWS_NOTE,
  };
}

export type BuildEnvelopeInput = {
  scope: UsageScope;
  /** ★i18n 키. 문장은 이 코드로 결정된다(호출측이 문장을 지어내지 않는다). */
  scopeNoteCode: TeamUsageNoteCode | null;
  window: UsageWindow;
  generatedAtMs: number;
  gate: TeamUsageGate;
  projectsInScope: number;
  /** ★상한에 걸려 빠진 프로젝트 수. 조용히 자르지 않는다. */
  projectsOmitted?: number;
  cache: { hit: boolean; ageSeconds: number; ttlSeconds: number };
  folded: FoldedTeamUsage | null;
  /** 뷰가 없어 질의 자체를 못 했나(= 적재 전). */
  notProvisioned?: boolean;
  env?: Record<string, string | undefined>;
};

/**
 * ★게이트가 닫혔으면 **질의하지 않고** 이 함수로 0행 + 사유를 만든다.
 * 봉투 모양은 열렸을 때와 글자 하나까지 같고 행만 0개다 — 프론트가 분기 없이
 * 같은 코드로 그리고, "왜 비었나" 를 화면이 스스로 말한다.
 */
export function buildTeamUsageEnvelope(input: BuildEnvelopeInput): TeamUsageSummary {
  const { window, gate, folded } = input;
  const closedForTeam = input.scope === "team" && !gate.open;

  let state: TeamUsageState;
  if (closedForTeam) state = "disabled";
  else if (input.notProvisioned) state = "not_provisioned";
  else if (folded == null || folded.coverage.rowsInWindow === 0) state = "empty";
  else if (window.clippedByGate) state = "partial";
  else state = "complete";

  let disabledReason: string | null = null;
  let disabledReasonCode: TeamUsageNoteCode | null = null;
  if (state === "disabled") {
    disabledReason = gate.reason;
    disabledReasonCode = gate.open
      ? null
      : gate.reasonCode === "invalid"
      ? "gate_invalid"
      : "gate_unset";
  } else if (state === "not_provisioned") {
    disabledReason = TEAM_USAGE_NOT_PROVISIONED_NOTE;
    disabledReasonCode = "not_provisioned";
  }

  const body =
    state === "disabled" || state === "not_provisioned" || folded == null
      ? {
          totals: EMPTY_TOTALS,
          byDay: [] as TeamUsageByDay[],
          byMember: [] as TeamUsageByMember[],
          byProject: [] as TeamUsageByProject[],
          byModel: [] as TeamUsageByModel[],
          byActorKind: [] as TeamUsageByActorKind[],
          coverage: emptyCoverage(),
        }
      : {
          totals: folded.totals,
          byDay: folded.byDay,
          byMember: folded.byMember,
          byProject: folded.byProject,
          byModel: folded.byModel,
          byActorKind: folded.byActorKind,
          coverage: folded.coverage,
        };

  const projectsOmitted = input.projectsOmitted ?? 0;

  return {
    rangeDays: window.rangeDays,
    generatedAt: new Date(input.generatedAtMs).toISOString(),
    // ★판정에 쓴 상한을 값으로 준다 — 화면이 문장에 숫자를 박지 않게.
    criteria: {
      maxRangeDays: TEAM_USAGE_MAX_RANGE_DAYS,
      maxProjectsInScope: TEAM_USAGE_MAX_PROJECTS_IN_SCOPE,
      cacheTtlSeconds: TEAM_USAGE_CACHE_TTL_SECONDS,
      manualRefreshMinIntervalSeconds:
        TEAM_USAGE_MANUAL_REFRESH_MIN_INTERVAL_MS / 1000,
    },
    cache: input.cache,
    teamUsage: {
      state,
      disabledReasonCode,
      disabledReason,
      effectiveFrom: gate.open ? gate.effectiveFrom : null,
      // ★라벨 없는 숫자 금지 — basis 는 어떤 상태에서도 항상 실린다.
      basis: TEAM_USAGE_BASIS,
      basisLabelCode: "basis_account_ledger",
      basisLabel: TEAM_USAGE_BASIS_LABEL,
      costLabelCode: "cost_estimated_usage",
      costLabel: TEAM_USAGE_COST_LABEL,
      costNotBillingNoteCode: "cost_not_billing",
      costNotBillingNote: TEAM_USAGE_COST_NOT_BILLING_NOTE,
      scope: input.scope,
      scopeNoteCode: input.scopeNoteCode,
      scopeNote:
        input.scopeNoteCode === null
          ? null
          : TEAM_USAGE_NOTE_TEXT_KO[input.scopeNoteCode],
      projectsInScope: input.projectsInScope,
      projectsOmitted,
      projectsTruncatedNoteCode: projectsOmitted > 0 ? "projects_truncated" : null,
      projectsTruncatedNote: projectsOmitted > 0 ? PROJECTS_TRUNCATED_NOTE : null,
      fromDay: state === "disabled" ? null : window.fromDay,
      toDayExclusive: state === "disabled" ? null : window.toDayExclusive,
    },
    // ★오케 칸은 게이트가 닫혀 있어도 사유를 들고 나간다. 그 칸이 비는 이유와
    //   팀 스코프가 닫힌 이유는 서로 다른 사실이고, 화면은 둘 다 말해야 한다.
    orchestratorAxis: resolveOrchestratorAxis(
      window,
      folded?.hasOrchestratorRows ?? false,
      input.env
    ),
    ...body,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 10.5 ★어느 짝이 불변식인가 — 화면이 대조를 걸 수 있게 목록으로 준다
// ════════════════════════════════════════════════════════════════════════════
//
// 화면은 봉투 안의 두 값을 대조해서 "숫자가 어긋났다" 를 잡고 싶어 한다. 그런데
// **어느 짝이 같아야 하는지를 안 적어 두면 두 가지로 실패한다**(형제 티켓
// IcjPf2SEs0ORUGLZgCHS 가 T9 과 주고받으며 실측한 자리다):
//
//   1) 대조를 **못 건다** — 다를 수도 있다고 생각해서 아무것도 안 본다.
//   2) **틀린 짝을 걸어 오경보**를 낸다 — 일부러 다른 짝을 어긋남으로 읽는다.
//
// ★그리고 이 화면에는 세 번째가 있다: **맞는 짝인데 정확히 같지는 않다.**
//   각 버킷을 따로 반올림하므로 `Σ byDay.costUsd` 와 `totals.costUsd` 가
//   실측 1e-6 만큼 벌어진다. 정확 비교를 걸면 **멀쩡한 응답이 매번 빨개진다** —
//   안전장치가 반대로 도는 자리다. 그래서 허용오차를 **응답과 함께** 내보낸다.

/**
 * ★금액 대조 허용오차(USD). 버킷마다 소수 6자리로 반올림하므로 합이 총계와
 * 정확히 같지 않을 수 있다. 화면은 이 값으로 비교해야 오경보가 안 난다.
 *
 * 버킷 수만큼 오차가 쌓이므로 상수 하나로 두지 않고 개수로 계산한다.
 */
export function sumToleranceUsd(bucketCount: number): number {
  // 버킷당 최대 5e-7 (6자리 반올림) + 총계 쪽 5e-7.
  return (Math.max(1, bucketCount) + 1) * 5e-7;
}

/**
 * ★같아야 하는 짝. 화면이 대조를 걸어도 되는 목록이다.
 *
 * 여기 **없는 짝은 대조하지 마라** — 아래 `TEAM_USAGE_DELIBERATE_MISMATCHES` 가
 * 왜 다른지 설명한다.
 */
export const TEAM_USAGE_SUMMARY_INVARIANTS: ReadonlyArray<{
  readonly name: string;
  readonly what: string;
  readonly exact: boolean;
}> = [
  {
    name: "membersWithNoRows",
    what: "coverage.membersWithNoRows === byMember 중 hasRows === false 인 수 (null 이면 대조하지 않는다)",
    exact: true,
  },
  {
    name: "byProject.costUsd",
    what: "Σ byProject.costUsd ≈ totals.costUsd",
    exact: false,
  },
  {
    name: "byModel.costUsd",
    what: "Σ byModel.costUsd ≈ totals.costUsd",
    exact: false,
  },
  {
    name: "byActorKind.costUsd",
    what: "Σ byActorKind.costUsd ≈ totals.costUsd",
    exact: false,
  },
  {
    name: "byDay.costUsd",
    what: "Σ byDay.costUsd ≈ totals.costUsd",
    exact: false,
  },
  {
    name: "tokens",
    what: "totals.tokens === totals.inputTokens + totals.outputTokens (정수라 정확하다)",
    exact: true,
  },
];

/**
 * ★**일부러 다른** 짝. 화면이 이걸 대조하면 오경보다.
 *
 * 목록이 넓어지는 것을 막는 자리이기도 하다 — 새 짝을 "다를 수 있음" 으로
 * 미루기 전에 여기 이유를 적어야 한다.
 */
export const TEAM_USAGE_DELIBERATE_MISMATCHES: ReadonlyArray<{
  readonly pair: string;
  readonly why: string;
}> = [
  {
    pair: "teamUsage.projectsInScope vs byProject.length",
    why:
      "스코프에 있어도 이번 창에 사용량이 없는 프로젝트는 byProject 에 안 나온다. " +
      "projectsInScope 는 '볼 수 있는 프로젝트 수' 이고 byProject 는 '쓴 프로젝트' 다.",
  },
  {
    pair: "byMember.length vs totals",
    why:
      "가명 솔트가 없으면 멤버 분해는 비지만 총계는 산다(원시값 폴백 금지의 결과). " +
      "self 스코프에서도 byMember 는 계약상 빈 배열이고 총계는 본인 것이 실린다.",
  },
  {
    pair: "Σ byMember.costUsd vs totals.costUsd",
    why:
      "위와 같은 이유로 멤버 분해가 비거나(솔트 없음/self) 명부 밖 사용자가 섞이면 " +
      "합이 총계와 다를 수 있다. 멤버 축은 총계의 분해가 아니다.",
  },
  {
    pair: "coverage 비율들끼리",
    why:
      "rowsZeroPct·rowsWithoutTaskPct 는 **행 수** 기준이고 금액·토큰과 분모가 다르다. " +
      "스코프가 잘렸으면 분모가 '포함된 프로젝트' 로 더 좁아진다(coverage.scopeNoteCode).",
  },
];

// ════════════════════════════════════════════════════════════════════════════
// 11. 캐시 (§6) — ★서버 전용 티어
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★클라가 직접 읽으면 콜러블의 역할 게이트를 통째로 우회한다.
 * `firestore.rules` 에서 `allow read, write: if false` 로 닫혀 있고, 서버는
 * Admin SDK 로(룰을 우회해) 읽고 쓴다.
 */
export const TEAM_USAGE_CACHE_COLLECTION = "teamUsageCache";

/** 뷰·집계 형태가 바뀌면 올린다 → 구 캐시가 자동으로 무효가 된다. */
export const TEAM_USAGE_CACHE_SCHEMA_VERSION = 1;

/** L2 TTL. 신선도는 숨기지 않고 `generatedAt` 으로 화면에 그린다. */
export const TEAM_USAGE_CACHE_TTL_SECONDS = 15 * 60;

/** L1(인스턴스 메모리) TTL. 인스턴스 churn 에 사라지므로 보조 수단이다. */
export const TEAM_USAGE_MEMORY_TTL_SECONDS = 60;

/** 수동 새로고침 레이트리밋 — 프로젝트당 5분에 1회. */
export const TEAM_USAGE_MANUAL_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * ★캐시 키에 `allowed 집합` 이 아니라 **단일 projectId** 를 쓴다. 집합을 키로
 * 쓰면 권한이 다른 두 사람이 같은 캐시를 나눠 쓸 위험이 생긴다. 프로젝트 단위로
 * 캐시하고 여러 프로젝트는 응답 조립 시 합산한다.
 */
export function buildTeamUsageCacheDocId(
  projectId: string,
  windowKey: string
): string {
  // Firestore 문서 id 는 '/' 를 못 쓴다. projectId 는 자동 id 라 실무상 안전하지만
  // 방어적으로 접는다.
  const safe = projectId.replace(/\//g, "_");
  return `${safe}__${windowKey}`;
}

export type TeamUsageCacheDoc = {
  schemaVersion?: unknown;
  gateEffectiveFrom?: unknown;
  windowKey?: unknown;
  generatedAtMs?: unknown;
  expiresAtMs?: unknown;
  rows?: unknown;
};

/**
 * 캐시를 쓸 수 있나. ★게이트 값이 바뀌면 자동 무효 — 발효일이 바뀌면 잘리는
 * 구간이 달라지므로 예전 숫자를 그대로 쓰면 거짓말이 된다.
 */
export function isCacheUsable(
  doc: TeamUsageCacheDoc | null | undefined,
  ctx: { windowKey: string; gateEffectiveFrom: string | null; nowMs: number }
): boolean {
  if (doc == null) return false;
  if (doc.schemaVersion !== TEAM_USAGE_CACHE_SCHEMA_VERSION) return false;
  if (doc.windowKey !== ctx.windowKey) return false;
  const cachedGate =
    typeof doc.gateEffectiveFrom === "string" ? doc.gateEffectiveFrom : null;
  if (cachedGate !== ctx.gateEffectiveFrom) return false;
  const expires = typeof doc.expiresAtMs === "number" ? doc.expiresAtMs : 0;
  if (!Number.isFinite(expires) || expires <= ctx.nowMs) return false;
  return Array.isArray(doc.rows);
}

/**
 * ★캐시 doc 에는 **숫자만** 넣는다. 표시명은 매 응답에 조립한다 — 캐시가 낡은
 * 이름을 붙드는 문제도 같이 없어지고, 이름이 캐시에 남지도 않는다.
 *
 * 계정 uid 는 캐시에 남는다는 점을 분명히 해 둔다: 남는 것은 **가명이 아니라**
 * 뷰가 낸 uid 이므로, 그대로 넣으면 §5.4 표의 "캐시 doc = ❌" 를 어긴다.
 * 그래서 여기서 uid 를 **가명으로 바꿔** 담고, 원시 uid 는 캐시에 넣지 않는다.
 */
export function toCacheRows(
  rows: ReadonlyArray<TeamUsageDailyRow>,
  salt: string | null
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const uid = str(row.account_uid);
    const key = uid === "" ? null : teamMemberKey(uid, salt);
    out.push({
      day: str(row.day),
      project_id: str(row.project_id),
      // ★가명. 솔트가 없으면 null 이고, 그때 멤버 분해는 비는 게 맞다.
      member_key: key,
      model: str(row.model),
      actor_kind: str(row.actor_kind) === "orchestrator" ? "orchestrator" : "worker",
      rows_n: num(row.rows_n),
      rows_zero: num(row.rows_zero),
      input_tokens: num(row.input_tokens),
      output_tokens: num(row.output_tokens),
      cache_read_tokens: num(row.cache_read_tokens),
      cache_write_tokens: num(row.cache_write_tokens),
      cost_usd: num(row.cost_usd),
      distinct_agents: num(row.distinct_agents),
      distinct_tasks: num(row.distinct_tasks),
      rows_without_task: num(row.rows_without_task),
    });
  }
  return out;
}

/**
 * 캐시 행을 다시 접기 좋은 모양으로 되돌린다. ★`account_uid` 자리에 **가명**이
 * 들어간다 — `foldTeamUsage` 는 그 값을 다시 가명화하지 않고 그대로 쓰도록
 * `memberSalt: null` + `preHashed` 경로를 타야 하므로, 여기서는 전용 함수로
 * 접는다(`foldCachedTeamUsage`).
 */
export type TeamUsageCacheRow = ReturnType<typeof toCacheRows>[number];

/**
 * 캐시 행(멤버 키가 이미 가명)을 접는다. 원시 uid 가 없으므로 가명화 단계가 없다.
 */
export function foldCachedTeamUsage(
  cacheRows: ReadonlyArray<Record<string, unknown>>,
  opts: Omit<FoldTeamUsageOptions, "memberSalt" | "rosterUids"> & {
    /** 명부 멤버의 **가명** 목록. 행이 없는 멤버도 0 으로 그리기 위해 쓴다. */
    rosterMemberKeys?: ReadonlyArray<string>;
  }
): FoldedTeamUsage {
  // 가명을 account_uid 자리에 넣고 `memberSalt` 를 "그대로 쓰기" 로 돌린다.
  const rows: TeamUsageDailyRow[] = cacheRows.map((r) => ({
    day: r.day,
    project_id: r.project_id,
    account_uid: r.member_key,
    model: r.model,
    actor_kind: r.actor_kind,
    rows_n: r.rows_n,
    rows_zero: r.rows_zero,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_read_tokens: r.cache_read_tokens,
    cache_write_tokens: r.cache_write_tokens,
    cost_usd: r.cost_usd,
    distinct_agents: r.distinct_agents,
    distinct_tasks: r.distinct_tasks,
    rows_without_task: r.rows_without_task,
  }));
  return foldTeamUsage(rows, {
    todayUtc: opts.todayUtc,
    includeMemberBreakdown: opts.includeMemberBreakdown,
    scopeTruncated: opts.scopeTruncated,
    displayNames: opts.displayNames,
    projectNames: opts.projectNames,
    unattributedRows: opts.unattributedRows,
    memberSalt: null,
    rosterUids: opts.rosterMemberKeys,
    // ★가명은 이미 만들어져 있으므로 다시 가명화하지 않는다.
    memberKeysArePreHashed: true,
  });
}

/** 수동 새로고침을 허용할 시각인가. */
export function canManualRefresh(
  lastRefreshMs: number | null | undefined,
  nowMs: number
): boolean {
  if (lastRefreshMs == null || !Number.isFinite(lastRefreshMs)) return true;
  return nowMs - lastRefreshMs >= TEAM_USAGE_MANUAL_REFRESH_MIN_INTERVAL_MS;
}
