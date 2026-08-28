// 비서 메일 발송(Resend 경로) — 순수 로직. Firestore/네트워크/firebase-admin 무의존.
// 티켓 QiqTTRP9hzsV7v1M8XUS (설계문서 v3/docs/GOOGLE_SCOPE_ZERO_DESIGN.md §3.3 · §9 T5a).
//
// ── 이 모듈이 존재하는 이유 ────────────────────────────────────────────────
// `gmail.send` 를 회수하면 비서가 메일을 못 보낸다. Resend 는 이미 배선돼 있지만
// (`postResendEmail` in index.ts) 지금 있는 것은 **관리자용 서버 발송**이다 —
// 대상도 문면도 우리가 정한다. 에이전트가 부르는 순간 성질이 완전히 달라진다:
// **수신자를 LLM 이 정한다.** 임의 주소로 무제한 발송이 가능하면 우리 도메인은
// 그날로 스팸 중계기가 되고, 도메인 평판이 죽으면 결제·가입 메일까지 같이 죽는다.
//
// 그래서 이 파일의 본체는 "메일을 만드는 법"이 아니라 **"누구에게 보낼 수 있는가"**
// 다. 판정을 순수 함수로 내려 `node --test` 로 잠근다 — 콜러블 배선이 바뀌어도
// 수신자 정책은 테스트가 지킨다. `rateLimitCore.ts` ↔ `rateLimit.ts` 와 같은 분할이다.
//
// ── 발송은 여기서 하지 않는다 ──────────────────────────────────────────────
// fetch 도 Firestore 도 없다. 실제 발송은 index.ts 의 `sendAssistantEmail`
// 콜러블이 기존 `postResendEmail` 로 한다 — **새 Resend 클라이언트를 만들지 않는다.**
//
// 실행:
//   package.json: npm run test:assistant-email

import type { RateRule } from "./rateLimitCore";

// ── 발신 주소 — 숨기지 않는다 ───────────────────────────────────────────────
//
// ★정직성 조항. Resend 는 우리 도메인에서 나간다. 사용자는 거의 항상 **자기
// 주소로 나갈 거라고 오해한다**(`gmail.send` 가 그랬으니까). 받는 쪽 수신함에
// 찍히는 이름이 조용히 바뀌는 것은 사용자가 나중에 답장함에서 발견하게 되는
// 종류의 배신이다. 그래서 발신 주소는 (1) 메일 본문 푸터, (2) 도구 설명,
// (3) 발송 결과 문장 — 세 곳 전부에 나온다. 아래 상수와 문구가 그 단일 소스다.
//
// index.ts 의 FOUNDER_FROM_EMAIL 과 같은 값이다(env override 가능). 여기서는
// 문구 생성용 기본값만 들고 있고, 실제 From 헤더는 index.ts 가 정한다.
export const ASSISTANT_EMAIL_FROM_ADDRESS = "team@marblo.app";
export const ASSISTANT_EMAIL_FROM_NAME = "Marblo";

export type AssistantEmailLocale = "ko" | "en";

export function normalizeAssistantEmailLocale(
  raw: unknown
): AssistantEmailLocale {
  return raw === "en" ? "en" : "ko";
}

// ── 한도 ────────────────────────────────────────────────────────────────────

export const ASSISTANT_EMAIL_MAX_SUBJECT_CHARS = 200;
export const ASSISTANT_EMAIL_MAX_BODY_CHARS = 20_000;

/**
 * 사용자(uid)당 발송 한도. 이 경로의 정상 사용은 "비서가 나에게 브리핑을 보낸다"
 * 라 하루 수 건이다. 넉넉히 잡되, 계정 하나가 탈취돼도 우리 도메인 평판을 태울
 * 만큼은 못 나가게 조인다.
 *
 * ★IP 축은 두지 않는다. 인증된 uid 가 이미 있고, 같은 사무실에서 여러 명이
 * 각자 자기 주소로 브리핑을 받는 것은 정상 사용인데 IP 축은 그걸 서로 잡아먹는다.
 * 수신자가 본인으로 잠겨 있으므로 uid 축만으로 중계기 위험이 닫힌다.
 */
export const ASSISTANT_EMAIL_RATE_RULES_UID: RateRule[] = [
  { windowSeconds: 60, max: 3 },
  { windowSeconds: 3600, max: 15 },
  { windowSeconds: 86400, max: 40 },
];

/** rate_limits 컬렉션 키. 다른 예산과 절대 섞이면 안 된다(`rateLimit.ts` 주석 참조). */
export function assistantEmailRateKey(uid: string): string {
  return `assistant_email:uid:${uid}`;
}

// ── 요청/정체성 ─────────────────────────────────────────────────────────────

export interface AssistantEmailRequest {
  to: unknown;
  subject: unknown;
  body: unknown;
  cc?: unknown;
  bcc?: unknown;
  /** 2단계 확인 계약. 사용자의 명시 승인 없이 true 를 넣는 것은 계약 위반이다. */
  confirm?: unknown;
}

/**
 * 발신 주체의 정체성. ★콜러블이 **ID 토큰 클레임이 아니라
 * `admin.auth().getUser(uid)`** 로 채운다.
 *
 * 이유: 이 경로를 실제로 부르는 것은 MCP 서버이고, 그쪽은 custom token 으로
 * 로그인한다. custom token 세션의 ID 토큰에 email 클레임이 실릴지는 발급 방식에
 * 달려 있어 신뢰할 수 없다. Auth 사용자 레코드는 권위 있는 단일 소스다 —
 * "클레임이 비어서 정책이 조용히 느슨해지는" 실패 모드를 아예 없앤다.
 */
export interface AssistantEmailSenderIdentity {
  uid: string;
  /** Auth 레코드의 이메일. 없으면 null. */
  email: string | null;
  /** Auth 레코드의 emailVerified. */
  emailVerified: boolean;
}

export type AssistantEmailRejectReason =
  /** confirm !== true. 초안을 먼저 보여주고 사용자 승인을 받아야 한다. */
  | "not_confirmed"
  /** 발신 주체에게 인증된 이메일이 없다 — 보낼 수 있는 주소가 존재하지 않는다. */
  | "no_verified_sender_identity"
  /** 수신자가 비었다. */
  | "recipient_required"
  /** ★수신자가 본인이 아니다. 이 경로의 핵심 게이트. */
  | "recipient_not_self"
  /** 수신자가 2명 이상이다(본인 1명만 허용). */
  | "too_many_recipients"
  /** cc/bcc 는 이 경로에서 허용하지 않는다. */
  | "cc_bcc_not_allowed"
  /** 이메일 주소 형태가 아니다. */
  | "invalid_recipient"
  | "subject_required"
  | "subject_too_long"
  /** 제목에 CR/LF — 헤더 인젝션 시도로 취급한다. */
  | "subject_control_characters"
  | "body_required"
  | "body_too_long";

export interface AssistantEmailValidation {
  ok: boolean;
  /** 실패 사유 전부. 하나만 보고 끊지 않는다 — 에이전트가 한 번에 고칠 수 있어야 한다. */
  reasons: AssistantEmailRejectReason[];
  /** 통과 시 정규화된 수신자(정확히 1명 — 본인). */
  recipient?: string;
  subject?: string;
  body?: string;
}

// ── 이메일 정규화 ───────────────────────────────────────────────────────────

/** 소문자·trim. 비교는 항상 이 값끼리 한다. */
export function normalizeEmailAddress(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * 형태 검사. RFC 를 완전히 구현하지 않는다 — 우리가 막아야 하는 것은
 * "이상한 주소"가 아니라 **주소 필드에 섞여 들어오는 구분자·제어문자**다
 * (`a@b.com, victim@x.com` 같은 다중 수신자 밀반입).
 */
export function isPlausibleEmailAddress(email: string): boolean {
  if (!email || email.length > 254) return false;
  // 공백·구분자·제어문자·꺾쇠는 전부 거절.
  if (/[\s,;<>"'\\]/.test(email)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

function toStringArray(raw: unknown): string[] {
  if (typeof raw === "string") return raw.length > 0 ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string");
  }
  return [];
}

// ── ★수신자 정책 — 이 파일의 안전 핵심 ──────────────────────────────────────
//
// **본인의 인증된 이메일 주소 1개만.** 그 외 전부 거절한다.
//
// 왜 이렇게 좁은가 — 넓힐 근거가 아직 없기 때문이다:
//
//  1. 설계문서 §3.3 이 이 경로에 배정한 용도는 **"자기 자신에게 보내는 브리핑"**
//     하나다. 트리거 요약·리포트가 정확히 그 모양이고, 받는 사람이 본인이면
//     From 이 우리 도메인인 것도 문제가 되지 않는다.
//  2. 사용자가 **남에게** 보내는 메일은 이 경로의 일이 아니다. 그건 From 이
//     사용자 본인 주소여야 맞고, 그래서 설계가 애플 메일(T5b)을 따로 세운다.
//     여기서 넓히면 T5b 가 존재할 이유가 흐려지면서 "우리 도메인으로 남에게
//     보내기"라는 **틀린 결과**가 기본값이 된다.
//  3. 수신자를 LLM 이 정한다는 사실. 프롬프트 인젝션 한 방이면 임의 주소 발송이
//     된다. 본인 잠금은 그 공격의 **성과를 0으로 만든다** — 최악의 경우에도
//     사용자가 자기 수신함에서 스팸을 보는 데서 끝난다.
//
// 넓히려면: 근거(실측된 사용 요구)와 함께 `resolveAllowedRecipients` 를 고치고
// 이 파일의 테스트를 같이 고쳐야 한다. 조용히 넓어지는 경로는 없다.

/**
 * 허용 수신자 집합. 지금은 본인 인증 이메일 1개뿐이다.
 * 정책을 넓힐 때 손댈 **유일한** 지점 — 호출부는 이 함수만 믿는다.
 */
export function resolveAllowedRecipients(
  sender: AssistantEmailSenderIdentity
): string[] {
  if (!sender.emailVerified) return [];
  const email = normalizeEmailAddress(sender.email);
  if (!email || !isPlausibleEmailAddress(email)) return [];
  return [email];
}

/**
 * 요청 전체 판정. 통과하면 정규화된 수신자·제목·본문을 돌려준다.
 * ★호출부는 반드시 이 반환값(`recipient`)으로 발송한다 — 원본 `to` 를 쓰면
 * 정규화·정책 검사를 우회하게 된다.
 */
export function validateAssistantEmailRequest(
  req: AssistantEmailRequest,
  sender: AssistantEmailSenderIdentity
): AssistantEmailValidation {
  const reasons: AssistantEmailRejectReason[] = [];

  // 2단계 확인 계약 — gmail_send 와 동일. 초안을 보여주고 승인받은 뒤 true.
  if (req.confirm !== true) reasons.push("not_confirmed");

  const allowed = resolveAllowedRecipients(sender);
  if (allowed.length === 0) reasons.push("no_verified_sender_identity");

  const cc = toStringArray(req.cc);
  const bcc = toStringArray(req.bcc);
  if (cc.length > 0 || bcc.length > 0) reasons.push("cc_bcc_not_allowed");

  const to = toStringArray(req.to)
    .map(normalizeEmailAddress)
    .filter((e) => e.length > 0);
  let recipient: string | undefined;
  if (to.length === 0) {
    reasons.push("recipient_required");
  } else if (to.length > 1) {
    reasons.push("too_many_recipients");
  } else if (!isPlausibleEmailAddress(to[0])) {
    reasons.push("invalid_recipient");
  } else if (allowed.length > 0 && !allowed.includes(to[0])) {
    reasons.push("recipient_not_self");
  } else if (allowed.length > 0) {
    recipient = to[0];
  }

  const subject = typeof req.subject === "string" ? req.subject.trim() : "";
  if (!subject) {
    reasons.push("subject_required");
  } else if (subject.length > ASSISTANT_EMAIL_MAX_SUBJECT_CHARS) {
    reasons.push("subject_too_long");
    // eslint-disable-next-line no-control-regex
  } else if (/[\r\n\u0000]/.test(subject)) {
    reasons.push("subject_control_characters");
  }

  const body = typeof req.body === "string" ? req.body : "";
  if (!body.trim()) {
    reasons.push("body_required");
  } else if (body.length > ASSISTANT_EMAIL_MAX_BODY_CHARS) {
    reasons.push("body_too_long");
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, reasons: [], recipient, subject, body };
}

// ── 사용자·에이전트가 읽는 문구 ─────────────────────────────────────────────

/**
 * ★발신 주소 고지. 도구 설명·발송 결과·메일 푸터가 전부 이 문장을 쓴다.
 * 값이 바뀌면 세 곳이 같이 바뀐다.
 */
export function assistantEmailFromNotice(
  locale: AssistantEmailLocale,
  fromAddress: string = ASSISTANT_EMAIL_FROM_ADDRESS
): string {
  if (locale === "en") {
    return (
      `This email is sent from ${fromAddress} (Marblo), NOT from your own ` +
      "email address. Recipients will see Marblo's address in their inbox, " +
      "and replies come back to us, not to you."
    );
  }
  return (
    `이 메일은 사용자 본인 주소가 아니라 ${fromAddress} (Marblo) 에서 나갑니다. ` +
    "받는 사람의 수신함에는 Marblo 주소가 찍히고, 답장도 사용자가 아니라 " +
    "우리에게 옵니다."
  );
}

/** ★수신자 정책 고지. 왜 본인에게만 보낼 수 있는지를 한 문장으로. */
export function assistantEmailRecipientPolicyNotice(
  locale: AssistantEmailLocale
): string {
  if (locale === "en") {
    return (
      "Recipient policy: this path can only send to YOUR OWN verified sign-in " +
      "email address. Sending to anyone else is refused — because the message " +
      "would leave from Marblo's domain, not yours."
    );
  }
  return (
    "수신자 정책: 이 경로는 **본인의 인증된 로그인 이메일 주소로만** 보낼 수 " +
    "있습니다. 다른 주소는 거절됩니다 — 메일이 사용자 도메인이 아니라 Marblo " +
    "도메인에서 나가기 때문입니다."
  );
}

/** 거절 사유 → 사람이 읽는 문장. 무엇이 / 왜 / 대신 무엇을. */
export function assistantEmailRejectMessage(
  reason: AssistantEmailRejectReason,
  locale: AssistantEmailLocale
): string {
  const ko: Record<AssistantEmailRejectReason, string> = {
    not_confirmed:
      "확인 없이는 보내지 않습니다. 받는 사람·제목·본문 전문을 사용자에게 " +
      "먼저 보여주고, 승인받은 뒤 confirm=true 로 다시 호출하세요.",
    no_verified_sender_identity:
      "인증된 로그인 이메일이 없어 보낼 수 있는 주소가 없습니다. Marblo 에 " +
      "이메일이 확인된 계정으로 로그인한 뒤 다시 시도하세요.",
    recipient_required: "받는 사람이 비어 있습니다.",
    recipient_not_self:
      "본인의 인증된 로그인 이메일 주소로만 보낼 수 있습니다. " +
      assistantEmailRecipientPolicyNotice("ko"),
    too_many_recipients: "받는 사람은 한 명(본인)만 지정할 수 있습니다.",
    cc_bcc_not_allowed:
      "이 경로는 참조·숨은참조를 지원하지 않습니다(본인에게만 보내므로 " +
      "참조할 대상이 없습니다).",
    invalid_recipient: "이메일 주소 형식이 아닙니다.",
    subject_required: "제목이 비어 있습니다.",
    subject_too_long: `제목은 ${ASSISTANT_EMAIL_MAX_SUBJECT_CHARS}자를 넘을 수 없습니다.`,
    subject_control_characters: "제목에 줄바꿈이나 제어문자가 들어 있습니다.",
    body_required: "본문이 비어 있습니다.",
    body_too_long: `본문은 ${ASSISTANT_EMAIL_MAX_BODY_CHARS}자를 넘을 수 없습니다.`,
  };
  const en: Record<AssistantEmailRejectReason, string> = {
    not_confirmed:
      "Refused without confirmation. Show the user the full recipient, " +
      "subject and body first, then call again with confirm=true once they approve.",
    no_verified_sender_identity:
      "No verified sign-in email, so there is no address we are allowed to send to. " +
      "Sign in to Marblo with a verified email and retry.",
    recipient_required: "Recipient is empty.",
    recipient_not_self:
      "Can only send to your own verified sign-in email address. " +
      assistantEmailRecipientPolicyNotice("en"),
    too_many_recipients: "Exactly one recipient (yourself) is allowed.",
    cc_bcc_not_allowed:
      "This path does not support cc/bcc (there is nobody to copy when the " +
      "only allowed recipient is you).",
    invalid_recipient: "Not a valid email address.",
    subject_required: "Subject is empty.",
    subject_too_long: `Subject may not exceed ${ASSISTANT_EMAIL_MAX_SUBJECT_CHARS} characters.`,
    subject_control_characters:
      "Subject contains a line break or control character.",
    body_required: "Body is empty.",
    body_too_long: `Body may not exceed ${ASSISTANT_EMAIL_MAX_BODY_CHARS} characters.`,
  };
  return locale === "en" ? en[reason] : ko[reason];
}

/** 거절 사유 전부를 한 덩어리 문장으로. 콜러블이 HttpsError 메시지로 쓴다. */
export function assistantEmailRejectSummary(
  reasons: AssistantEmailRejectReason[],
  locale: AssistantEmailLocale
): string {
  return reasons.map((r) => assistantEmailRejectMessage(r, locale)).join(" ");
}

/**
 * ★발송 성공 문장. 에이전트가 사용자에게 그대로 옮길 수 있어야 하고,
 * **발신 주소가 반드시 들어간다**(설계문서 §3.3 "어느 경로로 나갔는지와 From
 * 주소를 결과 문장에 반드시 적는다").
 */
export function assistantEmailSentSummary(input: {
  recipient: string;
  subject: string;
  locale: AssistantEmailLocale;
  fromAddress?: string;
}): string {
  const from = input.fromAddress ?? ASSISTANT_EMAIL_FROM_ADDRESS;
  if (input.locale === "en") {
    return [
      `Sent to ${input.recipient} — "${input.subject}".`,
      `Route: Resend. From: ${from} (Marblo).`,
      assistantEmailFromNotice("en", from),
    ].join(" ");
  }
  return [
    `${input.recipient} 에게 "${input.subject}" 메일을 보냈습니다.`,
    `발송 경로: Resend. 발신 주소: ${from} (Marblo).`,
    assistantEmailFromNotice("ko", from),
  ].join(" ");
}

// ── 메일 문면 ───────────────────────────────────────────────────────────────

/** index.ts 의 FounderEmailContent 와 동일 형태 — 그대로 postResendEmail 에 넘긴다. */
export interface AssistantEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 본문을 그대로 담은 메일. 문면을 우리가 꾸미지 않는다 — 사용자가 승인한 것은
 * 에이전트가 보여준 본문이고, 우리가 거기에 문장을 더하면 승인 대상이 아닌 것이
 * 나가는 셈이다. 예외는 **푸터 한 줄**이고, 그건 정직성 때문에 반드시 붙는다.
 */
export function buildAssistantEmail(input: {
  subject: string;
  body: string;
  locale: AssistantEmailLocale;
  fromAddress?: string;
}): AssistantEmailContent {
  const from = input.fromAddress ?? ASSISTANT_EMAIL_FROM_ADDRESS;
  const footer =
    input.locale === "en"
      ? `Sent by the Marblo assistant on your request, from ${from}.`
      : `Marblo 비서가 사용자 요청으로 ${from} 에서 보냈습니다.`;

  const bodyHtml = escapeHtml(input.body).replace(/\n/g, "<br>");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#111">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;line-height:1.7;font-size:15px">
<div>${bodyHtml}</div>
<hr style="border:none;border-top:1px solid #eee;margin:28px 0 14px"/>
<p style="margin:0;color:#999;font-size:12px">${escapeHtml(footer)}</p>
</div></body></html>`;

  const text = [input.body, "", "—", footer].join("\n");
  return { subject: input.subject, html, text };
}
