// 사람 축(계정 파생 가명키) — 순수 로직(BQ/Firebase 무의존).
// analyticsPseudonym.ts / analyticsIdScheme.ts 와 같은 규약으로 node --test 로
// 단위검증한다.
//
// 설계 정본: v3/docs/person-axis-user-key-design-2026-08-21.md (PR #1081).
// ★이 파일은 그 문서를 구현한다. 다르게 가야 할 이유를 찾으면 여기서 고치지 말고
//   문서를 고치는 티켓을 내라 — 코드와 문서가 갈리면 다음 사람이 코드를 믿는다.
//
// ── 이 모듈이 하는 일 세 가지 ───────────────────────────────────────────────
//
//  1) 게이트. `PERSON_AXIS_EFFECTIVE_FROM` 이 unset 이면 사람 축은 **0행 + 사유**다.
//     예외를 던지지도, 조용히 전체를 보여주지도 않는다.
//  2) 소급을 저장이 아니라 **조회**로 한다. 이벤트 행에 `user_key` 컬럼을 만들지
//     않는다. 링크표 하나와 뷰 두 벌이 전부다.
//  3) 공용 기기(한 설치에 계정 2개 이상)는 값을 만들지 않고 **센다.**
//
// ── ★발효일은 정해졌다(2026-08-21) — 그래도 코드에 기본값은 두지 않는다 ────
//   값: `PERSON_AXIS_EFFECTIVE_FROM=2026-04-01` (사장님 결정, **과거 포함**).
//   경위와 근거는 아래 상수 주석에 있다. 코드 기본값을 안 두는 이유는 그대로다 —
//   기본값이 있으면 "어느 환경에서 무엇이 열렸는지" 를 env 가 아니라 배포 시점이
//   정하게 되고, 되돌릴 때도 코드 배포가 필요해진다.
//
// ── ★솔트를 SQL 에 넣지 마라 ────────────────────────────────────────────────
//   BQ 는 쿼리 본문을 job 히스토리에 수개월 보관한다. HMAC 은 전부 Node 안에서
//   계산하고, BQ 로 나가는 SQL 에는 원시 uid 도 솔트도 없다(#915 계승).

import { createHmac } from "node:crypto";

// ════════════════════════════════════════════════════════════════════════════
// 1. 게이트 — 만들되 켜지 않는다
// ════════════════════════════════════════════════════════════════════════════

/** env 키. 값은 'YYYY-MM-DD'(UTC 날짜). ★기본값을 코드에 두지 않는다. */
export const PERSON_AXIS_EFFECTIVE_FROM_ENV = "PERSON_AXIS_EFFECTIVE_FROM";

/**
 * ★값은 정해졌다 — `PERSON_AXIS_EFFECTIVE_FROM=2026-04-01`.
 *
 * ── 누가·언제·왜 ───────────────────────────────────────────────────────────
 *   누가: 사장님 결정(티켓 vilkbSrnzbAv4ezbZMRT, 텔레그램).
 *   언제: 2026-08-21.
 *   무엇: "방침 버전은 놔두자. **과거데이터 포함** 발효일 입력하고 머지해줘."
 *   즉 소급 상한을 **보유 데이터 전체 아래**로 내린다. 설계 §5.4 는 원래 상한을
 *   개정 발효일(2026-08-21)에 두라고 권고했고 오케스트레이터가 승인했었다.
 *   이번에 그 결정이 뒤집혔다 — 문서 쪽에도 그 사실을 적어 뒀다(§5.4 추기).
 *
 * ── 왜 하필 2026-04-01 인가 (하루도 어긋나면 안 되는 자리다) ────────────────
 *   실측: `events`·`cost_logs` 의 최초 행이 둘 다 **2026-04-18** 이고 그보다
 *   앞선 데이터는 없다. 경계는 `d.day >= DATE(값)` **포함**이므로(buildOpenGateSql,
 *   summarizePersonAxisCoverage 의 `d.day < effectiveFrom` 컷과 같은 경계)
 *   2026-04-18 을 넣어도 그날은 들어온다.
 *   그런데도 한 걸음 더 내린 이유: `day` 는 **UTC** 날짜인데(analyticsProfiles.ts)
 *   "최초 행 2026-04-18" 이 KST 로 읽힌 값이면 UTC 로는 04-17 일 수 있다. 그러면
 *   딱 하루가 조용히 빠진다. 지시는 "과거 포함" 이고 그 아래엔 데이터가 없으므로,
 *   내려서 잃는 것은 0이고 올려서 잃는 것은 하루다. 싼 쪽을 고른다.
 *
 * ── 그래도 바뀌지 않은 것 ──────────────────────────────────────────────────
 *   이 상수는 여전히 "언제부터의 이벤트를 사람에게 귀속해도 되는가" 의 상한이고,
 *   그 답을 정하는 건 엔지니어링이 아니라 **고지**다. 이번에 상한을 과거까지
 *   내릴 수 있게 된 근거는 "데이터가 없어서" 가 아니라, 개정 처리방침이 사람 축
 *   수집을 고지하고(privacyContent.tsx) 그 변경을 1회성 인앱 배너로 알리기
 *   때문이다(privacyClarification.ts). 배너가 빠지면 이 값의 근거도 같이 빠진다.
 *
 * ── unset 일 때 왜 0행인가 (이 동작은 그대로다) ────────────────────────────
 *   unset 은 이제 "아직 안 정했다" 가 아니라 **"배포 env 에 안 넣었다"** 는 뜻이다.
 *   그래도 동작은 그대로 0행 + 사유다. 셋 중 하나여야 하는데:
 *
 *   - 예외를 던진다      → 어드민 화면 한 칸이 아니라 응답 전체가 죽는다.
 *   - 전체를 보여준다    → ★절대 금지. 상한이 없다는 뜻이 되어, env 를 빠뜨린
 *                          환경에서 상한 없는 소급이 조용히 열린다.
 *   - 0행 + 사유를 준다  → ★이것. 화면이 "왜 비었는지" 를 말한다.
 *
 *   ★단, 배포 환경에서 0행은 이제 **정상이 아니다.** 값이 정해진 뒤로는 unset 이
 *   설정 누락이므로, scripts/check-deploy-env.mjs 가 이 키를 필수로 막는다.
 */
export const PERSON_AXIS_EFFECTIVE_FROM_UNSET_NOTE =
  "PERSON_AXIS_EFFECTIVE_FROM 미설정 — 사람 축이 닫혀 있다. 발효일은 " +
  "2026-08-21 에 정해졌으므로(값 2026-04-01, 과거 포함), 배포 환경에서 이 " +
  "사유가 보이면 설정 누락이지 설계된 상태가 아니다. functions/.env.<project> " +
  "에 키를 넣어라. (설계 §5.4 / v3/docs/person-axis-user-key-design-2026-08-21.md)";

const PERSON_AXIS_EFFECTIVE_FROM_INVALID_NOTE =
  "PERSON_AXIS_EFFECTIVE_FROM 값이 'YYYY-MM-DD' 가 아니다 — 상한을 못 세우므로 " +
  "닫은 채로 둔다. 잘못된 상한으로 여는 것보다 닫힌 편이 안전하다.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 게이트 판정 결과. 닫혀 있으면 **반드시** 사유를 들고 다닌다. */
export type PersonAxisGate =
  | {
      readonly open: false;
      readonly reasonCode: "unset" | "invalid";
      readonly reason: string;
      readonly effectiveFrom: null;
    }
  | {
      readonly open: true;
      readonly reasonCode: null;
      readonly reason: null;
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
 * 을 돌려주면 된다(`emptyPersonAxisAttribution` 참조).
 */
export function resolvePersonAxisGate(
  env: Record<string, string | undefined> = process.env,
): PersonAxisGate {
  const raw = env[PERSON_AXIS_EFFECTIVE_FROM_ENV];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) {
    return {
      open: false,
      reasonCode: "unset",
      reason: PERSON_AXIS_EFFECTIVE_FROM_UNSET_NOTE,
      effectiveFrom: null,
    };
  }
  if (!isRealDate(trimmed)) {
    return {
      open: false,
      reasonCode: "invalid",
      reason: PERSON_AXIS_EFFECTIVE_FROM_INVALID_NOTE,
      effectiveFrom: null,
    };
  }
  return {
    open: true,
    reasonCode: null,
    reason: null,
    effectiveFrom: trimmed,
  };
}

/**
 * ★provision 가드 — 게이트가 닫힌 채로 뷰를 **굳히지** 않는다.
 *
 * 실측(2026-08-29 12:19Z): provision 스크립트는 `process.env` 만 읽고 `.env.<project>`
 * 를 로드하지 않는다. 셸에 `PERSON_AXIS_EFFECTIVE_FROM` 이 없던 세션에서
 * `--apply --replace-views` 가 돌아 `v_install_unified_revenue` 가
 * `person_axis_closed` 본문으로 굳었고, 어드민은 "결제 0" 을 사실처럼 읽었다.
 * 닫힘 자체는 정상 상태지만(런타임은 0행+사유로 답한다), **DDL 로 굳는 순간**
 * 런타임 게이트와 무관하게 닫힌 채 남는다 — 그래서 굳히는 쪽만 막는다.
 *
 * 판정:
 *   - 게이트 open           → 통과.
 *   - dry-run(apply=false)  → 통과(경고만). 계획은 보여 줘야 한다.
 *   - apply + closed        → `--allow-closed-gate` 가 없으면 **막는다**.
 *   - apply + closed + 플래그 → 통과(경고). 의도적 닫힘 provision 은 남겨 둔다.
 */
export const PROVISION_ALLOW_CLOSED_GATE_FLAG = "--allow-closed-gate";

export interface ProvisionGateVerdict {
  /** false 면 provision 을 진행하지 않는다. */
  readonly ok: boolean;
  /** 사람이 읽을 사유·경고. ok=true 여도 경고가 있을 수 있다. */
  readonly message: string | null;
}

export function assessProvisionGate(
  gate: PersonAxisGate,
  opts: { readonly apply: boolean; readonly allowClosedGate: boolean },
): ProvisionGateVerdict {
  if (gate.open) return { ok: true, message: null };
  const why =
    `사람 축 게이트가 닫혀 있다(${gate.reasonCode}) — 이대로 만들면 뷰가 ` +
    "닫힌 본문으로 굳고 화면이 '결제 0' 을 사실처럼 답한다(2026-08-29 사고). " +
    `${PERSON_AXIS_EFFECTIVE_FROM_ENV}=YYYY-MM-DD 를 셸에 export 하고 다시 돌려라` +
    "(provision 스크립트는 .env.<project> 를 읽지 않는다).";
  if (!opts.apply) {
    return { ok: true, message: `[warn] ${why} (dry-run 이라 진행한다)` };
  }
  if (opts.allowClosedGate) {
    return {
      ok: true,
      message: `[warn] ${why} ${PROVISION_ALLOW_CLOSED_GATE_FLAG} 로 의도적 닫힘 provision 을 승인했다.`,
    };
  }
  return {
    ok: false,
    message: `${why} 정말 닫힌 채 만들려면 ${PROVISION_ALLOW_CLOSED_GATE_FLAG} 를 명시해라.`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 테이블 좌표 · 링크축 스키마
// ════════════════════════════════════════════════════════════════════════════

/**
 * 링크표가 사는 데이터셋. ★원본(marblo_telemetry)과 **다른 데이터셋**인 것이
 * 요점이 아니다 — 요점은 IAM 이 다르다는 것이다. 이름만 다르고 principal 이
 * 같으면 이름표만 바꾼 같은 방이다. `assertLinkDatasetIsolation` 이 그걸 검사한다.
 */
export const IDENTITY_DATASET = "marblo_identity";

/** 원본이 사는 데이터셋 — 이 모듈은 여기 있는 것을 **읽기만** 한다. */
export const TELEMETRY_DATASET = "marblo_telemetry";

/** 링크표. 이 표 하나가 사람 축 전부다 — 지우면 사람 축이 통째로 사라진다. */
export const TABLE_USER_INSTALL = "analytics_user_install";

/** 사람 축 뷰가 읽는 익명축 원천(파생표, #1079). ★원본 이벤트는 안 건드린다. */
export const SOURCE_TABLE_USER_DAILY = "analytics_user_daily";

/** HMAC 익명 설치 정본. 사람 축 커버리지의 임시 분모로만 읽는다. */
export const SOURCE_TABLE_ANALYTICS_IDENTITY = "analytics_identity";

/** 기본 뷰 — 연결 이후 구간만. 리텐션·코호트·활성화 전부 이쪽을 쓴다. */
export const VIEW_PERSON_SINCE_LINK = "v_person_since_link";

/** 소급 뷰 — 캠페인 귀속 **전용**. 화면에 라벨이 없으면 쓰면 안 된다. */
export const VIEW_PERSON_ALL_TIME = "v_person_all_time";

/**
 * ★링크축 테이블 — `user_key` 와 `install_key` 를 한 행에 담는 것이 **허용된**
 * 유일한 자리다. 그래서 목록이 하나다.
 *
 * ★여기에 표를 더하지 마라. 표를 더하는 순간 "두 축을 잇는 자리" 가 늘어나고,
 * 그때부터 링크표를 지워도 소급이 안 취소된다 — 이 설계가 되돌릴 수 있는 이유가
 * 바로 "잇는 자리가 하나뿐" 이라는 사실이다(설계 §4.2-5).
 */
export const LINK_AXIS_TABLES: ReadonlyArray<string> = [TABLE_USER_INSTALL];

/**
 * ★링크축 테이블에 **절대** 나타나면 안 되는 컬럼명.
 *
 * 링크축은 두 가명키를 잇는 것까지가 전부다. 원시 식별자나 사람이 읽을 수 있는
 * 값이 한 컬럼이라도 들어오면 그 표는 "가명 매핑" 이 아니라 **명부**가 된다.
 * `person_key` 가 여기 있는 이유는 설계 §3 — 키는 `user_key` 하나이고, 두 벌을
 * 두면 조인이 조용히 0행이 된다.
 */
export const FORBIDDEN_ON_LINK_AXIS: ReadonlyArray<string> = [
  "uid",
  "user_id",
  "userid",
  // ★camelCase 철자. assertAxisPurity 는 컬럼명을 소문자화해 대조하므로
  //   `gaKey`/`installId` 같은 철자는 snake_case 항목에 안 걸린다
  //   (analyticsProfiles.FORBIDDEN_ON_ANONYMOUS_AXIS 의 "userkey" 와 같은 이유).
  "ga_key",
  "gakey",
  "account_id",
  "account_label",
  "email",
  "name",
  "display_name",
  "install_id",
  "installid",
  "client_id",
  "clientid",
  "ip",
  "ip_address",
  "device_name",
  "person_key",
];

/** analyticsProfiles.BqField 와 같은 모양(구조적 호환). 순환 import 를 피하려고
 *  여기 따로 둔다 — 이 모듈은 node:crypto 말고는 아무것도 import 하지 않는다. */
/** SQL 문자열 리터럴로 안전하게 감싼다(사유 문구에 따옴표가 섞여도 안 깨지게). */
function sqlString(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type PersonAxisBqField = {
  name: string;
  type: string;
  mode: "REQUIRED" | "NULLABLE" | "REPEATED";
  description?: string;
  fields?: ReadonlyArray<PersonAxisBqField>;
};

/**
 * 링크표 스키마 (설계 §6.1).
 *
 * 그레인: (`user_key`, `install_key`) 한 쌍 = 한 행. 사람→설치 1:N 이 행 수로
 * 표현되고, 설치→사람 다중(공용 기기)도 **숨지 않고 행으로 드러난다.**
 *
 * ★넣지 않는 컬럼(자리도 만들지 않는다): 원시 uid, 이메일, 이름, IP, 기기명,
 *   `person_key`. 빈 컬럼이 있으면 다음 사람이 "채우면 되겠네" 로 읽는다.
 */
export const USER_INSTALL_SCHEMA: ReadonlyArray<PersonAxisBqField> = [
  {
    name: "row_id",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "MERGE 키. (user_key, install_key) 의 가명. 스트리밍 insertId 중복제거는 " +
      "수 분 창의 best-effort 라 재실행 중복을 못 막는다 — 그래서 MERGE 를 쓴다.",
  },
  {
    name: "user_key",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "us_ + HMAC(salt, 'user:' + uid). ★원시 uid 는 이 표 어디에도 없다.",
  },
  {
    name: "install_key",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "in_ + HMAC. analytics_identity.install_key 와 **같은 kind·같은 솔트** — " +
      "다르면 조인이 에러 없이 조용히 0행이 된다.",
  },
  {
    name: "id_scheme",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "uuid36 / uid28 / unknown — analyticsIdScheme.classifyIdScheme 판정. " +
      "06-13 경계를 섞지 않으려고 링크 시점의 스킴을 같이 적는다.",
  },
  {
    name: "link_source",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "telemetry_auth(정상) / uid28_inline(06-13 이전 구간, 설계 §5.6). " +
      "링크를 어떤 근거로 만들었는지 — 소급 판단과 되돌리기의 단위다.",
  },
  {
    name: "first_linked_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description:
      "★소급 경계의 단일 출처. MERGE 가 **덮지 않는다**(MIN 유지) — 덮으면 " +
      "v_person_since_link 의 경계가 매 실행마다 뒤로 밀린다.",
  },
  {
    name: "last_seen_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description: "최근 확인 시각. MERGE 가 갱신한다.",
  },
  {
    name: "policy_version",
    type: "STRING",
    mode: "REQUIRED",
    description:
      "어느 고지 하에서 만들어진 링크인가 — 삭제·소급 판단의 근거. " +
      "고지가 또 바뀌면 이 값으로 구간을 가른다.",
  },
  {
    name: "ingested_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description: "적재 시각.",
  },
];

/**
 * 링크표 생성 DDL (설계 §6.1). ★이 함수는 DDL **문자열**을 만들 뿐이고 아무것도
 * 실행하지 않는다 — 표를 실제로 만드는 시점은 설계 §9 의 3단계이고 그건 게이트가
 * 열린 뒤다("만들되 켜지 않는다").
 *
 * - 파티션 DAY(`first_linked_at`) — 소급 경계로 자르는 쿼리가 파티션을 탄다.
 * - 클러스터 (`user_key`, `install_key`) — 삭제요청(`WHERE user_key = ?`)과
 *   설치 조인이 둘 다 클러스터를 탄다.
 * - `IF NOT EXISTS` — 재실행해도 기존 표를 갈아엎지 않는다.
 */
export function buildUserInstallTableDdl(projectId: string): string {
  const cols = USER_INSTALL_SCHEMA.map((f) => {
    const notNull = f.mode === "REQUIRED" ? " NOT NULL" : "";
    const opts = f.description
      ? ` OPTIONS(description=${sqlString(f.description)})`
      : "";
    return `  ${f.name} ${f.type}${notNull}${opts}`;
  }).join(",\n");
  const tableDoc =
    "사람 축 링크표 — (user_key, install_key) 한 쌍이 한 행. " +
    "★두 축을 잇는 유일한 자리다. 이 표를 비우면 사람 축이 통째로 사라지고 " +
    "익명 기록은 익명으로 남는다(소급은 저장이 아니라 조회로 한다). " +
    "원시 uid·이메일·IP·기기명·person_key 는 컬럼 자리조차 없다.";
  return [
    `CREATE TABLE IF NOT EXISTS \`${projectId}.${IDENTITY_DATASET}.${TABLE_USER_INSTALL}\` (`,
    cols,
    ")",
    "PARTITION BY DATE(first_linked_at)",
    "CLUSTER BY user_key, install_key",
    `OPTIONS(description=${sqlString(tableDoc)})`,
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 링크 행 — 저장은 소급하지 않는다
// ════════════════════════════════════════════════════════════════════════════

/** 정상 경로. 인증된 텔레메트리 요청이 만든 링크. */
export const LINK_SOURCE_TELEMETRY_AUTH = "telemetry_auth";
/** 06-13 이전 구간(uid28) — 그 시절 userId 가 계정 uid 그 자체였다(설계 §5.6). */
export const LINK_SOURCE_UID28_INLINE = "uid28_inline";

export type LinkSource =
  | typeof LINK_SOURCE_TELEMETRY_AUTH
  | typeof LINK_SOURCE_UID28_INLINE;

export type UserInstallLinkRow = {
  row_id: string;
  user_key: string;
  install_key: string;
  id_scheme: string;
  link_source: LinkSource;
  first_linked_at: string;
  last_seen_at: string;
  policy_version: string;
  ingested_at: string;
};

/**
 * MERGE 키. 설계 §6.1 의 `HMAC("link:" + user_key + "|" + install_key)`.
 *
 * 입력이 이미 가명(us_/in_)이라 원시값이 들어갈 자리가 없다. 솔트가 없으면
 * null — 임시 해시로 메꾸면 재실행마다 다른 row_id 가 나와 멱등이 깨진다.
 */
export function buildLinkRowId(
  userKey: string,
  installKey: string,
  salt: string | null,
): string | null {
  if (!salt) return null;
  if (userKey.length === 0 || installKey.length === 0) return null;
  const digest = createHmac("sha256", salt)
    .update(`link:${userKey}|${installKey}`)
    .digest("hex")
    .slice(0, 24);
  return `lk_${digest}`;
}

export type PlanUserInstallLinkInput = {
  userKey: string;
  installKey: string;
  idScheme: string;
  linkSource: LinkSource;
  /** 이 요청이 관측된 시각(ISO). first_linked_at / last_seen_at 의 원천. */
  observedAt: string;
  policyVersion: string;
  salt: string | null;
};

export type PlanUserInstallLinkResult =
  | { readonly written: true; readonly row: UserInstallLinkRow }
  | { readonly written: false; readonly reason: string };

/**
 * 링크 한 줄을 **쓸지 말지**까지 판정한다.
 *
 * ★게이트가 닫혀 있으면 행을 만들지 않는다. "만들되 켜지 않는다" 는 뷰만의 규칙이
 * 아니다 — 적재까지 막아야 켜지 않은 것이다. 게이트가 닫힌 채로 링크가 쌓이면,
 * 나중에 게이트를 여는 순간 고지 개정 **전에** 만들어진 링크가 소급에 참여한다.
 */
export function planUserInstallLink(
  input: PlanUserInstallLinkInput,
  gate: PersonAxisGate,
): PlanUserInstallLinkResult {
  if (!gate.open) {
    return { written: false, reason: gate.reason };
  }
  const { userKey, installKey } = input;
  if (userKey.length === 0 || installKey.length === 0) {
    return {
      written: false,
      reason: "user_key/install_key 가 비었다 — 가명 생성 실패(솔트 확인).",
    };
  }
  const rowId = buildLinkRowId(userKey, installKey, input.salt);
  if (rowId === null) {
    return {
      written: false,
      reason:
        "ANALYTICS_ID_SALT 미설정 — row_id 를 못 만든다. 임시 해시로 메꾸면 " +
        "재실행마다 다른 키가 나와 멱등이 깨진다(fail-safe: 안 쓴다).",
    };
  }
  // ★관측 시각이 상한보다 앞이면 링크를 만들지 않는다. 발효일 이전 구간을
  //   링크로 남기면, 저장은 소급 안 했다면서 소급의 재료를 저장하는 꼴이다.
  if (input.observedAt.slice(0, 10) < gate.effectiveFrom) {
    return {
      written: false,
      reason:
        `관측 시각(${input.observedAt.slice(0, 10)})이 사람 축 발효일` +
        `(${gate.effectiveFrom})보다 앞이다 — 링크를 만들지 않는다.`,
    };
  }
  return {
    written: true,
    row: {
      row_id: rowId,
      user_key: userKey,
      install_key: installKey,
      id_scheme: input.idScheme,
      link_source: input.linkSource,
      first_linked_at: input.observedAt,
      last_seen_at: input.observedAt,
      policy_version: input.policyVersion,
      ingested_at: input.observedAt,
    },
  };
}

/**
 * 스테이징 → 링크표 MERGE. `analytics_purchase` 가 이미 검증한 패턴 그대로다.
 *
 * ★`first_linked_at` 은 LEAST 로 **작은 쪽을 남긴다.** 덮으면 소급 경계가 매
 * 실행마다 뒤로 밀려서, 어제 보이던 행이 오늘 사라진다.
 */
export function buildUserInstallMergeSql(
  projectId: string,
  stagingTable: string,
): string {
  const target = `\`${projectId}.${IDENTITY_DATASET}.${TABLE_USER_INSTALL}\``;
  const staging = `\`${projectId}.${IDENTITY_DATASET}.${stagingTable}\``;
  return [
    `MERGE ${target} T`,
    `USING ${staging} S`,
    "ON T.row_id = S.row_id",
    "WHEN MATCHED THEN UPDATE SET",
    "  T.last_seen_at = GREATEST(T.last_seen_at, S.last_seen_at),",
    "  -- ★first_linked_at 은 덮지 않는다(MIN 유지) — 소급 경계의 단일 출처다.",
    "  T.first_linked_at = LEAST(T.first_linked_at, S.first_linked_at),",
    "  T.id_scheme = S.id_scheme,",
    "  T.link_source = S.link_source,",
    "  T.policy_version = S.policy_version,",
    "  T.ingested_at = S.ingested_at",
    "WHEN NOT MATCHED THEN INSERT (",
    "  row_id, user_key, install_key, id_scheme, link_source,",
    "  first_linked_at, last_seen_at, policy_version, ingested_at",
    ") VALUES (",
    "  S.row_id, S.user_key, S.install_key, S.id_scheme, S.link_source,",
    "  S.first_linked_at, S.last_seen_at, S.policy_version, S.ingested_at",
    ")",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 공용 기기 — 값을 만들지 않고 센다
// ════════════════════════════════════════════════════════════════════════════

export type UserInstallLink = {
  user_key: string;
  install_key: string;
  id_scheme?: string | null;
  link_source?: string | null;
  first_linked_at: string;
};

/**
 * 한 설치에 계정이 둘 이상 붙은 설치들(설계 §5.5).
 *
 * ★이 설치들은 두 뷰 **모두에서** 제외한다. 로그인 전 행이 둘 중 누구 것인지 알
 * 근거가 없기 때문이다. 마지막 사람에게 몰아주면 그 사람의 리텐션이 남의 활동으로
 * 부풀고, 그 왜곡은 숫자만 봐서는 안 보인다.
 *
 * ★현재 실측 0건이다. 값이 없을 때 규칙을 박아야 **나중에 규칙 없이 값이 생기지
 * 않는다.**
 */
export function findSharedInstalls(
  links: ReadonlyArray<UserInstallLink>,
): ReadonlySet<string> {
  const byInstall = new Map<string, Set<string>>();
  for (const l of links) {
    const set = byInstall.get(l.install_key) ?? new Set<string>();
    set.add(l.user_key);
    byInstall.set(l.install_key, set);
  }
  const shared = new Set<string>();
  for (const [installKey, users] of byInstall) {
    if (users.size > 1) shared.add(installKey);
  }
  return shared;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 조회 소급 — 뷰 두 벌
// ════════════════════════════════════════════════════════════════════════════

/** 어느 기준으로 사람에게 귀속했는가. ★라벨 없는 사람 축 숫자는 금지다(§10.4-5). */
export type PersonAxisBasis = "since_link" | "all_time";

/** 화면에 그대로 그리는 배지 문구. 값이 아니라 **말**이 라벨의 본체다. */
export const PERSON_AXIS_BASIS_LABEL: Readonly<
  Record<PersonAxisBasis, string>
> = {
  since_link: "연결 이후 기준",
  all_time: "설치 전체 이력 기준(소급)",
};

/**
 * 두 뷰가 **똑같이** 돌려주는 컬럼 모양. 게이트가 닫혀도 이 모양은 안 바뀐다 —
 * 닫혔을 때만 컬럼이 사라지면 호출측이 "닫힘" 을 장애로 읽는다.
 */
export const PERSON_AXIS_VIEW_COLUMNS: ReadonlyArray<{
  name: string;
  type: string;
}> = [
  { name: "user_key", type: "STRING" },
  { name: "install_key", type: "STRING" },
  { name: "day", type: "DATE" },
  { name: "active", type: "BOOL" },
  { name: "present_only", type: "BOOL" },
  { name: "event_count", type: "INT64" },
  { name: "tokens_total", type: "INT64" },
  { name: "id_scheme", type: "STRING" },
  { name: "link_id_scheme", type: "STRING" },
  { name: "link_source", type: "STRING" },
  { name: "first_linked_at", type: "TIMESTAMP" },
  { name: "basis", type: "STRING" },
  { name: "effective_from", type: "DATE" },
  { name: "disabled_reason", type: "STRING" },
];

function viewNameFor(basis: PersonAxisBasis): string {
  return basis === "since_link" ? VIEW_PERSON_SINCE_LINK : VIEW_PERSON_ALL_TIME;
}

/**
 * ★게이트가 닫혔을 때의 뷰 본문 — **0행 + 사유**.
 *
 * 컬럼 모양은 열렸을 때와 글자 하나까지 같고, 행만 0개다. `disabled_reason` 이
 * 스키마에 남아 있어서 BQ 콘솔에서 뷰를 열어 본 사람이 "왜 비었나" 를 표 안에서
 * 읽는다 — 사유가 코드 주석에만 있으면 아무도 안 읽는다.
 *
 * `FROM UNNEST(ARRAY<STRING>[])` 는 항상 0행이다. WHERE FALSE 와 달리 원천
 * 테이블을 **참조조차 하지 않으므로**, 게이트가 닫힌 동안에는 링크표·원본에 대한
 * 읽기 권한이 없어도 뷰가 성립한다.
 */
function buildClosedGateSql(basis: PersonAxisBasis, reason: string): string {
  const cols = PERSON_AXIS_VIEW_COLUMNS.map((c) => {
    if (c.name === "basis") return `  ${sqlString(basis)} AS basis`;
    if (c.name === "disabled_reason") {
      return `  ${sqlString(reason)} AS disabled_reason`;
    }
    return `  CAST(NULL AS ${c.type}) AS ${c.name}`;
  }).join(",\n");
  return [
    "-- ★사람 축 게이트 닫힘 — 0행 + 사유.",
    "--   예외를 던지지 않는다(응답 전체가 죽는다).",
    "--   전체를 보여주지 않는다(상한 없는 소급이 된다).",
    `--   ${reason}`,
    "SELECT",
    cols,
    "FROM UNNEST(ARRAY<STRING>[]) AS _person_axis_closed",
  ].join("\n");
}

/** 게이트가 열렸을 때의 뷰 본문. */
function buildOpenGateSql(
  basis: PersonAxisBasis,
  projectId: string,
  effectiveFrom: string,
): string {
  const link = `\`${projectId}.${IDENTITY_DATASET}.${TABLE_USER_INSTALL}\``;
  const daily = `\`${projectId}.${TELEMETRY_DATASET}.${SOURCE_TABLE_USER_DAILY}\``;
  const sinceLinkFilter =
    basis === "since_link"
      ? [
          "  -- ★기본 뷰: 링크가 생긴 날부터만 그 사람에게 귀속한다.",
          "  AND d.day >= DATE(l.first_linked_at)",
        ]
      : [
          "  -- ★소급 뷰: 링크 이전 구간도 그 설치의 사람에게 귀속한다.",
          "  --   캠페인 귀속 전용이고, 화면에 라벨이 없으면 쓰면 안 된다(§10.4-5).",
        ];
  return [
    `-- 사람 축 ${basis} 뷰. 소급은 저장이 아니라 **조회**로 한다 —`,
    "-- 이벤트 행에는 user_key 컬럼이 없고, 이 뷰가 링크표를 붙여서 만든다.",
    "-- ★링크표를 지우면 이 뷰는 그 자리에서 0행이 된다(= 소급 취소).",
    "WITH shared AS (",
    "  -- 공용 기기: 한 설치에 계정이 둘 이상. 값을 만들지 않고 **센다**.",
    "  SELECT install_key",
    `  FROM ${link}`,
    "  GROUP BY install_key",
    "  HAVING COUNT(DISTINCT user_key) > 1",
    "),",
    "link AS (",
    "  SELECT",
    "    user_key, install_key,",
    "    ANY_VALUE(id_scheme) AS link_id_scheme,",
    "    ANY_VALUE(link_source) AS link_source,",
    "    MIN(first_linked_at) AS first_linked_at",
    `  FROM ${link}`,
    "  WHERE install_key NOT IN (SELECT install_key FROM shared)",
    "  GROUP BY user_key, install_key",
    ")",
    "SELECT",
    "  l.user_key,",
    "  l.install_key,",
    "  d.day,",
    "  d.active,",
    "  d.present_only,",
    "  d.event_count,",
    "  d.tokens_total,",
    "  d.id_scheme,",
    "  l.link_id_scheme,",
    "  l.link_source,",
    "  l.first_linked_at,",
    `  ${sqlString(basis)} AS basis,`,
    `  DATE(${sqlString(effectiveFrom)}) AS effective_from,`,
    "  CAST(NULL AS STRING) AS disabled_reason",
    `FROM ${daily} d`,
    "JOIN link l ON l.install_key = d.install_key_hmac",
    "-- ★install_key_hmac 이 NULL 인 과거 daily 행은 자연히 제외된다.",
    "-- ★상한: 개정 발효일 이전 구간은 두 뷰 모두에서 제외한다(설계 §5.4).",
    `WHERE d.day >= DATE(${sqlString(effectiveFrom)})`,
    ...sinceLinkFilter,
  ].join("\n");
}

/** 뷰 본문 SQL. 게이트가 닫혀 있으면 0행 + 사유를 돌려주는 SQL 이 나온다. */
export function buildPersonAxisViewSql(
  basis: PersonAxisBasis,
  gate: PersonAxisGate,
  projectId: string,
): string {
  return gate.open
    ? buildOpenGateSql(basis, projectId, gate.effectiveFrom)
    : buildClosedGateSql(basis, gate.reason);
}

/**
 * `CREATE OR REPLACE VIEW` DDL.
 *
 * ★원본 테이블은 만들지도 고치지도 않는다 — 새 뷰만이다. 게이트가 닫힌 채로
 * 만들어도 안전하다(0행). 나중에 게이트를 열면 같은 DDL 을 다시 돌려서 뷰 본문만
 * 바뀐다 — 그게 "소급을 조회로 옮기면 되돌릴 수 있다" 의 실물이다.
 */
export function buildPersonAxisViewDdl(
  basis: PersonAxisBasis,
  gate: PersonAxisGate,
  projectId: string,
): string {
  const name = `\`${projectId}.${IDENTITY_DATASET}.${viewNameFor(basis)}\``;
  return [
    `CREATE OR REPLACE VIEW ${name} AS`,
    buildPersonAxisViewSql(basis, gate, projectId),
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 뷰와 같은 규칙의 순수 구현 — 되돌릴 수 있음을 테스트로 확인하는 자리
// ════════════════════════════════════════════════════════════════════════════

/** 익명축 일별 행(analytics_user_daily 한 줄). ★user_key 컬럼이 없다. */
export type PersonAxisDailyRow = {
  /** 원시 설치 id. 보존용이며 링크표 조인에는 쓰지 않는다. */
  install_key: string;
  /** 링크표/identity 와 같은 HMAC 설치 키. 과거 행은 null 일 수 있다. */
  install_key_hmac?: string | null;
  /** 'YYYY-MM-DD' */
  day: string;
  active?: boolean;
  present_only?: boolean;
  event_count?: number | null;
  tokens_total?: number | null;
  id_scheme?: string | null;
};

export type PersonAxisResolvedRow = PersonAxisDailyRow & {
  user_key: string;
  link_id_scheme: string | null;
  link_source: string | null;
  first_linked_at: string;
  basis: PersonAxisBasis;
  effective_from: string;
};

export type PersonAxisAttribution = {
  rows: ReadonlyArray<PersonAxisResolvedRow>;
  basis: PersonAxisBasis;
  /** 게이트가 닫혔으면 사유가 여기 있다. 열렸으면 null. */
  disabledReason: string | null;
  /** 공용 기기로 판정돼 제외된 **설치 수**(행 수가 아니다 — 설계 §10.3). */
  excludedSharedInstalls: number;
  /** 공용 기기라서 버린 행 수. 조용히 빼지 않는다 — 센다. */
  droppedSharedRows: number;
  /** 발효일 상한에 걸려 제외된 행 수. */
  droppedBeforeEffectiveFrom: number;
  /** since_link 기준에서 링크 이전이라 제외된 행 수. */
  droppedBeforeLink: number;
  /** 붙일 링크가 없던 행 수. ★버리지 않고 센다(unmapped 규약). */
  unlinkedRows: number;
};

function emptyAttribution(
  basis: PersonAxisBasis,
  disabledReason: string | null,
): PersonAxisAttribution {
  return {
    rows: [],
    basis,
    disabledReason,
    excludedSharedInstalls: 0,
    droppedSharedRows: 0,
    droppedBeforeEffectiveFrom: 0,
    droppedBeforeLink: 0,
    unlinkedRows: 0,
  };
}

/**
 * 익명축 행을 사람에게 귀속한다 — **저장하지 않고**.
 *
 * 뷰 SQL 과 같은 규칙의 Node 구현이다. 두 벌을 두는 이유는 하나다: BQ 를 띄우지
 * 않고도 "링크표를 지우면 소급이 즉시 취소된다" 를 테스트로 확인하기 위해서다.
 *
 * ★입력 배열을 변형하지 않는다. 익명축 행은 이 함수를 통과해도 익명축 행 그대로다.
 */
export function attributePersonRows(
  dailyRows: ReadonlyArray<PersonAxisDailyRow>,
  links: ReadonlyArray<UserInstallLink>,
  basis: PersonAxisBasis,
  gate: PersonAxisGate,
): PersonAxisAttribution {
  if (!gate.open) return emptyAttribution(basis, gate.reason);

  const effectiveFrom = gate.effectiveFrom;
  const shared = findSharedInstalls(links);

  // 공용 기기를 뺀 뒤의 설치 → 링크(설치당 1개). first_linked_at 은 MIN.
  const byInstall = new Map<string, UserInstallLink>();
  for (const l of links) {
    if (shared.has(l.install_key)) continue;
    const prev = byInstall.get(l.install_key);
    if (prev === undefined || l.first_linked_at < prev.first_linked_at) {
      byInstall.set(l.install_key, l);
    }
  }

  const rows: PersonAxisResolvedRow[] = [];
  let droppedSharedRows = 0;
  let droppedBeforeEffectiveFrom = 0;
  let droppedBeforeLink = 0;
  let unlinkedRows = 0;

  for (const d of dailyRows) {
    const joinKey = d.install_key_hmac ?? "";
    if (shared.has(joinKey)) {
      droppedSharedRows += 1;
      continue;
    }
    // ★상한을 링크 조회보다 **먼저** 본다. 발효일 밖의 행은 링크가 있든 없든
    //   사람 축에 들어오지 않으므로, 그걸 unlinked 로 세면 커버리지가 실제보다
    //   나빠 보이고 "링크가 덜 붙었다" 는 틀린 결론이 나온다.
    if (d.day < effectiveFrom) {
      droppedBeforeEffectiveFrom += 1;
      continue;
    }
    const link = byInstall.get(joinKey);
    if (link === undefined) {
      unlinkedRows += 1;
      continue;
    }
    if (basis === "since_link" && d.day < link.first_linked_at.slice(0, 10)) {
      droppedBeforeLink += 1;
      continue;
    }
    rows.push({
      ...d,
      user_key: link.user_key,
      link_id_scheme: link.id_scheme ?? null,
      link_source: link.link_source ?? null,
      first_linked_at: link.first_linked_at,
      basis,
      effective_from: effectiveFrom,
    });
  }

  return {
    rows,
    basis,
    disabledReason: null,
    excludedSharedInstalls: shared.size,
    droppedSharedRows,
    droppedBeforeEffectiveFrom,
    droppedBeforeLink,
    unlinkedRows,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 커버리지 — 부분 적재 중에 화면이 거짓말하지 않게 (설계 §10.3)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 사람 축을 쓰는 **모든** 응답에 붙인다.
 *
 * ★설계 §10.3 의 세 상태에 `disabled` 하나가 더 있다. 게이트가 닫힌 것은
 * "적재 전"(pending)이 아니다 — 소스가 없는 게 아니라 **아직 열면 안 되는** 것이고,
 * 그 둘을 같은 말로 그리면 화면이 "곧 채워집니다" 라는 거짓 기대를 만든다.
 */
export interface PersonAxisCoverage {
  state: "disabled" | "pending" | "ingesting" | "complete";
  /**
   * ★이 봉투가 말하는 지표의 이름. 예전 "coverage" 는 활동 설치 분모로 읽혀
   * 거짓말이 됐다. 지금 분모는 analytics_identity 의 HMAC install_key 집합이다.
   */
  metric: "identity_linked_ratio";
  /** disabled 일 때만 채워진다. 화면이 이 문장을 그대로 그린다. */
  disabledReason: string | null;
  /** analytics_identity 의 HMAC install_key 중 링크표에 붙은 설치 수. */
  identityLinkedInstalls: number;
  /** analytics_identity 의 HMAC install_key 전체 수. */
  identityTotalInstalls: number;
  /** daily 원시 install_key 축에서 조회 구간에 활동한 설치 수. */
  dailyActiveInstalls: number;
  /** 현재 raw/HMAC 불일치 때문에 0 으로 남는 교집합. */
  dailyLinkedActiveInstalls: number;
  /** daily raw install_key 와 identity/link HMAC install_key 는 아직 직접 조인 불가다. */
  dailyJoinable: boolean;
  dailyJoinNote: string;
  /** @deprecated identityLinkedInstalls 와 같다. 기존 프론트 호환용. */
  linkedInstalls: number;
  /** @deprecated identityTotalInstalls 와 같다. 기존 프론트 호환용. */
  totalInstalls: number;
  /** @deprecated dailyLinkedActiveInstalls 와 같다. identity 지표 판정에는 쓰지 않는다. */
  linkedActiveInstalls: number;
  /** @deprecated dailyActiveInstalls 와 같다. identity 지표 판정에는 쓰지 않는다. */
  activeInstalls: number;
  /** 공용 기기로 판정돼 제외된 설치 수(설계 §5.5). */
  excludedSharedInstalls: number;
  /** 개정 발효일 — 소급 상한. 게이트가 닫혔으면 null. */
  effectiveFrom: string | null;
  /** 이 카드가 어느 뷰를 썼나. 라벨 없는 사람 축 숫자 금지(§10.4-5). */
  basis: PersonAxisBasis;
  lastLinkedAt: string | null;
}

export type PersonAxisCoverageInput = {
  gate: PersonAxisGate;
  basis: PersonAxisBasis;
  metric?: "identity_linked_ratio";
  identityLinkedInstalls?: number;
  identityTotalInstalls?: number;
  dailyActiveInstalls?: number;
  dailyLinkedActiveInstalls?: number;
  dailyJoinable?: boolean;
  dailyJoinNote?: string;
  linkedInstalls: number;
  totalInstalls: number;
  linkedActiveInstalls: number;
  activeInstalls: number;
  excludedSharedInstalls: number;
  lastLinkedAt: string | null;
};

/**
 * ★`analytics_user_daily.install_key_hmac` 이 들어온 뒤 daily active 축과
 * 링크/identity 축은 같은 HMAC 공간에서 조인된다. 단 소급 재작성은 하지 않으므로,
 * NULL 인 과거 daily 행은 사람 축에서 빠진다. 그래서 화면은 `dailyJoinNote` 로
 * "언제부터의 daily 행인가" 를 말해야 한다.
 *
 * ★`identityTotalInstalls === 0` 이면 complete 로 올리지 않는다. 분모가 0 인 완전성은
 * 공허참이고, 그걸 100% 로 그리면 "이 구간은 다 봤다" 는 거짓말이 된다. 그때는
 * 기존 `PendingIngestion`("0 이 아니라 소스가 없습니다") 규약으로 접는다.
 */
export function computePersonAxisCoverage(
  input: PersonAxisCoverageInput,
): PersonAxisCoverage {
  const metric = input.metric ?? "identity_linked_ratio";
  const identityLinkedInstalls =
    input.identityLinkedInstalls ?? input.linkedInstalls;
  const identityTotalInstalls =
    input.identityTotalInstalls ?? input.totalInstalls;
  const dailyActiveInstalls = input.dailyActiveInstalls ?? input.activeInstalls;
  const dailyLinkedActiveInstalls =
    input.dailyLinkedActiveInstalls ?? input.linkedActiveInstalls;
  const dailyJoinable = input.dailyJoinable ?? true;
  const dailyJoinNote =
    input.dailyJoinNote ??
    "analytics_user_daily.install_key_hmac 이 채워진 신규 daily 행만 사람 축 링크표와 조인됩니다. install_key_hmac 이 NULL 인 과거 행은 소급 재작성하지 않아 제외됩니다.";
  const base = {
    metric,
    disabledReason: null as string | null,
    identityLinkedInstalls,
    identityTotalInstalls,
    dailyActiveInstalls,
    dailyLinkedActiveInstalls,
    dailyJoinable,
    dailyJoinNote,
    linkedInstalls: identityLinkedInstalls,
    totalInstalls: identityTotalInstalls,
    linkedActiveInstalls: dailyLinkedActiveInstalls,
    activeInstalls: dailyActiveInstalls,
    excludedSharedInstalls: input.excludedSharedInstalls,
    effectiveFrom: input.gate.effectiveFrom,
    basis: input.basis,
    lastLinkedAt: input.lastLinkedAt,
  };

  if (!input.gate.open) {
    return {
      ...base,
      state: "disabled",
      disabledReason: input.gate.reason,
      // 닫혀 있으면 어떤 수치도 신뢰할 근거가 없다 — 0 으로 접는다.
      linkedInstalls: 0,
      identityLinkedInstalls: 0,
      linkedActiveInstalls: 0,
      dailyLinkedActiveInstalls: 0,
      lastLinkedAt: null,
    };
  }
  if (metric === "identity_linked_ratio") {
    if (identityLinkedInstalls <= 0 || identityTotalInstalls <= 0) {
      return { ...base, state: "pending" };
    }
    if (identityLinkedInstalls >= identityTotalInstalls) {
      return { ...base, state: "complete" };
    }
    return { ...base, state: "ingesting" };
  }
  if (input.linkedInstalls <= 0 || input.activeInstalls <= 0) {
    return { ...base, state: "pending" };
  }
  if (input.linkedActiveInstalls >= input.activeInstalls) {
    return { ...base, state: "complete" };
  }
  return { ...base, state: "ingesting" };
}

// ════════════════════════════════════════════════════════════════════════════
// 7b. ★사람 축 성과(작업 결과 축) — 5단 드릴다운 "모델별 성공률" (티켓 85dkAQMiYauFwg1Z9kaH)
// ════════════════════════════════════════════════════════════════════════════
//
// 사장님 지시(2026-09-07): "사람별 아래에 모델별 성공률이 중요하긴해 모델별도
// 상세 모델별 성공률이 나오는게 중요하고 그것도 뚫을수 있음 뚫어줘". 오늘까지
// 이 칸은 `orgDrilldownContract.ts` §5 에 `unwired` 로 정직하게 비어 있었다 —
// Phase 4a(#1358)가 각인까지는 했지만 그 축을 읽는 뷰·콜러블이 없었다.
//
// ★다리는 딱 하나다. `analyticsPseudonym.ts` 상단 주석과 같은 문장이다:
//   두 축(익명 설치축 task_outcomes ↔ 계정축 팀 멤버)을 잇는 유일한 값 공간은
//   `user` kind 가명(`us_` + HMAC(salt, "user:"+uid))이다. `task_outcomes` 는
//   이제 이 값을 **쓰는 시점에 직접 각인**한다(`personAxisStamp.ts`,
//   `applyEventUserKeyStamp` — index.ts 의 `logTaskOutcome`). 그래서 여기는
//   **BigQuery 안에서 두 표를 조인하지 않는다** — `analytics_user_install` 링크
//   표를 살아있는 쿼리로 조인하는 대신, 팀 로스터의 uid 를 서버가 이미 알고
//   있으므로 그 uid 로 **같은 kind·같은 솔트**의 `user` 가명을 다시 계산해
//   `task_outcomes.userKey IN (...)` 로 좁혀 읽는다. 값은 링크표의 `user_key`
//   와 정확히 같은 공간이다(같은 kind·같은 솔트·같은 HMAC). ★이것이 여전히
//   "다리는 analytics_user_install 하나"라는 문장과 모순되지 않는 이유: 그
//   문장이 지키는 것은 **값 공간이 하나**라는 것이지 SQL JOIN 절의 존재가
//   아니다 — 각인이든 링크표 조회든 나오는 `user_key` 값은 동일하다.
//
// ★두 번째 조인 경로를 만들지 않았다. `person` kind 도, `WHERE person_key = ...`
//   도 없다 — 이 파일 상단 `analyticsPseudonym.ts` 인용과 같은 경계.
// ★`teamMember` kind(응답 가명)와 `user` kind(이 축의 조인키)를 섞지 않는다.
//   같은 uid 에서 나와도 kind 가 다르면 HMAC 다이제스트가 다르다 — 두 kind 를
//   직접 비교하는 코드는 여기 없다(0 행이 되거나, 최악의 경우 kind 를 착각해
//   같게 만들면 §5.4 가 막으려던 재식별이 성립한다). 매핑은 **uid 를 아는
//   서버 쪽에서만** 한다: 로스터 uid → (teamMemberKey, userKey) 두 값을 같은
//   솔트로 각각 계산해 두고, `userKey` 로 BQ 를 조회한 결과를 `teamMemberKey`
//   에 되붙인다. 두 가명은 절대 서로 비교되지 않는다.
//
// ── ★처리방침 경계 판단(멈추지 않고 적기만 한다 — 결정은 사장님이 하신다) ──
// 배포된 처리방침(privacyContent.tsx, "사용량·비용 기록 (계정 연결)" 항):
// "연결한 결과는 통계 분석에만 쓰이고, 특정 개인을 알아보거나 특정 계정이
// 무엇을 했는지 되짚는 데는 쓰지 않습니다." 이 기능(사람별 상세 모델 성공률)
// 이 그 문장의 어느 쪽인지: ★내 판단은 **경계선에 걸쳐 있고, 화면 배선 방식이
// 그 경계를 가른다**.
//   - "통계 분석" 에 해당하는 부분: 이 축이 실제로 노출하는 것은 (사람, 모델)
//     쌍의 **집계 수치**(결정 건수·성공 건수)뿐이다. 원문 프롬프트·태스크 제목·
//     타임스탬프 단건은 이 경로 어디에도 없다(§5 문서 규칙 5 "에이전트 개체
//     축을 열지 않는다"와 같은 절제). 이건 "이 사람이 이 모델로 몇 번 성공/
//     실패했나" 라는 통계이지, "이 사람이 언제 무엇을 했는지" 를 되짚는
//     타임라인이 아니다.
//   - "되짚기" 쪽으로 기울 위험: `getTeamProjectAudit`(계정축 원장)은 이미
//     사람별 성공/실패 **건수**를 보여주고 있어 이 축이 그것과 **본질적으로
//     다른 새 프라이버시 노출**을 더하는 것은 아니다 — 다만 이 축은 **익명
//     설치 세계**(원래 "계정을 모른다"고 설계된 세계)의 기록을 처음으로
//     사람에게 되짚는다는 점에서 새롭다. 표본이 작은 사람(예: 결정 1건)의
//     "성공/실패 1건" 은 사실상 "그 사람이 그 태스크에서 뭘 했는지" 를 매우
//     좁게 되짚는 것과 다르지 않다 — 그래서 `PERSON_OUTCOME_MIN_SAMPLE`(35,
//     `orgDrilldownContract.ts`)이 이미 작은 표본에서는 **퍼센트를 안 그리고
//     건수만** 낸다는 규율을 두고 있다. 그 규율을 이 상세 모델 축에도 그대로
//     적용해야 한다(모델별로도 표본이 작을 수 있다 — 화면 쪽 책임).
//   ★결론(판단, 결정 아님): 오늘 구현한 형태(집계 카운트만, 원문 없음, 작은
//   표본은 퍼센트 억제)는 "통계 분석" 쪽에 서 있다고 본다. 다만 "모델별"로
//   너무 잘게 쪼개면(예: 그 사람이 유일하게 쓴 희귀 모델 1개) 사실상 단건
//   식별에 가까워지는 경계가 있다 — 그 경계를 어디로 그을지는 사장님 판단이
//   필요하다고 적어 둔다.

/**
 * task_outcomes 에서 읽은 판정 대상 행 하나. `userKey` 는 쓰기 시점 각인값
 * (`us_` + HMAC) 이거나, 각인 이전/미동의 행이면 null 이다.
 *
 * ★`model` 은 여기서 분류하지 않는다 — 하네스족/실모델/미상 판정은 화면 계약
 * (`orgDrilldownContract.ts` 의 `classifyModelKey`)이 **한 곳에서만** 한다.
 * 여기서 또 분류하면 두 벌의 판정이 갈릴 수 있다.
 */
export interface PersonOutcomeSourceRow {
  userKey: string | null;
  model: string | null;
  /** `null` = 판정 없음(진행중/취소) — 결정 건이 아니다. */
  success: boolean | null;
}

/** 한 사람의 한 모델 버킷. */
export interface PersonOutcomeModelBucket {
  /** task_outcomes.model 원본 문자열(분류는 화면이 한다). */
  model: string | null;
  decided: number;
  successes: number;
}

export interface PersonOutcomeRow {
  /** `teamMember` kind 가명 — `getTeamUsageSummary`/`getTeamProjectAudit` 의
   * `memberKey` 와 같은 공간(같은 솔트로 같은 uid 에서 계산). */
  memberKey: string;
  buckets: PersonOutcomeModelBucket[];
  decided: number;
  successes: number;
}

export interface PersonOutcomeFold {
  rows: PersonOutcomeRow[];
  /**
   * `userKey` 는 있는데 지금 로스터(이 프로젝트의 현재 멤버)의 누구와도 안
   * 맞은 행 수. ★조용히 버리지 않고 센다 — 탈퇴·역할변경으로 생기는 정상
   * 케이스이지만, 화면이 "합계가 전부가 아닐 수 있다"를 말할 근거가 된다.
   */
  unattributedRows: number;
  /** `userKey` 가 아예 없는 행 수(각인 이전이거나 텔레메트리 미동의). */
  unstampedRows: number;
}

/**
 * task_outcomes 행을 로스터에 귀속한다 — **BQ 조인이 아니라 이 함수가 하는
 * 유일한 매칭**이다. `memberKeyByUserKey` 는 호출부가 로스터 uid 마다
 * `userKey`/`memberKey` 를 **같은 솔트로 각각** 계산해 만든다(uid 는 이
 * 함수에 들어오지 않는다 — 순수 함수는 가명만 본다).
 *
 * ★결정 건(`success !== null`)만 센다. `decided`/`successes` 는 이 함수가
 * 계산하지 표본 크기 억제(`canDrawSuccessRate`)는 하지 않는다 — 그건 화면의
 * 몫이다(판정 두 개를 한 함수에 섞지 않는다, `PersonOutcomeAxis` 주석과 같은
 * 분업).
 */
export function foldPersonOutcomeAxis(
  rows: ReadonlyArray<PersonOutcomeSourceRow>,
  memberKeyByUserKey: ReadonlyMap<string, string>,
): PersonOutcomeFold {
  const byMember = new Map<string, Map<string, PersonOutcomeModelBucket>>();
  let unattributedRows = 0;
  let unstampedRows = 0;

  for (const r of rows) {
    if (r.success === null) continue;
    if (!r.userKey) {
      unstampedRows += 1;
      continue;
    }
    const memberKey = memberKeyByUserKey.get(r.userKey);
    if (!memberKey) {
      unattributedRows += 1;
      continue;
    }
    let buckets = byMember.get(memberKey);
    if (!buckets) {
      buckets = new Map<string, PersonOutcomeModelBucket>();
      byMember.set(memberKey, buckets);
    }
    const bucketKey = r.model ?? "";
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { model: r.model, decided: 0, successes: 0 };
      buckets.set(bucketKey, bucket);
    }
    bucket.decided += 1;
    if (r.success === true) bucket.successes += 1;
  }

  const rowsOut: PersonOutcomeRow[] = [...byMember.entries()].map(
    ([memberKey, buckets]) => {
      const bucketList = [...buckets.values()].sort(
        (a, b) => b.decided - a.decided,
      );
      return {
        memberKey,
        buckets: bucketList,
        decided: bucketList.reduce((acc, b) => acc + b.decided, 0),
        successes: bucketList.reduce((acc, b) => acc + b.successes, 0),
      };
    },
  );

  return { rows: rowsOut, unattributedRows, unstampedRows };
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 권한 분리 — 데이터셋 이름이 아니라 IAM 으로 갈렸는지 확인한다
// ════════════════════════════════════════════════════════════════════════════
//
// ★데이터셋만 나누는 것은 권한 분리가 아니다. 두 데이터셋의 principal 집합이
//   같으면 이름표만 다른 **같은 방**이다. 설계 §4.2-3 이 링크표를 따로 둔 이유가
//   "익명축만 읽기 권한을 줄 수 있다" 인데, IAM 이 같으면 그 이유가 실현되지 않는다.
//
//   그래서 이 검사를 코드로 남긴다 — 주석은 안 읽힐 수 있으니 기계가 대신 읽는다
//   (#1079 의 assertAxisPurity 와 같은 방향).

/** BQ 데이터셋 ACL 한 줄. `bq show --format=prettyjson <dataset>` 의 access[]. */
export type DatasetAccessEntry = {
  role: string;
  /** userByEmail / groupByEmail / specialGroup / iamMember / domain 중 무엇이든. */
  principal: string;
  principalType?: string;
};

export type LinkDatasetIsolationFinding = {
  code:
    | "identical_principals"
    | "no_narrowing"
    | "public_principal"
    | "domain_wide";
  message: string;
  principals: ReadonlyArray<string>;
};

export type LinkDatasetIsolationReport = {
  ok: boolean;
  telemetryPrincipalCount: number;
  identityPrincipalCount: number;
  /** 두 데이터셋을 **둘 다** 읽을 수 있는 principal(마스킹됨). */
  overlapping: ReadonlyArray<string>;
  /** 링크표만 읽을 수 있는 principal(마스킹됨) — 이게 0 이면 분리의 의미가 없다. */
  identityOnly: ReadonlyArray<string>;
  findings: ReadonlyArray<LinkDatasetIsolationFinding>;
};

/** 모든 설치가 공유하는 위험한 principal — 있으면 분리가 아니라 공개다. */
const PUBLIC_PRINCIPALS = new Set([
  "allusers",
  "allauthenticatedusers",
  "projectviewers",
  "projectreaders",
]);

/**
 * principal 을 마스킹한다. 이메일은 개인정보다 — 리포트·로그에 원문을 남기지 않는다.
 * `john.kim@hypemarc.com` → `j***@hypemarc.com`
 */
export function maskPrincipal(p: string): string {
  const at = p.indexOf("@");
  if (at <= 0) return p;
  const local = p.slice(0, at);
  const domain = p.slice(at);
  return `${local.slice(0, 1)}***${domain}`;
}

function principalsOf(entries: ReadonlyArray<DatasetAccessEntry>): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    const p = e.principal.trim().toLowerCase();
    if (p.length > 0) out.add(p);
  }
  return out;
}

/**
 * 링크표 데이터셋이 원본 데이터셋과 **IAM 으로** 갈렸는지 검사한다.
 *
 * 통과 조건:
 *  - 두 principal 집합이 같지 않다 (같으면 이름만 다른 같은 방).
 *  - identity 쪽이 telemetry 를 **포함하지 않는다** (포함하면 좁혀진 게 아니다).
 *  - allUsers / allAuthenticatedUsers / projectViewers 같은 광역 principal 이 없다.
 *  - domain 단위 부여가 없다 (도메인 전원 = 사실상 전사 공개).
 *
 * ★이 함수는 던지지 않고 **리포트를 돌려준다.** 배포를 막는 자리는 호출측
 *   (scripts/check-person-axis-isolation.mjs)이고, 여기는 판정만 한다.
 */
export function assertLinkDatasetIsolation(
  telemetryAccess: ReadonlyArray<DatasetAccessEntry>,
  identityAccess: ReadonlyArray<DatasetAccessEntry>,
): LinkDatasetIsolationReport {
  const tel = principalsOf(telemetryAccess);
  const ident = principalsOf(identityAccess);

  const overlapping = [...ident].filter((p) => tel.has(p));
  const identityOnly = [...ident].filter((p) => !tel.has(p));
  const findings: LinkDatasetIsolationFinding[] = [];

  const sameSet =
    tel.size === ident.size && [...tel].every((p) => ident.has(p));
  if (sameSet && tel.size > 0) {
    findings.push({
      code: "identical_principals",
      message:
        `${IDENTITY_DATASET} 와 ${TELEMETRY_DATASET} 의 principal 집합이 같다 — ` +
        "데이터셋 이름만 다르고 권한은 같은 방이다. 링크표를 따로 둔 이유" +
        "(익명축만 읽기 권한을 줄 수 있다)가 실현되지 않는다.",
      principals: [...ident].map(maskPrincipal),
    });
  } else if (tel.size > 0 && [...tel].every((p) => ident.has(p))) {
    findings.push({
      code: "no_narrowing",
      message:
        `${IDENTITY_DATASET} 의 principal 이 ${TELEMETRY_DATASET} 를 전부 포함한다 ` +
        "— 좁혀진 게 아니라 넓어졌다.",
      principals: [...tel].map(maskPrincipal),
    });
  }

  const publics = [...ident].filter((p) =>
    PUBLIC_PRINCIPALS.has(p.replace(/^specialgroup:/, "")),
  );
  if (publics.length > 0) {
    findings.push({
      code: "public_principal",
      message: `${IDENTITY_DATASET} 에 광역 principal 이 있다 — 분리가 아니라 공개다.`,
      principals: publics,
    });
  }

  const domainWide = identityAccess
    .filter((e) => (e.principalType ?? "").toLowerCase() === "domain")
    .map((e) => e.principal);
  if (domainWide.length > 0) {
    findings.push({
      code: "domain_wide",
      message: `${IDENTITY_DATASET} 에 도메인 단위 부여가 있다 — 사실상 전사 공개다.`,
      principals: domainWide,
    });
  }

  return {
    ok: findings.length === 0,
    telemetryPrincipalCount: tel.size,
    identityPrincipalCount: ident.size,
    overlapping: overlapping.map(maskPrincipal),
    identityOnly: identityOnly.map(maskPrincipal),
    findings,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 삭제요청(PIPA 제36조) — 한 줄로 끝나는지 코드로 남긴다
// ════════════════════════════════════════════════════════════════════════════

/**
 * 그 사람의 과거 귀속을 전부 푸는 SQL.
 *
 * ★이벤트 행을 한 줄도 건드리지 않는다. 링크표에서 그 `user_key` 를 지우면
 * 두 뷰가 그 자리에서 그 사람을 못 찾고, 익명 기록은 익명으로 남는다. 이게
 * "소급을 저장이 아니라 조회로" 의 값이다 — (A) 저장 소급이었다면 이 자리가
 * 1,100만행 UPDATE 다.
 */
export function buildPersonAxisEraseSql(projectId: string): string {
  return [
    `DELETE FROM \`${projectId}.${IDENTITY_DATASET}.${TABLE_USER_INSTALL}\``,
    "WHERE user_key = @user_key",
    "-- ★원시 uid 를 SQL 에 넣지 마라. user_key 는 Node 에서 HMAC 해 파라미터로 넘긴다",
    "--   (BQ 는 쿼리 본문을 job 히스토리에 수개월 보관한다).",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 10. 인증 경로 배선용 — 스테이징 없이 한 줄을 MERGE 한다
// ════════════════════════════════════════════════════════════════════════════
//
// ★설계를 바꾸는 절이 아니다. 설계 §6.1 이 요구한 성질은 **"row_id 로 MERGE 해서
//   재실행 중복을 막는다"** 이고, 그 근거는 "스트리밍 insert 의 insertId 중복제거는
//   수 분 창의 best-effort 라 재실행 중복을 못 막는다" 였다. 아래 SQL 은 그 성질을
//   그대로 유지하면서 **스테이징 표만 뺀다.**
//
//   왜 뺐나: 부여 시점이 "그 설치의 로그인 후 첫 인증 요청"(§5.1)이라 한 번에
//   들어오는 링크가 **한 줄**이다. 한 줄을 위해 스테이징 표를 만들고·로드하고·
//   MERGE 하고·지우면 BQ 잡이 요청당 3~4개가 되고, 그 중 하나라도 실패하면
//   스테이징 표가 고아로 남는다. `USING (SELECT @param ...)` 는 잡 하나다.
//
//   백필처럼 **여러 줄**을 한꺼번에 넣는 경로는 그대로 `buildUserInstallMergeSql`
//   (스테이징 판)을 쓴다. 두 함수는 MATCHED/NOT MATCHED 절이 같아야 한다.
//
// ★파라미터에는 원시 uid 가 들어갈 자리가 없다 — 전부 가명(us_/in_/lk_)과
//   타임스탬프다. BQ 는 쿼리 본문을 job 히스토리에 수개월 보관하므로 이게 중요하다.

/**
 * 링크가 만들어진 고지의 버전.
 *
 * ★정본은 `v3/src/services/privacyClarification.ts` 의
 * `PRIVACY_CLARIFICATION_VERSION` 이다(현재 "2026-08-29" — 3차 결합 고지).
 * 렌더러 모듈이라
 * functions 에서 import 할 수 없어 값을 한 벌 더 둔다 — **둘이 갈라지면
 * 링크가 어느 고지 하에서 만들어졌는지 표가 거짓말을 한다.** 저쪽을 올릴 때
 * 여기도 같이 올려라.
 *
 * ★`CURRENT_POLICY_VERSION`(동의 재프롬프트 축, "2026-06-01")이 아니다.
 * 이 링크를 정당화하는 것은 재동의가 아니라 1회성 고지다(설계 §5.4-a 거래 조건).
 */
export const PERSON_AXIS_LINK_POLICY_VERSION = "2026-08-29";

/**
 * ★배선 뒤에도 각 설치는 **다음에 인증할 때부터** 붙는다(forward-only).
 *
 * 배포 직후 사람 축이 거의 비어 있는 것은 장애가 아니라 설계다. 이 문장을
 * 화면·문서에 적지 않으면 "켰는데 왜 비어 있지" 로 읽힌다.
 *
 * ★화면에 그리는 쪽은 프론트 상수다 — `marblo-web/.../AnalyticsPanel.tsx` 의
 * 같은 이름 상수(#1090). 프론트는 응답에 `personAxis` 봉투가 **있을 때만** 그
 * 문장을 띄우므로, 서버가 할 일은 문자열을 한 벌 더 보내는 게 아니라 **봉투를
 * 싣는 것**이다(두 벌을 보내면 화면에 두 번 찍힌다).
 *
 * ★그래서 이 상수는 프론트 미러와 **글자까지 같아야 한다.** 갈라지면 서버 문서와
 * 화면이 서로 다른 말을 하고, 어느 쪽이 맞는지 아무도 못 말한다. 아래 테스트가
 * 그걸 고정한다(`★forward-only 문장은 프론트 미러와 글자까지 같다`).
 */
export const PERSON_AXIS_FORWARD_ONLY_NOTE =
  "사람 축 링크는 forward-only 입니다 — 각 설치는 '다음에 인증할 때' 부터 " +
  "붙습니다. 그래서 켠 직후에 연결된 설치가 거의 없는 것이 정상이고, 여기 " +
  "낮은 identity linked ratio 는 '사람이 없다' 가 아니라 '아직 안 붙었다' 입니다. 잠자는 " +
  "설치는 며칠에서 영원히 안 붙을 수 있습니다.";

/** MERGE 파라미터 이름. SQL 과 params 가 갈라지지 않게 한 곳에서 센다. */
const MERGE_PARAM_NAMES: ReadonlyArray<keyof UserInstallLinkRow> = [
  "row_id",
  "user_key",
  "install_key",
  "id_scheme",
  "link_source",
  "first_linked_at",
  "last_seen_at",
  "policy_version",
  "ingested_at",
];

/** TIMESTAMP 로 캐스팅해야 하는 파라미터(나머지는 STRING). */
const MERGE_TIMESTAMP_PARAMS = new Set<string>([
  "first_linked_at",
  "last_seen_at",
  "ingested_at",
]);

/**
 * 한 줄짜리 파라미터 MERGE. `buildUserInstallMergeSql` 과 **같은 갱신 규칙**이다
 * — `first_linked_at` 은 LEAST 로 작은 쪽을 남긴다(소급 경계의 단일 출처).
 */
export function buildUserInstallInlineMergeSql(projectId: string): string {
  const target = `\`${projectId}.${IDENTITY_DATASET}.${TABLE_USER_INSTALL}\``;
  const using = MERGE_PARAM_NAMES.map((n) =>
    MERGE_TIMESTAMP_PARAMS.has(n)
      ? `    TIMESTAMP(@${n}) AS ${n}`
      : `    @${n} AS ${n}`,
  ).join(",\n");
  return [
    `MERGE ${target} T`,
    "USING (",
    "  SELECT",
    using,
    ") S",
    "ON T.row_id = S.row_id",
    "WHEN MATCHED THEN UPDATE SET",
    "  T.last_seen_at = GREATEST(T.last_seen_at, S.last_seen_at),",
    "  -- ★first_linked_at 은 덮지 않는다(MIN 유지) — 소급 경계의 단일 출처다.",
    "  T.first_linked_at = LEAST(T.first_linked_at, S.first_linked_at),",
    "  T.id_scheme = S.id_scheme,",
    "  T.link_source = S.link_source,",
    "  T.policy_version = S.policy_version,",
    "  T.ingested_at = S.ingested_at",
    "WHEN NOT MATCHED THEN INSERT (",
    "  row_id, user_key, install_key, id_scheme, link_source,",
    "  first_linked_at, last_seen_at, policy_version, ingested_at",
    ") VALUES (",
    "  S.row_id, S.user_key, S.install_key, S.id_scheme, S.link_source,",
    "  S.first_linked_at, S.last_seen_at, S.policy_version, S.ingested_at",
    ")",
  ].join("\n");
}

/**
 * MERGE 파라미터. ★행에 있는 값만 그대로 넘긴다 — 여기서 값을 만들지 않는다.
 * (행은 `planUserInstallLink` 가 게이트를 통과시킨 것만 돌려준다.)
 */
export function buildUserInstallMergeParams(
  row: UserInstallLinkRow,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of MERGE_PARAM_NAMES) out[name] = row[name];
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 11. 커버리지 SQL — 값을 만들지 않고 **세는** 쿼리
// ════════════════════════════════════════════════════════════════════════════
//
// ★SQL 을 이 모듈에 두는 이유는 §2 의 DDL 과 같다 — 여기 있으면 단위테스트가
//   읽을 수 있고, index.ts 안에 있으면 아무도 못 읽는다.
//
// ★본문에 원시 uid 도 솔트도 없다. 파라미터는 날짜 둘뿐이다(@since,
//   @effective_from) — BQ 가 쿼리 본문을 job 히스토리에 수개월 보관한다.

/**
 * identity_linked_ratio 한 벌을 세는 SQL.
 *
 * ★`analytics_user_daily.install_key` 는 raw 설치 ID 로 보존하고,
 * `install_key_hmac` 으로만 링크/identity 축과 조인한다. 소급 재작성은 하지
 * 않으므로 NULL 인 과거 행은 daily 사람 축 숫자에서 빠진다.
 *
 * ★공용 기기 설치는 `linked` 에서 빼고 `excluded_shared_installs` 로 **센다.**
 * 뷰(`buildOpenGateSql`)와 같은 규칙이어야 화면의 분모와 표의 행 수가 맞는다.
 */
export function buildPersonAxisCoverageSql(projectId: string): string {
  const link = `\`${projectId}.${IDENTITY_DATASET}.${TABLE_USER_INSTALL}\``;
  const daily = `\`${projectId}.${TELEMETRY_DATASET}.${SOURCE_TABLE_USER_DAILY}\``;
  const identity = `\`${projectId}.${TELEMETRY_DATASET}.${SOURCE_TABLE_ANALYTICS_IDENTITY}\``;
  return [
    "WITH shared AS (",
    "  -- 공용 기기: 한 설치에 계정이 둘 이상(설계 §5.5). 값을 만들지 않고 센다.",
    `  SELECT install_key FROM ${link}`,
    "  GROUP BY install_key HAVING COUNT(DISTINCT user_key) > 1",
    "),",
    "linked AS (",
    `  SELECT DISTINCT install_key FROM ${link}`,
    "  WHERE install_key NOT IN (SELECT install_key FROM shared)",
    "),",
    "identity AS (",
    "  -- ★HMAC install_key 정본. 이 집합이 identity_linked_ratio 의 분모다.",
    `  SELECT DISTINCT install_key FROM ${identity}`,
    "  WHERE install_key IS NOT NULL AND install_key != ''",
    "),",
    "daily_active_rows AS (",
    "  -- ★daily.install_key_hmac 이 채워진 행만 링크/identity 와 같은 키 공간이다.",
    `  SELECT install_key_hmac AS install_key, day FROM ${daily}`,
    "  WHERE day >= GREATEST(DATE(@since), DATE(@effective_from))",
    "    AND active",
    "    AND install_key_hmac IS NOT NULL",
    "    AND install_key_hmac != ''",
    "),",
    "daily_active AS (",
    "  SELECT DISTINCT install_key FROM daily_active_rows",
    "),",
    "SELECT",
    "  (SELECT COUNT(*) FROM identity i JOIN linked l USING (install_key))",
    "    AS linked_installs,",
    "  (SELECT COUNT(*) FROM identity) AS total_installs,",
    "  (SELECT COUNT(*) FROM daily_active a JOIN linked l USING (install_key))",
    "    AS linked_active_installs,",
    "  (SELECT COUNT(*) FROM daily_active) AS active_installs,",
    "  (SELECT CAST(MIN(day) AS STRING) FROM daily_active_rows) AS daily_hmac_first_day,",
    "  (SELECT COUNT(*) FROM shared) AS excluded_shared_installs,",
    `  (SELECT CAST(MAX(first_linked_at) AS STRING) FROM ${link})`,
    "    AS last_linked_at",
  ].join("\n");
}
