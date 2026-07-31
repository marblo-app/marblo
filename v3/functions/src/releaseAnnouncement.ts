// 3.0.19 릴리스 공지 메일 — 순수 로직 모듈(대상 선정 + 본문 렌더).
//
// marketingContacts.ts / redact.ts 와 동일 규약: firebase 의존성 없는 순수
// 함수만 둔다 — 컴파일 후 `node --test` 로 바로 검증 가능(devDep 추가 없음).
// Firestore/Auth/Resend 를 만지는 IO 는 전부
// scripts/send-release-announcement.ts 가 담당한다.
//
// 발송 안전 규약(sendFounderFollowupEmails 와 동일):
//  - 동의 게이트(marketing_contacts.isEmailable)를 통과한 주소만 대상.
//    컨택트 없음/동의 없음/수신거부는 전부 제외 — 오발송보다 미발송이 낫다.
//  - founders/{doc}.releaseAnnouncement_3_0_19_SentAt 쿨다운으로 재발송 차단.
//  - 여기서 만드는 건 "대상 목록"뿐이고, 실제 발송 여부는 호출부의 명시적
//    --send + confirm 플래그가 결정한다.

/** 이 공지가 대상으로 삼는 앱 버전. 필드명·확인문구의 단일소스. */
export const RELEASE_ANNOUNCEMENT_VERSION = "3.0.19";

/** founders 문서에 찍는 발송 스탬프 필드(쿨다운·멱등의 근거). */
export const RELEASE_ANNOUNCEMENT_SENT_AT_FIELD =
  "releaseAnnouncement_3_0_19_SentAt";

/** 발송 여부 boolean 스탬프(대시보드·수동 조회용). */
export const RELEASE_ANNOUNCEMENT_SENT_FIELD =
  "releaseAnnouncement_3_0_19_Sent";

/** 실발송 2차 게이트 확인 문구. --send 만으로는 부족하다. */
export const RELEASE_ANNOUNCEMENT_CONFIRM = "SEND-RELEASE-3-0-19";

/** 기본 쿨다운(일). 같은 버전 공지는 사실상 1회성이라 넉넉히 잡는다. */
export const RELEASE_ANNOUNCEMENT_COOLDOWN_DAYS = 365;

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

// ─── 대상 선정 ────────────────────────────────────────────────────────

/** 후보 1인(= founders 문서 1건) 의 판정 입력. 이메일 원문은 로그 금지. */
export interface ReleaseAudienceCandidate {
  /** founders 컬렉션의 실제 doc id — 쿨다운 스탬프는 반드시 이 경로에 쓴다. */
  docId: string;
  /** 정규화(소문자·trim)된 이메일. 그룹핑 키. */
  email: string;
  /** 선정자인가(status!=="rejected" && accessGrantedAt 존재). */
  selected: boolean;
  /** 파운더 그랜트 판정. */
  grant: GrantVerdict;
  /** marketing_contacts 동의 게이트 통과 여부(isEmailable). */
  gateOk: boolean;
  /** 게이트 사유(no_contact/consent_not_granted/unsubscribed/ok/gate_error). */
  gateReason: string;
  /** 이 버전 공지의 마지막 발송 시각(ms). 미발송이면 null. */
  lastSentAtMs: number | null;
}

/** 그룹핑(동일 이메일 다중 founders 문서) 후의 발송 단위. */
export interface ReleaseAudienceTarget {
  email: string;
  /** 같은 이메일을 가리키는 모든 founders doc id — 발송 성공 시 전부 스탬프. */
  docIds: string[];
  gateReason: string;
}

export interface ReleaseAudienceOptions {
  nowMs: number;
  cooldownMs: number;
  /** 배치 상한(안전장치). 미지정이면 무제한. */
  limit?: number;
}

export interface ReleaseAudienceResult {
  /** 실제 발송 대상. */
  eligible: ReleaseAudienceTarget[];
  /** limit 때문에 이번 배치에서 잘린 수(대상이긴 함). */
  overLimit: number;
  skipped: {
    notSelected: number;
    grantExpired: number;
    noActiveGrant: number;
    noConsent: number;
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
 * beta_active ∩ 동의 ∩ 미발송 교집합을 뽑는다.
 *
 * 필터 순서: 선정 → 그랜트 → 동의 → 쿨다운. 순서가 곧 skip 카운터의 의미라
 * 앞 단계에서 걸린 사람은 뒤 단계 카운터에 잡히지 않는다(중복 집계 방지).
 *
 * 같은 이메일의 founders 문서가 여러 건이면 하나로 합친다:
 *  - grant/gate 는 더 유리한 쪽(둘 다 같은 사람이므로 동일해야 정상)
 *  - lastSentAt 은 **가장 최근** 값 — 어느 문서든 발송 흔적이 있으면 재발송 금지
 */
export function selectReleaseAudience(
  candidates: ReleaseAudienceCandidate[],
  opts: ReleaseAudienceOptions,
): ReleaseAudienceResult {
  const { nowMs, cooldownMs } = opts;
  const limit =
    typeof opts.limit === "number" && opts.limit > 0
      ? Math.floor(opts.limit)
      : Infinity;

  // ── 동일 이메일 병합 ──
  const merged = new Map<
    string,
    ReleaseAudienceCandidate & { docIds: string[] }
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
    noConsent: 0,
    cooldown: 0,
  };
  const gateReasonCounts: Record<string, number> = {};
  const eligible: ReleaseAudienceTarget[] = [];

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
    // 동의 게이트 — 절대 우회 없음.
    gateReasonCounts[c.gateReason] = (gateReasonCounts[c.gateReason] || 0) + 1;
    if (!c.gateOk) {
      skipped.noConsent++;
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
 * index.ts 의 domainDistribution 과 동일 규약(그쪽은 private 이라 여기 재구현).
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

// ─── 본문(확정본 — 임의 변경 금지) ────────────────────────────────────

export interface ReleaseEmailContent {
  subject: string;
  html: string;
  text: string;
}

export const RELEASE_ANNOUNCEMENT_SUBJECT =
  "마블로 3.0.19 — 오케부터 에이전트까지, 이제 원하는 모델로 자유롭게 🚀";

const DOWNLOAD_URL = "https://marblo.app/download";
const SUPPORT_EMAIL = "team@marblo.app";

/** 이번 버전 변경점(확정본). */
const WHATS_NEW: string[] = [
  "🧭 '시작하기' 탭 — 앱을 켜면 무엇부터 하면 되는지 한눈에. CLI 계정 연결부터 첫 실행까지 단계별 안내.",
  "🤖 오케스트레이터를 Claude뿐 아니라 Codex·Grok으로도 운영.",
  "🔗 에이전트 연결 확장 — Claude·Codex에 더해 Grok·MiniMax·Kimi 등 다양한 모델.",
  "🎯 난이도 기반 자동 모델 선택 — 쉬운 일엔 가벼운 모델, 어려운 일엔 강한 모델.",
  "🗂️ 완료 이력·워크트리 작업을 한눈에.",
  "⚡ 퀵레인(Quick Lanes) — 오케와 별개로 빠른 병렬작업을 입력하고 모델을 골라 즉시 실행.",
];

/** 시작하는 법(확정본). 1번 항목만 링크가 들어간다. */
const HOW_TO_START: string[] = [
  `최신 버전 다운로드 → ${DOWNLOAD_URL} (이미 설치돼 있으면 자동 업데이트)`,
  "앱 실행 후 '시작하기' 탭을 따라 내 모델 연결",
  "구독 가입 후, 오케스트레이터나 퀵레인으로 실제 작업 한 건 돌려보기",
  "소감을 이 메일 답장으로 보내주시면 → Pro 3개월 연장 🎉",
];

const INTRO =
  "초기부터 마블로를 함께 써주고 계셔서 진심으로 감사드립니다. 여러분의 피드백을 담아 3.0.19 버전을 새로 내놓았고, 이번엔 특히 어떤 모델로든 자유롭게 일할 수 있게 크게 넓혔습니다.";

const ASK_BODY =
  "마블로는 BYOM(Bring Your Own Model) 구독 모델입니다. 쓰시던 모델을 그대로 연결하고, 오케스트레이션·협업 기능은 구독으로 이용하세요. 가장 저렴한 요금제라도 좋으니 꼭 구독에 가입하셔서 직접 한번 써봐 주세요.";

const REWARD_BODY =
  "사용해 보신 뒤 이 메일에 그대로 답장으로 소감을 보내주시면, 감사의 뜻으로 Pro 플랜 3개월을 연장해 드립니다.";

/**
 * 3.0.19 공지 메일 렌더. 외부 CSS/이미지/폰트 없이 인라인 스타일만 쓴다
 * (메일 클라이언트 호환 + 원격 리소스로 인한 열람 추적 회피).
 */
export function buildReleaseAnnouncementEmail(): ReleaseEmailContent {
  const li = (items: string[]) =>
    items
      .map(
        (t) =>
          `<li style="margin:0 0 8px">${linkifyDownload(escapeHtml(t))}</li>`,
      )
      .join("");

  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f6f7f9">
  <div style="max-width:600px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2328;background:#ffffff">
    <p style="margin:0 0 16px">안녕하세요, 마블로 베타테스터님</p>
    <p style="margin:0 0 24px">${escapeHtml(INTRO)}</p>

    <h2 style="font-size:16px;margin:24px 0 8px">[이번 버전에서 달라진 점]</h2>
    <ul style="margin:0;padding-left:20px">${li(WHATS_NEW)}</ul>

    <h2 style="font-size:16px;margin:24px 0 8px">[한 가지 부탁드려요 🙏]</h2>
    <p style="margin:0 0 16px">${escapeHtml(ASK_BODY)}</p>

    <h2 style="font-size:16px;margin:24px 0 8px">[🎁 소감을 답장으로 보내주시면, Pro 3개월 연장]</h2>
    <p style="margin:0 0 16px">${escapeHtml(REWARD_BODY)}</p>

    <h2 style="font-size:16px;margin:24px 0 8px">[시작하는 법]</h2>
    <ol style="margin:0;padding-left:20px">${li(HOW_TO_START)}</ol>

    <p style="margin:24px 0 0">감사합니다.<br/>마블로 팀 드림<br/><a href="mailto:${SUPPORT_EMAIL}" style="color:#1f6feb">${SUPPORT_EMAIL}</a></p>
  </div></body></html>`;

  const text = [
    "안녕하세요, 마블로 베타테스터님",
    "",
    INTRO,
    "",
    "[이번 버전에서 달라진 점]",
    ...WHATS_NEW.map((t) => `- ${t}`),
    "",
    "[한 가지 부탁드려요 🙏]",
    ASK_BODY,
    "",
    "[🎁 소감을 답장으로 보내주시면, Pro 3개월 연장]",
    REWARD_BODY,
    "",
    "[시작하는 법]",
    ...HOW_TO_START.map((t, i) => `${i + 1}. ${t}`),
    "",
    "감사합니다.",
    "마블로 팀 드림",
    SUPPORT_EMAIL,
  ].join("\n");

  return { subject: RELEASE_ANNOUNCEMENT_SUBJECT, html, text };
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
