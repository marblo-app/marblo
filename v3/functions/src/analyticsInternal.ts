// 내부 계정 판정 — 순수 로직(BQ/Firebase 무의존). analyticsPseudonym.ts /
// personAxis.ts 와 같은 규약으로 node --test 로 단위검증한다.
//
// 설계 정본: v3/docs/person-axis-event-stamp-2026-08-29.md §4.
//
// ── ★왜 이 모듈이 있나 (ticket VZ0K2FIeASLrWy9bwvN1) ──────────────────────────
// `analytics_account_profile.is_admin` 은 **오너 한 명만** 판정한다
// (`analyticsProfiles.ts:1589` — `a.key === adminUid`, adminUid 는 env `ADMIN_UID`).
// 그런데 도그푸드 표본이 30 수준이라 내부 계정이 KPI 를 그대로 오염시키고,
// 내부는 오너 혼자가 아니다(사장님 지시 2026-08-29: melocream·datagadapida·
// 팀 추가 계정까지 내부로 묶어라).
//
// ── ★하드코딩하지 않는 것이 요구사항이다 ────────────────────────────────────
// uid 를 소스에 박으면 (1) 계정이 하나 늘 때마다 배포가 필요하고 (2) 계정
// 식별자가 git 히스토리에 영구히 남는다. 그래서 목록은 **설정**으로 둔다:
//
//   1순위  Firestore `config/analyticsInternal` 문서 — 배포 없이 관리 가능.
//   2순위  env (`ANALYTICS_INTERNAL_UIDS` / `_EMAILS` / `_EMAIL_DOMAINS`)
//   항상   env `ADMIN_UID` — 오너는 설정이 비어 있어도 항상 내부다(fail-safe).
//
// 두 소스는 **합집합**이다. Firestore 를 못 읽어도(권한·장애) 오너 제외는
// 살아 있어야 하기 때문이다 — 내부 판정이 조용히 0명이 되면 그 순간 KPI 가
// 낙관 편향되고, 화면은 그 사실을 모른다.
//
// ── ★이 모듈이 BigQuery 로 내보내는 것 / 내보내지 않는 것 ────────────────────
//  내보낸다:  `us_` 가명키 배열(쿼리 파라미터) · boolean · 사유 enum
//  안 내보낸다: 원시 uid · 이메일 · 도메인 · 솔트
//
// BQ 는 쿼리 본문과 파라미터를 job 히스토리에 수개월 보관한다(personAxis.ts 와
// 같은 근거). 그래서 "이메일이 @hypemarc.com 이면 내부" 같은 판정은 **Node 안에서
// 끝내고**, SQL 로는 이미 가명화된 키만 넘긴다.
//
// ── ★사유를 함께 남긴다 ─────────────────────────────────────────────────────
// boolean 하나만 남기면 "왜 이 사람이 내부로 빠졌나" 를 아무도 못 되짚는다.
// 목록에서 uid 를 뺐는데도 계속 내부로 잡히면 도메인 규칙 때문인지 오너
// 폴백 때문인지 구분이 필요하다. 그래서 판정은 항상 (내부여부, 사유)다.

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";

// ════════════════════════════════════════════════════════════════════════════
// 1. 설정 모양
// ════════════════════════════════════════════════════════════════════════════

/** env 키 이름. 값은 쉼표 구분. ★값 자체는 로그·응답에 절대 싣지 않는다. */
export const INTERNAL_UIDS_ENV = "ANALYTICS_INTERNAL_UIDS";
export const INTERNAL_EMAILS_ENV = "ANALYTICS_INTERNAL_EMAILS";
export const INTERNAL_EMAIL_DOMAINS_ENV = "ANALYTICS_INTERNAL_EMAIL_DOMAINS";
export const ADMIN_UID_ENV = "ADMIN_UID";

/** Firestore 설정 문서 좌표 — 배포 없이 목록을 고치는 자리. */
export const INTERNAL_CONFIG_COLLECTION = "config";
export const INTERNAL_CONFIG_DOC = "analyticsInternal";

/**
 * 내부 판정 입력. 세 축을 다 비워도 동작한다 — 그때는 `ADMIN_UID` 하나만 내부다.
 *
 * ★`emailDomains` 는 편의이자 위험이다. 도메인 하나를 잘못 넣으면 고객이 통째로
 * 내부로 빠져 KPI 분모가 조용히 줄어든다. 그래서 판정 결과가 사유를 들고 다니고,
 * 호출측이 "도메인 규칙으로 빠진 계정 수" 를 따로 셀 수 있게 했다(§4.3).
 */
export type InternalAccountConfig = {
  readonly uids: ReadonlyArray<string>;
  readonly emails: ReadonlyArray<string>;
  readonly emailDomains: ReadonlyArray<string>;
};

export const EMPTY_INTERNAL_CONFIG: InternalAccountConfig = {
  uids: [],
  emails: [],
  emailDomains: [],
};

/**
 * 왜 내부로 판정됐나.
 *
 * - `owner`        : env `ADMIN_UID` 와 일치. 설정이 비어도 항상 참인 폴백.
 * - `listed_uid`   : 설정의 uid 목록에 있다.
 * - `listed_email` : 설정의 이메일 목록에 있다(정규화 후 비교).
 * - `email_domain` : 설정의 도메인 목록에 걸린다. ★가장 넓은 규칙이라 따로 센다.
 */
export type InternalReason =
  | "owner"
  | "listed_uid"
  | "listed_email"
  | "email_domain";

/** 판정 결과. ★내부가 아니면 사유가 null 이다 — 둘이 같이 움직인다. */
export type InternalVerdict =
  | { readonly internal: false; readonly reason: null }
  | { readonly internal: true; readonly reason: InternalReason };

const NOT_INTERNAL: InternalVerdict = { internal: false, reason: null };

// ════════════════════════════════════════════════════════════════════════════
// 2. 정규화 — 비교 규약을 한 곳에 못박는다
// ════════════════════════════════════════════════════════════════════════════

/** gmail 계열은 점을 무시하고 `+태그` 를 버린다(구글 규약). */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * 도메인 모양인가. 점 하나가 있는지만 보면 ".com" / "a..b" 같은 값이 통과한다 —
 * 그러면 없는 사람이 내부 목록에 생긴다. **라벨이 전부 비어 있지 않아야** 한다.
 */
function isDomainShaped(domain: string): boolean {
  if (domain.length === 0 || domain.includes("@")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((l) => l.length > 0);
}

/**
 * 이메일 비교용 정규화.
 *
 * ★규약을 여기 한 곳에만 둔다. 설정에 적힌 값과 계정에 붙은 값이 **같은 함수**를
 * 통과해야 "john.kim@" 과 "JohnKim@" 이 같은 사람으로 잡힌다. 두 자리에서 각자
 * 소문자화하면 언젠가 한쪽만 `+태그` 를 버리게 되고, 그때 판정이 조용히 갈린다.
 *
 * @returns 비교 가능한 문자열. 이메일 모양이 아니면 null(원시값 폴백 없음).
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  const at = t.lastIndexOf("@");
  if (at <= 0 || at === t.length - 1) return null;
  const domain = t.slice(at + 1);
  if (!isDomainShaped(domain)) return null;
  let local = t.slice(0, at);
  // ★`lastIndexOf("@")` 로 갈랐으므로 로컬부에 `@` 가 남을 수 있다("a@@b.com").
  //   그건 이메일이 아니다 — 조용히 정규화하면 "a@" 라는 없는 사람이 생긴다.
  if (local.includes("@")) return null;
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  if (local.length === 0) return null;
  return `${local}@${domain}`;
}

/** 도메인 비교용 정규화. 선행 `@`/`.` 를 떼고 소문자화한다. */
export function normalizeEmailDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/^[@.]+/, "");
  return isDomainShaped(t) ? t : null;
}

/** 쉼표/공백 구분 목록을 배열로. 빈 항목은 버린다. */
export function parseListEnv(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 설정 읽기 — env / Firestore 문서 / 합집합
// ════════════════════════════════════════════════════════════════════════════

/** env 에서 설정 한 벌. ★`ADMIN_UID` 는 여기 포함하지 않는다(항상 별도 폴백). */
export function readInternalConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): InternalAccountConfig {
  return {
    uids: parseListEnv(env[INTERNAL_UIDS_ENV]),
    emails: parseListEnv(env[INTERNAL_EMAILS_ENV]),
    emailDomains: parseListEnv(env[INTERNAL_EMAIL_DOMAINS_ENV]),
  };
}

/**
 * Firestore `config/analyticsInternal` 문서 데이터를 설정으로 읽는다.
 *
 * ★문서가 없거나 모양이 틀려도 던지지 않는다 — 빈 설정을 돌려주고, 호출측이
 * env·오너 폴백과 합친다. 설정 문서 하나 때문에 어드민 응답 전체가 죽으면
 * 안 된다(personAxis 게이트가 "닫힘은 정상 상태" 로 잡은 것과 같은 규율).
 */
export function readInternalConfigFromDoc(
  data: unknown
): InternalAccountConfig {
  if (data == null || typeof data !== "object") return EMPTY_INTERNAL_CONFIG;
  const d = data as Record<string, unknown>;
  const list = (v: unknown): string[] => {
    if (Array.isArray(v)) {
      return v
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return parseListEnv(v);
  };
  return {
    uids: list(d.uids),
    emails: list(d.emails),
    emailDomains: list(d.emailDomains),
  };
}

/** 설정 여럿을 합집합으로 합친다(중복 제거는 판정 쪽 Set 이 한다). */
export function mergeInternalConfigs(
  ...configs: ReadonlyArray<InternalAccountConfig>
): InternalAccountConfig {
  return {
    uids: configs.flatMap((c) => c.uids),
    emails: configs.flatMap((c) => c.emails),
    emailDomains: configs.flatMap((c) => c.emailDomains),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 판정
// ════════════════════════════════════════════════════════════════════════════

/** 판정에 쓸 계정 한 명. 둘 다 없으면 판정 불가(내부 아님)로 떨어진다. */
export type InternalAccountInput = {
  readonly uid?: string | null;
  readonly email?: string | null;
};

/**
 * 판정 준비물. 매 계정마다 목록을 정규화하지 않도록 한 번만 만든다.
 *
 * ★`ownerUid` 는 설정과 **독립**이다. 설정이 비어도, 못 읽어도 오너는 내부다.
 */
export type InternalMatcher = {
  readonly ownerUid: string | null;
  readonly uids: ReadonlySet<string>;
  readonly emails: ReadonlySet<string>;
  readonly emailDomains: ReadonlySet<string>;
};

export function buildInternalMatcher(
  config: InternalAccountConfig,
  env: Record<string, string | undefined> = process.env
): InternalMatcher {
  const owner = (env[ADMIN_UID_ENV] ?? "").trim();
  const emails = new Set<string>();
  for (const e of config.emails) {
    const n = normalizeEmail(e);
    if (n) emails.add(n);
  }
  const domains = new Set<string>();
  for (const d of config.emailDomains) {
    const n = normalizeEmailDomain(d);
    if (n) domains.add(n);
  }
  return {
    ownerUid: owner.length > 0 ? owner : null,
    uids: new Set(config.uids.map((u) => u.trim()).filter((u) => u.length > 0)),
    emails,
    emailDomains: domains,
  };
}

/**
 * 이 계정이 내부인가.
 *
 * ★사유 우선순위는 **좁은 규칙부터**다: owner → uid → email → domain.
 * 넓은 규칙(domain)이 먼저 잡으면 "오너인데 도메인 때문에 빠졌다" 처럼 읽혀서,
 * 목록을 고쳐도 왜 안 바뀌는지 설명이 안 된다.
 */
export function classifyInternalAccount(
  account: InternalAccountInput,
  matcher: InternalMatcher
): InternalVerdict {
  const uid = typeof account.uid === "string" ? account.uid.trim() : "";
  if (uid.length > 0) {
    if (matcher.ownerUid !== null && uid === matcher.ownerUid) {
      return { internal: true, reason: "owner" };
    }
    if (matcher.uids.has(uid)) return { internal: true, reason: "listed_uid" };
  }
  const email = normalizeEmail(account.email);
  if (email !== null) {
    if (matcher.emails.has(email)) {
      return { internal: true, reason: "listed_email" };
    }
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (matcher.emailDomains.has(domain)) {
      return { internal: true, reason: "email_domain" };
    }
  }
  return NOT_INTERNAL;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. BQ 로 넘기는 형태 — 가명키 배열 하나
// ════════════════════════════════════════════════════════════════════════════

/**
 * 내부 계정의 `user_key` 목록. 쿼리에서 `WHERE user_key NOT IN UNNEST(@keys)`
 * 로 쓰기 위한 것이다.
 *
 * ★새 테이블을 만들지 않는 이유: 내부 계정은 지금 한 자릿수다. 표를 만들면
 * 두 축을 잇는 자리가 하나 더 생기고(personAxis.ts `LINK_AXIS_TABLES` 주석 참조),
 * 그 순간 "링크표 하나 지우면 사람 축이 사라진다" 는 성질이 깨진다. 파라미터로
 * 넘기면 BQ 에 남는 것은 job 히스토리의 가명 문자열뿐이다.
 *
 * ★uid 를 모르는 항목(이메일·도메인으로만 잡힌 계정)은 여기 못 들어간다 —
 * `user_key` 는 uid 파생이기 때문이다. 호출측이 uid 를 함께 넘겨야 한다.
 *
 * @returns 정렬된 고유 `us_` 키 배열. 솔트가 없으면 **빈 배열**(원시값 폴백 없음).
 */
export function deriveInternalUserKeys(
  uids: ReadonlyArray<string>,
  salt: string | null
): string[] {
  if (!salt) return [];
  const out = new Set<string>();
  for (const raw of uids) {
    const uid = typeof raw === "string" ? raw.trim() : "";
    if (uid.length === 0) continue;
    const key = pseudonymizeAnalyticsId("user", uid, salt);
    if (typeof key === "string" && key.length > 0) out.add(key);
  }
  return [...out].sort();
}

/**
 * 매처가 아는 **uid 축** 전부(오너 + 목록). 이메일/도메인 축은 uid 를 모르므로
 * 빠진다 — 그 사실을 감추지 않고 `emailOnlyRules` 로 센다.
 */
export function internalUidsOf(matcher: InternalMatcher): string[] {
  const out = new Set<string>();
  if (matcher.ownerUid !== null) out.add(matcher.ownerUid);
  for (const u of matcher.uids) out.add(u);
  return [...out].sort();
}

/**
 * 화면·로그에 실을 수 있는 요약. ★원시 uid·이메일·도메인은 한 글자도 없다.
 * 개수만 있다(기존 `adminExcluded` 규약: "제외 건수만 노출한다").
 */
export type InternalMatcherSummary = {
  readonly hasOwner: boolean;
  readonly uidRules: number;
  readonly emailRules: number;
  readonly domainRules: number;
  /** uid 를 모르는 규칙 수 — 이만큼은 `user_key` 축 제외에 참여하지 못한다. */
  readonly emailOnlyRules: number;
};

export function summarizeInternalMatcher(
  matcher: InternalMatcher
): InternalMatcherSummary {
  return {
    hasOwner: matcher.ownerUid !== null,
    uidRules: matcher.uids.size,
    emailRules: matcher.emails.size,
    domainRules: matcher.emailDomains.size,
    emailOnlyRules: matcher.emails.size + matcher.emailDomains.size,
  };
}
