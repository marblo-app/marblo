// 3.0.19 제품 업데이트 공지 메일 — 순수 로직 모듈(대상 선정 + 본문 렌더).
//
// #681 releaseAnnouncement.ts 를 클론·변형한 서비스/정보성 변종이다.
// marketingContacts.ts / redact.ts 와 동일 규약: firebase 의존성 없는 순수
// 함수만 둔다 — 컴파일 후 `node --test` 로 바로 검증 가능(devDep 추가 없음).
// Firestore/Auth/Resend 를 만지는 IO 는 전부
// scripts/send-release-update-announcement.ts 가 담당한다.
//
// ★releaseAnnouncement(#681, 마케팅) 과의 핵심 차이 — 절대 혼동 금지:
//  - 이건 광고가 아니라 제품 업데이트 공지(거래관계/서비스 기반 메시지)다.
//    그래서 marketing_contacts.isEmailable(마케팅 수신동의 게이트)를 적용하지
//    않는다 — beta_active 전체가 원칙적 대상이다.
//  - 대신 하드 옵트아웃(marketing_contacts.unsubscribe.status==="unsubscribed")
//    과 무효 주소(이메일 형식 불량)만 제외한다. 이 저장소엔 별도 하드바운스
//    트래킹(Resend 웹훅 등)이 아직 없어, 현재 판정 가능한 신호로 최대한
//    보수적으로 대체했다 — 훗날 바운스 웹훅이 생기면 그 결과를 unsubscribed
//    와 동급으로 이 게이트에 흘려보내면 된다.
//  - 쿨다운/멱등 키도 별개다: founders/{doc}.releaseUpdate_3_0_19_SentAt
//    (마케팅의 releaseAnnouncement_3_0_19_SentAt 과는 다른 필드).
//  - 발송 안전 규약은 동일: 대상 목록만 여기서 만들고, 실제 발송 여부는
//    호출부의 명시적 --send + confirm 플래그가 결정한다.

/** 이 공지가 대상으로 삼는 앱 버전. 필드명·확인문구의 단일소스. */
export const RELEASE_UPDATE_VERSION = "3.0.19";

/** founders 문서에 찍는 발송 스탬프 필드(쿨다운·멱등의 근거). 마케팅 키와 별개. */
export const RELEASE_UPDATE_SENT_AT_FIELD = "releaseUpdate_3_0_19_SentAt";

/** 발송 여부 boolean 스탬프(대시보드·수동 조회용). */
export const RELEASE_UPDATE_SENT_FIELD = "releaseUpdate_3_0_19_Sent";

/** 실발송 2차 게이트 확인 문구. 마케팅 공지(SEND-RELEASE-3-0-19)와 다른 토큰. */
export const RELEASE_UPDATE_CONFIRM = "SEND-UPDATE-3-0-19";

/** 기본 쿨다운(일). 같은 버전 공지는 사실상 1회성이라 넉넉히 잡는다. */
export const RELEASE_UPDATE_COOLDOWN_DAYS = 365;

// ─── 대상 판정: beta_active(hasActiveFounderGrant) ────────────────────

/** subscriptions/{uid} 에서 판정에 필요한 필드만 추린 스냅샷. */
export interface ReleaseSubscriptionSnapshot {
  status: string | null;
  paymentProvider: string | null;
  currentPeriodEndMs: number | null;
}

/**
 * 파운더 그랜트 판정 결과.
 *  - beta_active    — 발송 대상. index.ts 의 hasActiveFounderGrant 와 동일 조건
 *                     (status==="active" && paymentProvider==="founder_grant")
 *                     + classifyFounderActivation 의 만료 체크를 교집합으로 적용.
 *  - grant_expired  — 그랜트지만 currentPeriodEnd 가 과거(상태만 active 로 남음).
 *                     기본 제외. dry-run 이 카운트로 보여줘 판단 근거를 남긴다.
 *  - no_active_grant— 그랜트 자체가 아니거나 active 가 아님(유료 구독자 포함).
 */
export type GrantVerdict = "beta_active" | "grant_expired" | "no_active_grant";

export function classifyFounderGrant(
  sub: ReleaseSubscriptionSnapshot | null,
  nowMs: number,
): GrantVerdict {
  if (!sub) return "no_active_grant";
  if (sub.paymentProvider !== "founder_grant") return "no_active_grant";
  if (sub.status !== "active") return "no_active_grant";
  if (sub.currentPeriodEndMs != null && sub.currentPeriodEndMs <= nowMs) {
    return "grant_expired";
  }
  return "beta_active";
}

// ─── 하드 옵트아웃/무효주소 게이트(마케팅 동의 게이트 대체) ────────────

export type ServiceMailGateReason = "ok" | "unsubscribed" | "invalid_email";

export interface ServiceMailGateVerdict {
  ok: boolean;
  reason: ServiceMailGateReason;
}

export interface ServiceMailGateInput {
  /** 정규화(소문자·trim)된 이메일. */
  email: string;
  /** marketing_contacts/{contactId}.unsubscribe.status === "unsubscribed" (전체 수신거부). */
  unsubscribed: boolean;
}

/**
 * 서비스/정보성 메일 발송 게이트 — 마케팅 동의(isEmailable)와 달리 기본이
 * "허용"이다. 딱 두 가지만 제외한다: 형식이 무효인 주소, 하드 옵트아웃.
 * ★동의 없음(marketing consent unknown/pending)은 여기서 걸리지 않는다 —
 *   이건 광고가 아니므로 걸러선 안 된다.
 */
export function serviceMailGate(
  input: ServiceMailGateInput,
): ServiceMailGateVerdict {
  const email = input.email.trim();
  if (
    !email ||
    !email.includes("@") ||
    email.startsWith("@") ||
    email.endsWith("@")
  ) {
    return { ok: false, reason: "invalid_email" };
  }
  if (input.unsubscribed) {
    return { ok: false, reason: "unsubscribed" };
  }
  return { ok: true, reason: "ok" };
}

// ─── 대상 선정 ────────────────────────────────────────────────────────

/** 후보 1인(= founders 문서 1건) 의 판정 입력. 이메일 원문은 로그 금지. */
export interface ReleaseUpdateAudienceCandidate {
  /** founders 컬렉션의 실제 doc id — 쿨다운 스탬프는 반드시 이 경로에 쓴다. */
  docId: string;
  /** 정규화(소문자·trim)된 이메일. 그룹핑 키. */
  email: string;
  /** 선정자인가(status!=="rejected" && accessGrantedAt 존재). */
  selected: boolean;
  /** 파운더 그랜트 판정. */
  grant: GrantVerdict;
  /** serviceMailGate 통과 여부(하드 옵트아웃/무효주소 아님). */
  gateOk: boolean;
  /** 게이트 사유(ok/unsubscribed/invalid_email/gate_error). */
  gateReason: string;
  /** 이 버전 공지의 마지막 발송 시각(ms). 미발송이면 null. */
  lastSentAtMs: number | null;
}

/** 그룹핑(동일 이메일 다중 founders 문서) 후의 발송 단위. */
export interface ReleaseUpdateAudienceTarget {
  email: string;
  /** 같은 이메일을 가리키는 모든 founders doc id — 발송 성공 시 전부 스탬프. */
  docIds: string[];
  gateReason: string;
}

export interface ReleaseUpdateAudienceOptions {
  nowMs: number;
  cooldownMs: number;
  /** 배치 상한(안전장치). 미지정이면 무제한. */
  limit?: number;
}

export interface ReleaseUpdateAudienceResult {
  /** 실제 발송 대상. */
  eligible: ReleaseUpdateAudienceTarget[];
  /** limit 때문에 이번 배치에서 잘린 수(대상이긴 함). */
  overLimit: number;
  skipped: {
    notSelected: number;
    grantExpired: number;
    noActiveGrant: number;
    /** 하드 옵트아웃/무효주소/게이트 조회 실패로 제외된 수(마케팅 동의 없음과는 무관). */
    gateBlocked: number;
    cooldown: number;
  };
  /** 동일 이메일 중복 founders 문서 수(발송은 1통으로 합쳐진다). */
  duplicateDocs: number;
  /** 제외 사유 분포(게이트 사유별 카운트) — 진단용. */
  gateReasonCounts: Record<string, number>;
}

const GRANT_RANK: Record<GrantVerdict, number> = {
  beta_active: 2,
  grant_expired: 1,
  no_active_grant: 0,
};

/**
 * beta_active ∩ 게이트통과(하드옵트아웃·무효주소 아님) ∩ 미발송 교집합을 뽑는다.
 *
 * 필터 순서: 선정 → 그랜트 → 게이트 → 쿨다운. 순서가 곧 skip 카운터의 의미라
 * 앞 단계에서 걸린 사람은 뒤 단계 카운터에 잡히지 않는다(중복 집계 방지).
 *
 * 같은 이메일의 founders 문서가 여러 건이면 하나로 합친다:
 *  - grant/gate 는 더 유리한 쪽(둘 다 같은 사람이므로 동일해야 정상)
 *  - lastSentAt 은 **가장 최근** 값 — 어느 문서든 발송 흔적이 있으면 재발송 금지
 */
export function selectReleaseUpdateAudience(
  candidates: ReleaseUpdateAudienceCandidate[],
  opts: ReleaseUpdateAudienceOptions,
): ReleaseUpdateAudienceResult {
  const { nowMs, cooldownMs } = opts;
  const limit =
    typeof opts.limit === "number" && opts.limit > 0
      ? Math.floor(opts.limit)
      : Infinity;

  // ── 동일 이메일 병합 ──
  const merged = new Map<
    string,
    ReleaseUpdateAudienceCandidate & { docIds: string[] }
  >();
  let duplicateDocs = 0;
  for (const c of candidates) {
    const prev = merged.get(c.email);
    if (!prev) {
      merged.set(c.email, { ...c, docIds: [c.docId] });
      continue;
    }
    duplicateDocs++;
    prev.docIds.push(c.docId);
    prev.selected = prev.selected || c.selected;
    if (GRANT_RANK[c.grant] > GRANT_RANK[prev.grant]) prev.grant = c.grant;
    if (c.gateOk && !prev.gateOk) {
      prev.gateOk = true;
      prev.gateReason = c.gateReason;
    }
    // 발송 흔적은 가장 최근 값을 유지(재발송 방지 쪽으로 보수적).
    if (
      c.lastSentAtMs != null &&
      (prev.lastSentAtMs == null || c.lastSentAtMs > prev.lastSentAtMs)
    ) {
      prev.lastSentAtMs = c.lastSentAtMs;
    }
  }

  const skipped = {
    notSelected: 0,
    grantExpired: 0,
    noActiveGrant: 0,
    gateBlocked: 0,
    cooldown: 0,
  };
  const gateReasonCounts: Record<string, number> = {};
  const eligible: ReleaseUpdateAudienceTarget[] = [];

  for (const c of merged.values()) {
    if (!c.selected) {
      skipped.notSelected++;
      continue;
    }
    if (c.grant === "grant_expired") {
      skipped.grantExpired++;
      continue;
    }
    if (c.grant !== "beta_active") {
      skipped.noActiveGrant++;
      continue;
    }
    // 하드옵트아웃/무효주소 게이트 — 마케팅 동의와 무관하게 이 둘만 본다.
    gateReasonCounts[c.gateReason] = (gateReasonCounts[c.gateReason] || 0) + 1;
    if (!c.gateOk) {
      skipped.gateBlocked++;
      continue;
    }
    if (c.lastSentAtMs != null && nowMs - c.lastSentAtMs < cooldownMs) {
      skipped.cooldown++;
      continue;
    }
    eligible.push({
      email: c.email,
      docIds: [...c.docIds],
      gateReason: c.gateReason,
    });
  }

  const overLimit = eligible.length > limit ? eligible.length - limit : 0;
  return {
    eligible: overLimit > 0 ? eligible.slice(0, limit) : eligible,
    overLimit,
    skipped,
    duplicateDocs,
    gateReasonCounts,
  };
}

/**
 * 이메일 도메인 분포(집계) — 개인식별 방지: count<2 도메인은 (other)로 묶는다.
 * releaseAnnouncement.ts 의 domainDistribution 과 동일 규약(자립 모듈이라 재구현).
 */
export function domainDistribution(emails: string[]): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const e of emails) {
    const dom = e.includes("@") ? e.split("@").pop() || "(none)" : "(none)";
    raw[dom] = (raw[dom] || 0) + 1;
  }
  const out: Record<string, number> = {};
  let other = 0;
  for (const [dom, n] of Object.entries(raw)) {
    if (n < 2) other += n;
    else out[dom] = n;
  }
  if (other > 0) out["(other)"] = other;
  return out;
}

// ─── 본문(확정본 — 임의 변경 금지, 프로모션 문구 절대 추가 금지) ───────

export interface ReleaseEmailContent {
  subject: string;
  html: string;
  text: string;
}

export const RELEASE_UPDATE_SUBJECT =
  "마블로 3.0.19 업데이트 안내 — 멀티모델 오케부터 퀵레인까지";

const DOWNLOAD_URL = "https://marblo.app/download";
const SUPPORT_EMAIL = "team@marblo.app";

const GREETING = "안녕하세요, 마블로 베타테스터님";

const INTRO =
  "베타 테스트에 참여해 주셔서 감사합니다. 마블로 3.0.19 업데이트 소식을 전해드립니다.";

/** 이번 버전 변경점(확정본). */
const WHATS_NEW: string[] = [
  "🤖 오케스트레이터를 Claude뿐 아니라 Codex·Grok으로도 운영할 수 있습니다.",
  "🔗 에이전트 연결 확장 — Claude·Codex에 더해 Grok·MiniMax·Kimi 등 다양한 모델.",
  "🎯 난이도 기반 자동 모델 선택 — 작업 난이도에 따라 알맞은 모델을 자동으로 골라 스폰합니다.",
  "🗂️ 완료 이력·워크트리 작업을 바뀐 UX에서 한눈에 조망.",
  "⚡ 퀵레인(Quick Lanes) — 오케스트레이터와 별개로 빠른 병렬작업을 입력하고 모델을 골라 즉시 실행.",
];

const HOW_TO_UPDATE = `최신 버전 다운로드 → ${DOWNLOAD_URL} (이미 설치돼 있으면 자동 업데이트됩니다)`;

const FEEDBACK_ASK =
  "사용해 보시고 의견이 있으시면 이 메일에 답장으로 편하게 알려주세요. 여러분의 피드백이 마블로를 더 좋게 만듭니다.";

const OPT_OUT_NOTICE =
  "(본 메일은 베타 테스트 참여자께 제품 업데이트를 안내드리는 정보성 메일입니다. 더 이상 받지 않으시려면 team@marblo.app 으로 알려주세요.)";

/**
 * 3.0.19 제품 업데이트 공지 메일 렌더. 외부 CSS/이미지/폰트 없이 인라인
 * 스타일만 쓴다(메일 클라이언트 호환 + 원격 리소스로 인한 열람 추적 회피).
 * ★구독 가입·Pro 연장·요금제 등 프로모션 문구는 절대 넣지 않는다.
 */
export function buildReleaseUpdateEmail(): ReleaseEmailContent {
  const li = (items: string[]) =>
    items
      .map((t) => `<li style="margin:0 0 8px">${escapeHtml(t)}</li>`)
      .join("");

  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f6f7f9">
  <div style="max-width:600px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2328;background:#ffffff">
    <p style="margin:0 0 16px">${escapeHtml(GREETING)}</p>
    <p style="margin:0 0 24px">${escapeHtml(INTRO)}</p>

    <h2 style="font-size:16px;margin:24px 0 8px">[이번 버전에서 달라진 점]</h2>
    <ul style="margin:0;padding-left:20px">${li(WHATS_NEW)}</ul>

    <h2 style="font-size:16px;margin:24px 0 8px">[업데이트 방법]</h2>
    <p style="margin:0 0 24px">${linkifyDownload(escapeHtml(HOW_TO_UPDATE))}</p>

    <p style="margin:0 0 24px">${escapeHtml(FEEDBACK_ASK)}</p>

    <p style="margin:0 0 16px">감사합니다.<br/>마블로 팀 드림<br/><a href="mailto:${SUPPORT_EMAIL}" style="color:#1f6feb">${SUPPORT_EMAIL}</a></p>

    <p style="font-size:12px;color:#999;margin:24px 0 0">${escapeHtml(
      OPT_OUT_NOTICE,
    ).replace(
      SUPPORT_EMAIL,
      `<a href="mailto:${SUPPORT_EMAIL}" style="color:#999">${SUPPORT_EMAIL}</a>`,
    )}</p>
  </div></body></html>`;

  const text = [
    GREETING,
    "",
    INTRO,
    "",
    "[이번 버전에서 달라진 점]",
    ...WHATS_NEW.map((t) => `- ${t}`),
    "",
    "[업데이트 방법]",
    HOW_TO_UPDATE,
    "",
    FEEDBACK_ASK,
    "",
    "감사합니다.",
    "마블로 팀 드림",
    SUPPORT_EMAIL,
    "",
    OPT_OUT_NOTICE,
  ].join("\n");

  return { subject: RELEASE_UPDATE_SUBJECT, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 본문에 그대로 노출되는 다운로드 URL 만 앵커로 감싼다(문구는 그대로). */
function linkifyDownload(escaped: string): string {
  return escaped.replace(
    DOWNLOAD_URL,
    `<a href="${DOWNLOAD_URL}" style="color:#1f6feb">${DOWNLOAD_URL}</a>`,
  );
}
