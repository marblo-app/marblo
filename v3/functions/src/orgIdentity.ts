// 조직 정체성 — 순수 로직(Firebase/BQ 무의존). analyticsPseudonym.ts / analyticsIdScheme.ts
// 와 같은 규약으로 index.ts 에서 떼어내 `node --test` 로 단위검증한다.
//
// 설계 정본: v3/docs/org-identity-model-2026-08-24.md (ticket LJf0at2EryJ4M5iBHioi)
// 선행 설계: v3/docs/enterprise-ax-client-dashboard-design-2026-08-24.md §4 (#1202)
//
// ── ★이 파일이 존재하는 이유 — 감사 원장이 되돌릴 수 없기 때문이다 ─────────────
//
// `electron/mcp-server/ledger-chain.ts` 의 `chainPayload()` 는 이벤트 **본문을 골라
// 담지 않고 통째로** 해시에 넣는다. 그 주석이 이유를 말한다: "나중에 필드가
// 추가돼도 자동으로 보호 범위에 든다."
//
// 옳은 설계지만 부작용이 하나 있다. **원장 본문에 한번 들어간 조직 귀속은 고칠 수
// 없다.** 고치면 그 행의 `hash` 가 어긋나고 `prevHash` 사슬을 타고 뒤의 모든 행이
// 깨지며, 머클 체크포인트가 봉인해 둔 사슬 머리까지 거짓이 된다.
//
// 그래서 조직 귀속은 **추측으로 붙이면 안 된다.** 이메일 도메인이 같다는 이유로
// 자동 귀속시킨 판단이 틀렸을 때, 우리에게는 되돌릴 방법이 없다. 이것이 "사람이
// 한 번 정하게 한다" 의 근거이고, UX 취향이 아니라 자료구조의 성질이다.
//
// ── ★두 가지를 가른다 — 섞으면 사고가 난다 ───────────────────────────────────
//
//   (가) 조직 **이름 제안** — 표시용 문자열의 기본값을 도메인에서 만든다.
//        틀려도 사람이 그 자리에서 고친다. 되돌릴 수 있다. → 해도 된다.
//   (나) 조직 **자동 가입** — 도메인이 같으니 그 조직의 멤버로 넣는다.
//        틀리면 남의 감사 로그와 비용을 본다. 되돌릴 수 없다. → 하지 않는다.
//
// 이 파일에서 (가)는 `suggestOrgDisplayName`, (나)는 `decideMembershipGrant` 다.
// **`decideMembershipGrant` 는 어떤 입력에도 자동 가입을 돌려주지 않는다.** 그
// 성질은 취향이 아니라 단위테스트로 고정돼 있다(orgIdentity.test.ts).
//
// ── ★공개 도메인 자동 가입이 왜 데이터 유출인가 (한국 맥락) ──────────────────
//
// gmail·naver·daum·kakao·outlook 은 한 도메인에 서로 모르는 수억 명이 있다. 도메인
// 으로 자동 가입시키면 **생판 남들이 한 조직에 묶여 서로의 감사 로그·비용을 본다.**
// 국내에서는 더 심각하다 — 소기업·프리랜서가 네이버·지메일을 업무용으로 쓴다.
// 그래서 공개 도메인은 가입 판정에 쓰지 않는 정도가 아니라 **이름 제안조차 하지
// 않는다**(제안하는 것 자체가 "우리는 도메인으로 조직을 가른다" 를 알려준다).
//
// ── ★검증 안 된 도메인으로 조직 존재를 알려주지 않는다 ───────────────────────
//
// "같은 도메인이니 이 조직입니다" 를 보여주는 것만으로 **조직의 존재가 누출된다.**
// 경쟁사가 도메인 하나만 알면 우리 고객사를 확인할 수 있다. 그래서 도메인 기반
// 합류 요청은 (1) 조직이 DNS TXT 로 도메인 소유를 증명했고 (2) 관리자가 그 창구를
// 켰을 때만 성립하며, 그 경우에도 응답은 **조직 존재와 무관하게 항상 같은 모양**
// 이다(`buildJoinRequestReceipt`).
//
// ── 지키는 것 / 포기한 것 ────────────────────────────────────────────────────
//  - 지킴: 온보딩 편의(이름 기본값 제안), 도메인 검증 후의 합류 요청 창구.
//  - 포기: "회사 메일로 가입하면 팀에 자동 합류" 라는 흔한 편의. 대신 초대와
//    관리자 승인 두 경로만 남는다. 이 손실은 의도적이다.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// ── 이메일 정규화 ────────────────────────────────────────────────────────────

/**
 * 이메일 정규화. `marketingContacts.normalizeMarketingEmail` 과 같은 규약(trim +
 * 소문자)이다. 그 모듈을 import 하지 않는 이유: 저쪽은 firebase-admin 을 끌고
 * 오므로 이 파일의 "순수 로직" 성질이 깨진다. 규약이 갈라지면 곤란한 것은
 * 도메인 판정뿐이고, 그건 아래 `emailDomainOf` 가 같은 방식으로 뽑는다.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 이메일의 도메인부. `@` 가 없거나 앞이 비면 빈 문자열. */
export function emailDomainOf(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return "";
  const domain = normalized.slice(at + 1);
  // 공백·연속 점·양끝 점은 도메인이 아니다. 애매하면 통과시키지 않는다
  // (ledger.ts `looksLikeDocId` 와 같은 태도 — 억지 판정보다 빈 값이 낫다).
  if (!/^[a-z0-9.-]+$/.test(domain)) return "";
  if (domain.startsWith(".") || domain.endsWith(".")) return "";
  if (domain.includes("..")) return "";
  if (!domain.includes(".")) return "";
  return domain;
}

// ── 도메인 분류 ──────────────────────────────────────────────────────────────

/**
 * 도메인 종류. **두 갈래가 아니라 셋이다** — 이 구분이 이 모듈의 실질이다.
 *
 * | 종류 | 뜻 | 이름 제안 | 합류 키로 사용 |
 * | --- | --- | --- | --- |
 * | `public` | 무료·일회용 메일. 한 도메인에 남남이 수억 명 | ✗ | ✗ |
 * | `multi_org` | 기관 도메인이지만 한 조직이 아님(대학 등) | ✓(사람이 고침) | ✗ |
 * | `corporate` | 그 외. 한 조직일 **가능성**이 있다 | ✓ | 검증 후에만 |
 * | `invalid` | 이메일 모양이 아님 | ✗ | ✗ |
 *
 * ★`multi_org` 를 따로 둔 이유: `snu.ac.kr` 은 무료 메일이 아니지만 수만 명이
 * 쓰고 그들은 한 팀이 아니다. 공개 도메인 목록만 막으면 이 구멍이 남는다.
 */
export type EmailDomainClass = "public" | "multi_org" | "corporate" | "invalid";

/**
 * 무료 웹메일 도메인. **국내 도메인이 목록의 앞머리**다 — 이 제품의 사용자 다수가
 * 네이버·다음·카카오 메일을 업무용으로 쓴다.
 *
 * 이 목록은 완전할 수 없다(무료 메일은 계속 생긴다). 그래서 목록은 **가입 판정의
 * 근거가 아니라 제안 억제기**다. 가입은 목록과 무관하게 어차피 초대·승인으로만
 * 된다 — 목록이 새도 데이터 유출로 이어지지 않는 구조다. ★이 성질이 이 설계에서
 * 가장 중요하다: 안전이 "빠짐없는 목록" 에 기대지 않는다.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  // 국내
  "naver.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "nate.com",
  "korea.com",
  "chol.com",
  "dreamwiz.com",
  "hanmir.com",
  "hanafos.com",
  "empas.com",
  "paran.com",
  "netian.com",
  "hotmail.co.kr",
  "yahoo.co.kr",
  // 글로벌
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.kr",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.co.jp",
  "ymail.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "foxmail.com",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
  "hushmail.com",
]);

/**
 * 일회용 메일. 무료 메일과 나누어 두는 이유는 **쓰임이 다르기 때문**이다 —
 * 이름 제안 억제는 둘 다 같지만, 가입 자체를 막을지는 다른 결정이고 그 결정은
 * 이 티켓 밖이다(결제·온보딩 흐름 변경). 자리만 갈라 둔다.
 */
export const DISPOSABLE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "sharklasers.com",
  "yopmail.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "trashmail.com",
  "getnada.com",
  "maildrop.cc",
  "dispostable.com",
]);

/**
 * 한 도메인 아래 서로 다른 조직이 사는 접미사. 접미사 매칭이라 `snu.ac.kr` 도
 * `mail.snu.ac.kr` 도 걸린다.
 *
 * ★`or.kr`(비영리)·`re.kr`(연구기관)·`go.kr`(정부)은 **일부러 뺐다.** 그쪽은
 * 도메인 하나가 대체로 기관 하나다(`moef.go.kr`). 반면 `ac.kr`/`edu` 는 학교
 * 하나에 수만 명이 있고 연구실·산단·부속기관이 서로 남이다.
 */
export const MULTI_ORG_DOMAIN_SUFFIXES: readonly string[] = [
  ".ac.kr",
  ".edu",
  ".ac.uk",
  ".ac.jp",
  ".edu.au",
  ".edu.cn",
  ".edu.sg",
  ".es.kr",
  ".ms.kr",
  ".hs.kr",
  ".sc.kr",
];

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain) || DISPOSABLE_MAIL_DOMAINS.has(domain);
}

export function isMultiOrgDomain(domain: string): boolean {
  return MULTI_ORG_DOMAIN_SUFFIXES.some(
    (suffix) => domain === suffix.slice(1) || domain.endsWith(suffix)
  );
}

export function classifyEmailDomain(domain: string): EmailDomainClass {
  if (!domain) return "invalid";
  if (isFreeMailDomain(domain)) return "public";
  if (isMultiOrgDomain(domain)) return "multi_org";
  return "corporate";
}

export function classifyEmail(email: string): EmailDomainClass {
  return classifyEmailDomain(emailDomainOf(email));
}

// ── (가) 조직 이름 제안 ──────────────────────────────────────────────────────

/**
 * 이름 제안이 없을 때의 사유 코드. 화면 문구가 아니라 **판정의 이유**다 —
 * `teamUsage.ts` 의 노트 코드(`cost_estimated_usage` 등)와 같은 규약.
 */
export type OrgNameSuggestionReason =
  | "ok"
  | "invalid_email"
  | "public_domain"
  | "punycode_domain"
  | "unusable_label";

export interface OrgNameSuggestion {
  /** 제안값. 없으면 null — 화면은 **빈칸으로 두고 사람이 채우게 한다.** */
  suggested: string | null;
  reason: OrgNameSuggestionReason;
  domain: string;
  domainClass: EmailDomainClass;
}

/**
 * 흔한 공개 접미사. 완전한 PSL 이 아니다 — 완전할 필요도 없다. 여기 없으면
 * 마지막 라벨 하나만 떼고 제안하며, **틀려도 사람이 고친다.**
 * 긴 것부터 매칭해야 `co.kr` 이 `kr` 에 먼저 먹히지 않는다.
 */
const NAME_STRIP_SUFFIXES: readonly string[] = [
  ".co.kr",
  ".ne.kr",
  ".or.kr",
  ".re.kr",
  ".pe.kr",
  ".co.uk",
  ".co.jp",
  ".com.au",
  ".com.br",
  ".com.cn",
  ".com.sg",
  ".co.nz",
];

function stripDomainSuffix(domain: string): string {
  for (const suffix of NAME_STRIP_SUFFIXES) {
    if (domain.endsWith(suffix)) return domain.slice(0, -suffix.length);
  }
  const lastDot = domain.lastIndexOf(".");
  return lastDot > 0 ? domain.slice(0, lastDot) : domain;
}

function titleCaseLabel(label: string): string {
  return label
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * ★(가) 이름 제안. **이 함수는 가입과 아무 상관이 없다.**
 *
 * `john.kim@hypemarc.com` → `"Hypemarc"`.
 * `someone@gmail.com`     → `null` (제안조차 하지 않는다).
 * `prof@snu.ac.kr`        → `"Snu"` — 쓸모없는 값이지만 **사람이 고칠 기본값**이다.
 *   multi_org 를 제안에서까지 막지 않는 이유: 제안은 되돌릴 수 있고, 빈칸보다
 *   커서가 놓인 편집 가능한 문자열이 온보딩에서 낫다. 위험한 것은 제안이 아니라
 *   이 도메인을 **합류 키로 쓰는 것**이고 그쪽은 `classifyEmailDomain` 이 막는다.
 */
export function suggestOrgDisplayName(email: string): OrgNameSuggestion {
  const domain = emailDomainOf(email);
  const domainClass = classifyEmailDomain(domain);
  const base: Omit<OrgNameSuggestion, "suggested" | "reason"> = {
    domain,
    domainClass,
  };

  if (domainClass === "invalid") {
    return { ...base, suggested: null, reason: "invalid_email" };
  }
  if (domainClass === "public") {
    // ★공개 도메인은 제안하지 않는다. "Gmail" 을 기본값으로 넣는 것은 틀린
    // 값을 넣는 것이고, 동시에 우리가 도메인으로 조직을 가른다는 사실을 알린다.
    return { ...base, suggested: null, reason: "public_domain" };
  }

  const stem = stripDomainSuffix(domain);
  const label = stem.slice(stem.lastIndexOf(".") + 1);

  if (label.startsWith("xn--")) {
    // 퓨니코드는 복호화하면 한글 상호가 나오지만, 우리 쪽 추측이 상호와 다를 때
    // 조용히 틀린다. 추측하지 않는다.
    return { ...base, suggested: null, reason: "punycode_domain" };
  }
  const suggested = titleCaseLabel(label);
  if (!suggested || suggested.length < ORG_NAME_MIN_LENGTH) {
    return { ...base, suggested: null, reason: "unusable_label" };
  }
  return { ...base, suggested, reason: "ok" };
}

// ── 표시명 검증 ──────────────────────────────────────────────────────────────

export const ORG_NAME_MIN_LENGTH = 2;
export const ORG_NAME_MAX_LENGTH = 60;

export type OrgNameRejection =
  | "empty"
  | "too_short"
  | "too_long"
  | "control_char"
  | "invisible_or_bidi";

export type OrgNameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: OrgNameRejection };

/**
 * 제로폭·양방향 제어 문자. 이름을 **거짓말하게 만드는** 문자들이다.
 * (RLO 하나면 `moc.olbram` 이 `marblo.com` 으로 보인다.)
 */
// ★리터럴이 아니라 이스케이프로 쓴다 — 이 문자들은 **소스에서도 보이지 않는다.**
// 리터럴로 두면 다음 사람이 정규식을 편집하다 조용히 지워도 아무도 못 알아챈다.
const INVISIBLE_OR_BIDI_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
// eslint-disable-next-line no-control-regex -- 제어문자를 **찾는 것**이 이 정규식의 목적이다.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/**
 * 표시명 정규화. NFKC + 연속 공백 접기 + trim.
 *
 * NFKC 를 쓰는 이유: 전각 `Ｍａｒｂｌｏ` 와 `Marblo` 가 **다른 이름으로 보이면
 * 안 된다.** 유일성을 강제하지 않기로 했으므로(아래 참조) 이건 중복 방지가 아니라
 * 사람이 눈으로 구분 못 하는 두 값이 저장되는 것을 줄이는 위생 조치다.
 */
export function normalizeOrgDisplayName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * ★표시명은 **전역 유일이 아니다.**
 *
 * 근거 셋:
 *  1. 전역 유일 namespace 는 선점(스쿼팅) 시장을 만든다. "삼성전자" 를 아무나
 *     먼저 잡는다. 우리가 얻는 것은 없고 분쟁 처리 비용만 생긴다.
 *  2. **표시명은 조직 밖으로 나가지 않는다.** 조직 이름을 보는 사람은 그 조직의
 *     멤버뿐이라 충돌해도 아무도 헷갈리지 않는다. 유일성은 값을 못 하는 곳에서
 *     비용만 물리는 제약이다.
 *  3. 식별은 이름이 아니라 **불변 `orgId`** 가 한다. 라우트도 원장도 청구도 id 로
 *     돈다. 이름이 겹쳐도 어떤 판정에도 영향이 없다.
 *
 * ★단 하나의 예외는 초대 메일이다 — 거기서는 이름이 조직 **밖**으로 나간다.
 * 그 구멍은 이름 유일성이 아니라 `INVITE_UNVERIFIED_ORG_NOTICE` 로 막는다.
 */
export function validateOrgDisplayName(raw: string): OrgNameValidation {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (CONTROL_CHAR_RE.test(raw)) return { ok: false, reason: "control_char" };
  if (INVISIBLE_OR_BIDI_RE.test(raw)) {
    return { ok: false, reason: "invisible_or_bidi" };
  }
  const value = normalizeOrgDisplayName(raw);
  if (value.length < ORG_NAME_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (value.length > ORG_NAME_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value };
}

/**
 * 초대 메일에 반드시 붙는 문구의 코드. 조직 이름이 조직 **밖으로** 나가는 유일한
 * 자리라, 도메인 미검증 조직의 이름은 "확인되지 않은 이름" 으로 표시해야 한다.
 * 그러지 않으면 아무나 조직명을 "토스" 로 짓고 초대 메일을 피싱에 쓴다.
 */
export const INVITE_UNVERIFIED_ORG_NOTICE = "org_name_unverified";

// ── 조직 식별자 ──────────────────────────────────────────────────────────────

export const PERSONAL_ORG_PREFIX = "personal_";

/**
 * ★개인 조직 id. **도메인과 무관하다** — 사장님이 정하신 기본값이다.
 *
 * uid 에서 결정적으로 파생하므로 저장 전에도 알 수 있고, 백필 없이 과거 사용자
 * 에게도 같은 값이 나온다. 회사 메일로 가입해도 개인 조직은 개인 조직이다 —
 * 도메인은 여기 개입하지 않는다. 이것이 자동 가입 부재의 실질적 기본값이다.
 */
export function personalOrgId(uid: string): string {
  return `${PERSONAL_ORG_PREFIX}${uid}`;
}

export function isPersonalOrgId(orgId: string): boolean {
  return orgId.startsWith(PERSONAL_ORG_PREFIX);
}

/**
 * 어떤 사용자의 기본 조직. **이메일을 인자로 받지 않는다** — 받을 수 있게 만들면
 * 언젠가 누가 도메인을 본다(teamAudit.ts 가 자유텍스트 필드를 null 로도 두지 않은
 * 것과 같은 이유: "자리가 있으면 언젠가 누가 채운다").
 */
export function defaultOrgIdForUser(uid: string): string {
  return personalOrgId(uid);
}

// ── (나) 멤버십 부여 — 자동 가입은 없다 ──────────────────────────────────────

/** 멤버십이 생기는 경로. **이 둘이 전부다.** */
export type MembershipGrantPath = "invitation" | "admin_approval";

export type MembershipDenialReason =
  | "no_invitation"
  | "invitation_expired"
  | "invitation_email_mismatch"
  | "email_not_verified"
  | "personal_org_not_joinable";

export type MembershipDecision =
  | { granted: true; path: MembershipGrantPath }
  | { granted: false; reason: MembershipDenialReason };

export interface MembershipGrantInput {
  /** 가입하려는 사람의 로그인 이메일. */
  email: string;
  /** Firebase Auth `email_verified`. 미검증 이메일로는 아무것도 못 한다. */
  emailVerified: boolean;
  /** 대상 조직. */
  orgId: string;
  /** 이 사람 앞으로 온 유효 초대(있으면). */
  invitation?: { invitedEmail: string; orgId: string; expiresAtMs: number };
  /** 관리자가 이미 승인했는가(관리자 승인 경로). */
  adminApproved?: boolean;
  nowMs: number;
}

/**
 * ★(나) 멤버십 판정. **`email` 의 도메인은 이 함수의 판정에 들어가지 않는다.**
 *
 * 그 사실이 이 함수의 전부다. 도메인이 같아도, 조직이 그 도메인을 검증했어도,
 * 그것만으로는 멤버가 되지 않는다. 초대장이 있거나 관리자가 승인했거나 둘 중
 * 하나다. 이 성질은 주석이 아니라 단위테스트로 고정돼 있다.
 *
 * ★개인 조직은 가입 대상이 아니다. `personal_<uid>` 는 그 한 사람의 것이고,
 * 초대장이 있어도 열리지 않는다 — 개인 조직이 팀처럼 쓰이기 시작하면 "개인은
 * personal 로 묶는다" 는 규칙이 조용히 무너진다.
 */
export function decideMembershipGrant(
  input: MembershipGrantInput
): MembershipDecision {
  if (isPersonalOrgId(input.orgId)) {
    return { granted: false, reason: "personal_org_not_joinable" };
  }
  if (!input.emailVerified) {
    return { granted: false, reason: "email_not_verified" };
  }

  const invitation = input.invitation;
  if (invitation && invitation.orgId === input.orgId) {
    if (
      normalizeEmail(invitation.invitedEmail) !== normalizeEmail(input.email)
    ) {
      return { granted: false, reason: "invitation_email_mismatch" };
    }
    if (invitation.expiresAtMs <= input.nowMs) {
      return { granted: false, reason: "invitation_expired" };
    }
    return { granted: true, path: "invitation" };
  }

  if (input.adminApproved === true) {
    return { granted: true, path: "admin_approval" };
  }
  return { granted: false, reason: "no_invitation" };
}

// ── 도메인 소유 검증 ────────────────────────────────────────────────────────

export const DOMAIN_VERIFICATION_TXT_PREFIX = "marblo-domain-verification=";

/**
 * 검증 유효기간 180일. **★도메인은 팔린다.** 인수합병·폐업으로 도메인 주인이
 * 바뀌면, 한 번 통과한 검증은 새 주인에게 옛 주인의 조직을 열어 준다. 그래서
 * 검증은 상태가 아니라 **만료되는 사실**이다.
 */
export const DOMAIN_VERIFICATION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * DNS TXT 에 넣을 검증 토큰. `(orgId, domain)` 쌍에 대한 HMAC 이다.
 *
 * 왜 HMAC 인가 — 랜덤 토큰을 발급해 저장하면 저장소가 하나 더 생기고, 그 저장소가
 * 조직↔도메인 매핑을 담게 된다. HMAC 이면 **아무것도 저장하지 않고** 언제든
 * 재계산된다. `(orgId, domain)` 이 섞이지 않게 JSON 으로 구분자를 둔다
 * (`ledger-chain.chainKey` 와 같은 이유).
 *
 * ★솔트가 없으면 null 을 돌려준다 — 원시값 폴백은 없다. `analyticsPseudonym.ts`
 * 의 fail-safe 와 같은 태도다: 조용한 열화보다 시끄러운 실패가 낫다.
 */
export function domainVerificationToken(
  orgId: string,
  domain: string,
  salt: string | undefined
): string | null {
  if (!salt) return null;
  const material = JSON.stringify([orgId, domain.trim().toLowerCase()]);
  return createHmac("sha256", salt).update(material, "utf8").digest("hex");
}

export function domainVerificationTxtRecord(
  orgId: string,
  domain: string,
  salt: string | undefined
): string | null {
  const token = domainVerificationToken(orgId, domain, salt);
  return token === null ? null : `${DOMAIN_VERIFICATION_TXT_PREFIX}${token}`;
}

function safeEqualHex(a: string, b: string): boolean {
  // 길이가 다르면 timingSafeEqual 이 던진다. 길이 자체는 비밀이 아니다.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * DNS TXT 응답들 중 우리 토큰이 있는가.
 *
 * ★공개 도메인·다중조직 도메인은 **검증 자체를 거부한다.** gmail.com 의 TXT 를
 * 우리가 넣을 수 없으니 실제로 통과할 일은 없지만, 여기서 막지 않으면 나중에
 * 누군가 "테스트용 우회" 를 만들 때 이 함수가 문을 열어 준다.
 */
export function verifyDomainOwnership(
  txtRecords: readonly string[],
  orgId: string,
  domain: string,
  salt: string | undefined
): boolean {
  const normalized = domain.trim().toLowerCase();
  const domainClass = classifyEmailDomain(normalized);
  if (domainClass !== "corporate") return false;
  const expected = domainVerificationTxtRecord(orgId, normalized, salt);
  if (expected === null) return false;
  return txtRecords.some((record) => safeEqualHex(record.trim(), expected));
}

export interface OrgDomainBindingLike {
  orgId: string;
  domain: string;
  verifiedAtMs: number | null;
  /** 관리자가 도메인 합류 요청 창구를 켰는가. 검증과 **별개의 결정**이다. */
  joinRequestsEnabled: boolean;
}

/** 검증이 살아 있는가(= 검증됐고 만료 전인가). */
export function isDomainVerificationLive(
  binding: OrgDomainBindingLike,
  nowMs: number
): boolean {
  if (binding.verifiedAtMs === null) return false;
  return nowMs - binding.verifiedAtMs < DOMAIN_VERIFICATION_TTL_MS;
}

// ── 도메인 기반 합류 요청 — 존재를 누출하지 않는다 ──────────────────────────

export type JoinRequestOutcome =
  | "submitted_to_org"
  | "discarded_no_target"
  | "rejected_public_domain"
  | "rejected_email_not_verified";

export interface JoinRequestReceipt {
  /**
   * ★사용자에게 보이는 결과. **`outcome` 과 무관하게 항상 같은 값**이다.
   * 이 필드가 조직 존재 누출을 막는 자리다 — 화면은 이 값만 읽는다.
   */
  userVisible: "request_received";
  /** 서버 내부 판정. 로그·지표용이며 **응답 본문에 실으면 안 된다.** */
  outcome: JoinRequestOutcome;
}

export interface JoinRequestInput {
  email: string;
  emailVerified: boolean;
  /** 이 도메인에 대해 우리가 아는 결합(없으면 undefined). */
  binding?: OrgDomainBindingLike;
  nowMs: number;
}

/**
 * ★도메인 합류 **요청**. 가입이 아니다 — 관리자에게 요청을 전달할 뿐이다.
 *
 * 이 함수의 핵심은 돌려주는 값이 아니라 **돌려주지 않는 값**이다:
 *  - 조직 이름을 돌려주지 않는다.
 *  - orgId 를 돌려주지 않는다.
 *  - 조직이 있는지 없는지 구분되는 응답을 돌려주지 않는다.
 *
 * 검증 없이 "같은 도메인이니 이 조직입니다" 를 보여주면, 경쟁사는 도메인 하나로
 * 우리 고객사 명단을 확인할 수 있다. 요청을 버릴 때조차 사용자에게는 접수됐다고
 * 답한다 — 이건 거짓말이 아니라 **존재 여부를 답하지 않는 것**이다.
 */
export function buildJoinRequestReceipt(
  input: JoinRequestInput
): JoinRequestReceipt {
  const receipt = (outcome: JoinRequestOutcome): JoinRequestReceipt => ({
    userVisible: "request_received",
    outcome,
  });

  const domainClass = classifyEmail(input.email);
  if (domainClass !== "corporate") {
    return receipt("rejected_public_domain");
  }
  if (!input.emailVerified) {
    return receipt("rejected_email_not_verified");
  }
  const binding = input.binding;
  if (
    !binding ||
    !binding.joinRequestsEnabled ||
    !isDomainVerificationLive(binding, input.nowMs) ||
    binding.domain !== emailDomainOf(input.email)
  ) {
    return receipt("discarded_no_target");
  }
  return receipt("submitted_to_org");
}

// ── 원장 귀속 — 이름은 절대 원장에 들어가지 않는다 ──────────────────────────

/**
 * 원장 본문에 나타나면 안 되는 키. `teamAudit.ts` 의 정규식 가드와 같은 규약 —
 * **자리가 있으면 언젠가 누가 채운다.**
 *
 * 표시명은 바뀔 수 있는 값이고 원장은 못 고치는 자료구조다. 둘을 만나게 하면
 * 회사 이름이 바뀐 뒤 옛 이름이 영구히 박제된 원장이 남는다.
 */
export const LEDGER_FORBIDDEN_ORG_KEYS: readonly string[] = [
  "orgName",
  "organizationName",
  "orgDisplayName",
  "orgSlug",
  "orgDomain",
  "organizationDomain",
  "companyName",
];

/**
 * 원장 write 페이로드에 조직 표시명·도메인이 섞였는지. 섞였으면 던진다.
 *
 * ★던지는 이유(로그가 아니라): 이 실수는 조용하고 **되돌릴 수 없다.** 한 번
 * write 되면 해시에 들어가고, 지우면 그 뒤 사슬 전체가 깨진다. 실패는 시끄러워야
 * 하고 write 전에 나야 한다.
 */
export function assertNoOrgIdentityInLedgerPayload(
  payload: Record<string, unknown>
): void {
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (LEDGER_FORBIDDEN_ORG_KEYS.includes(key)) {
        throw new Error(
          `원장 페이로드에 조직 표시명/도메인이 있습니다: ${path}${
            path ? "." : ""
          }${key} — ` +
            `원장은 불변이라 이름이 바뀌어도 못 고칩니다. orgId 만 남기고 표시명은 조회 시 해석하세요.`
        );
      }
      walk(child, `${path}${path ? "." : ""}${key}`, depth + 1);
    }
  };
  walk(payload, "", 0);
}

/**
 * 프로젝트↔조직 결합 한 줄. **추가 전용(append-only)이며 원장 밖에 있다.**
 *
 * ★왜 원장 안이 아니라 밖인가 — 이 티켓의 결론이 여기 있다.
 * 원장 본문에 `orgId` 를 박으면 잘못 붙은 귀속을 영원히 못 고친다(해시 체인).
 * 반대로 결합을 원장 밖 추가 전용 표에 두면:
 *  - 잘못 붙었을 때 **정정 행을 덧붙여** 고칠 수 있고,
 *  - 그 정정이 지워지지 않고 **보이므로** 감사 성질도 유지되며,
 *  - 원장 행은 오늘처럼 `projectId` 만 들고 있으면 되어 체인을 건드리지 않는다.
 *
 * 근거 패턴은 이미 이 프로젝트 안에 있다 — `analyticsPseudonym.ts`:
 * *"소급은 저장이 아니라 조회로 한다. 링크는 별도 표에만 있다."*
 */
export interface OrgProjectBindingLike {
  projectId: string;
  orgId: string;
  /** 이 결합이 유효해지는 시각. 과거를 정정할 때는 과거 시각을 준다. */
  effectiveFromMs: number;
  /** 이 행이 기록된 시각. 정정이 **언제 이루어졌는지**가 감사 대상이다. */
  recordedAtMs: number;
}

/**
 * 어떤 시점에 이 프로젝트가 어느 조직 것이었나. 원장 행을 조직으로 접을 때 쓴다.
 *
 * 같은 `effectiveFromMs` 가 둘이면 **나중에 기록된 행(정정)이 이긴다.**
 */
export function resolveOrgIdAt(
  bindings: readonly OrgProjectBindingLike[],
  projectId: string,
  atMs: number
): string | null {
  const applicable = bindings
    .filter((b) => b.projectId === projectId && b.effectiveFromMs <= atMs)
    .sort(
      (a, b) =>
        a.effectiveFromMs - b.effectiveFromMs || a.recordedAtMs - b.recordedAtMs
    );
  const last = applicable[applicable.length - 1];
  return last ? last.orgId : null;
}

/** 조직 표시명 변경 이력 한 줄. 이름 변경을 **허용하기 위한** 자료구조다. */
export interface OrgNameHistoryEntryLike {
  orgId: string;
  displayName: string;
  effectiveFromMs: number;
  recordedAtMs: number;
}

/**
 * 어떤 시점의 표시명. 6월의 감사 반출물에는 6월의 이름이 찍혀야 한다.
 *
 * ★이름 변경을 허용해도 되는 이유가 이 함수다. 원장에는 `orgId` 만(정확히는
 * `projectId` 만) 있고 이름은 조회 시 해석되므로, 이름은 몇 번이든 바뀔 수 있고
 * 과거 기록의 표기는 그대로 재현된다. 변경 사실 자체는 이 표에 남아 감사된다.
 */
export function resolveOrgDisplayNameAt(
  history: readonly OrgNameHistoryEntryLike[],
  orgId: string,
  atMs: number
): string | null {
  const applicable = history
    .filter((h) => h.orgId === orgId && h.effectiveFromMs <= atMs)
    .sort(
      (a, b) =>
        a.effectiveFromMs - b.effectiveFromMs || a.recordedAtMs - b.recordedAtMs
    );
  const last = applicable[applicable.length - 1];
  return last ? last.displayName : null;
}

// ── 팀 요금제 온보딩 입력 검증 ───────────────────────────────────────────────

export type TeamOrgIntakeRejection =
  | OrgNameRejection
  | "name_required_for_team_plan";

export type TeamOrgIntake =
  | { ok: true; displayName: string; orgId: string }
  | { ok: false; reason: TeamOrgIntakeRejection };

export interface TeamOrgIntakeInput {
  /** 사람이 입력한 조직명. 제안값을 그대로 둔 것도 사람의 확인으로 친다. */
  displayName: string | null | undefined;
  /** 새 조직 id — 호출부가 만든다(Firestore 자동 id 등). 불변이다. */
  orgId: string;
}

/**
 * ★팀 요금제는 조직명을 **필수로 받는다.** 도메인에서 유추해 조용히 채우지 않는다.
 *
 * 근거: 이 값이 정해지는 순간부터 그 조직의 원장이 쌓이기 시작하고, 원장은
 * 고칠 수 없다. 사람이 한 번 보고 넘어가는 비용(입력칸 하나)이, 잘못 붙은 귀속을
 * 영원히 안고 가는 비용보다 압도적으로 싸다.
 *
 * ★이 함수는 검증만 한다. **결제·온보딩 화면을 바꾸는 것은 이 티켓 밖**이다
 * (사용자 노출 흐름 변경은 제안까지). 배선은 후속 티켓이 받는다.
 */
export function validateTeamOrgIntake(
  input: TeamOrgIntakeInput
): TeamOrgIntake {
  if (input.displayName == null || input.displayName.trim().length === 0) {
    return { ok: false, reason: "name_required_for_team_plan" };
  }
  const validation = validateOrgDisplayName(input.displayName);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  return { ok: true, displayName: validation.value, orgId: input.orgId };
}

// ── 환경변수 ─────────────────────────────────────────────────────────────────

/**
 * 도메인 검증 솔트. **값을 로그에 찍지 않는다** — 존재 여부만 다룬다.
 * 없으면 도메인 검증 경로 전체가 실패한다(fail-safe).
 */
export function resolveDomainVerifySalt(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const salt = env.ORG_DOMAIN_VERIFY_SALT;
  return salt && salt.length > 0 ? salt : undefined;
}

/** 진단용. 솔트 자체가 아니라 **설정됐다는 사실**만 드러낸다. */
export function domainVerifySaltFingerprint(
  salt: string | undefined
): string | null {
  if (!salt) return null;
  return createHash("sha256").update(salt, "utf8").digest("hex").slice(0, 8);
}
