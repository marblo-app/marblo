// assistantEmail 순수 로직 테스트 — node --test (devDep 추가 없음).
//   npm run test:assistant-email
//
// 이 파일이 지키는 불변식은 셋이고, 셋 다 깨지면 사고가 난다:
//   1. ★수신자는 본인의 인증된 로그인 이메일 하나뿐이다 — 넓어지면 스팸 중계기.
//   2. ★2단계 확인(confirm=true) 없이는 못 나간다 — gmail_send 계약과 동일.
//   3. ★발신 주소(team@marblo.app)가 도구 설명·결과 문장·메일 푸터에 전부 있다 —
//      빠지면 사용자가 "내 주소로 나갔다"고 오해한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ASSISTANT_EMAIL_FROM_ADDRESS,
  ASSISTANT_EMAIL_MAX_BODY_CHARS,
  ASSISTANT_EMAIL_MAX_SUBJECT_CHARS,
  ASSISTANT_EMAIL_RATE_RULES_UID,
  assistantEmailFromNotice,
  assistantEmailRateKey,
  assistantEmailRecipientPolicyNotice,
  assistantEmailRejectMessage,
  assistantEmailRejectSummary,
  assistantEmailSentSummary,
  buildAssistantEmail,
  escapeHtml,
  isPlausibleEmailAddress,
  normalizeEmailAddress,
  resolveAllowedRecipients,
  validateAssistantEmailRequest,
  type AssistantEmailRejectReason,
  type AssistantEmailRequest,
  type AssistantEmailSenderIdentity,
} from "./assistantEmail";

import { decide } from "./rateLimitCore";

const SELF: AssistantEmailSenderIdentity = {
  uid: "uid-1",
  email: "owner@example.com",
  emailVerified: true,
};

function req(over: Partial<AssistantEmailRequest> = {}): AssistantEmailRequest {
  return {
    to: ["owner@example.com"],
    subject: "오늘의 브리핑",
    body: "새 이슈 3건이 열렸습니다.",
    confirm: true,
    ...over,
  };
}

function reasonsOf(
  over: Partial<AssistantEmailRequest> = {},
  sender: AssistantEmailSenderIdentity = SELF
): AssistantEmailRejectReason[] {
  return validateAssistantEmailRequest(req(over), sender).reasons;
}

// ── 1. 수신자 정책 ──────────────────────────────────────────────────────────

test("허용 수신자는 본인의 인증된 이메일 하나뿐이다", () => {
  assert.deepEqual(resolveAllowedRecipients(SELF), ["owner@example.com"]);
});

test("이메일 미인증이면 허용 수신자가 0개다 — 아무 데도 못 보낸다", () => {
  assert.deepEqual(
    resolveAllowedRecipients({ ...SELF, emailVerified: false }),
    []
  );
  assert.ok(
    reasonsOf({}, { ...SELF, emailVerified: false }).includes(
      "no_verified_sender_identity"
    )
  );
});

test("Auth 레코드에 이메일이 없으면 허용 수신자가 0개다", () => {
  assert.deepEqual(resolveAllowedRecipients({ ...SELF, email: null }), []);
});

test("★남의 주소로는 못 보낸다 — 스팸 중계기 방지의 핵심 게이트", () => {
  assert.ok(
    reasonsOf({ to: ["victim@elsewhere.com"] }).includes("recipient_not_self")
  );
});

test("★본인 주소를 섞어도 2명 이상이면 거절", () => {
  assert.ok(
    reasonsOf({ to: ["owner@example.com", "victim@elsewhere.com"] }).includes(
      "too_many_recipients"
    )
  );
});

test("★cc/bcc 로 제3자를 밀반입할 수 없다", () => {
  assert.ok(
    reasonsOf({ cc: ["victim@elsewhere.com"] }).includes("cc_bcc_not_allowed")
  );
  assert.ok(
    reasonsOf({ bcc: ["victim@elsewhere.com"] }).includes("cc_bcc_not_allowed")
  );
});

test("★주소 필드에 구분자를 넣어 다중 수신자를 밀반입할 수 없다", () => {
  for (const smuggled of [
    "owner@example.com, victim@elsewhere.com",
    "owner@example.com;victim@elsewhere.com",
    "owner@example.com victim@elsewhere.com",
    '"owner@example.com" <victim@elsewhere.com>',
    "owner@example.com\nBcc: victim@elsewhere.com",
  ]) {
    const reasons = reasonsOf({ to: [smuggled] });
    assert.ok(
      reasons.includes("invalid_recipient") ||
        reasons.includes("recipient_not_self"),
      `밀반입이 통과했다: ${JSON.stringify(smuggled)}`
    );
  }
});

test("대소문자·공백 차이는 본인으로 인정한다(정규화)", () => {
  const v = validateAssistantEmailRequest(
    req({ to: ["  Owner@Example.COM "] }),
    SELF
  );
  assert.equal(v.ok, true);
  assert.equal(v.recipient, "owner@example.com");
});

test("Auth 레코드 쪽 이메일도 정규화해서 비교한다", () => {
  const v = validateAssistantEmailRequest(req(), {
    ...SELF,
    email: "OWNER@Example.com",
  });
  assert.equal(v.ok, true);
  assert.equal(v.recipient, "owner@example.com");
});

test("수신자가 비면 거절", () => {
  assert.ok(reasonsOf({ to: [] }).includes("recipient_required"));
  assert.ok(reasonsOf({ to: undefined }).includes("recipient_required"));
});

test("문자열 하나로 온 to 도 받아준다(배열 강제 아님)", () => {
  const v = validateAssistantEmailRequest(
    req({ to: "owner@example.com" }),
    SELF
  );
  assert.equal(v.ok, true);
  assert.equal(v.recipient, "owner@example.com");
});

test("숫자/객체 등 이상한 타입은 수신자로 세지 않는다", () => {
  assert.ok(reasonsOf({ to: [42, { x: 1 }] }).includes("recipient_required"));
});

// ── 2. 2단계 확인 계약 ──────────────────────────────────────────────────────

test("★confirm 없이는 발송되지 않는다", () => {
  assert.ok(reasonsOf({ confirm: undefined }).includes("not_confirmed"));
  assert.ok(reasonsOf({ confirm: false }).includes("not_confirmed"));
});

test("★truthy 문자열은 confirm 으로 치지 않는다 — 정확히 true 여야 한다", () => {
  for (const sloppy of ["true", 1, "yes", {}]) {
    assert.ok(
      reasonsOf({ confirm: sloppy }).includes("not_confirmed"),
      `느슨한 confirm 이 통과했다: ${JSON.stringify(sloppy)}`
    );
  }
});

test("confirm=true + 본인 수신자면 통과한다", () => {
  const v = validateAssistantEmailRequest(req(), SELF);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.subject, "오늘의 브리핑");
});

test("거절 사유는 하나만 보고 끊지 않고 전부 모은다", () => {
  const reasons = reasonsOf({
    confirm: false,
    to: ["victim@elsewhere.com"],
    subject: "",
  });
  assert.ok(reasons.includes("not_confirmed"));
  assert.ok(reasons.includes("recipient_not_self"));
  assert.ok(reasons.includes("subject_required"));
});

// ── 3. 제목·본문 ────────────────────────────────────────────────────────────

test("제목에 CR/LF 를 넣는 헤더 인젝션 시도를 거절한다", () => {
  assert.ok(
    reasonsOf({ subject: "안녕\r\nBcc: victim@elsewhere.com" }).includes(
      "subject_control_characters"
    )
  );
});

test("제목·본문 길이 상한이 걸려 있다", () => {
  assert.ok(
    reasonsOf({
      subject: "가".repeat(ASSISTANT_EMAIL_MAX_SUBJECT_CHARS + 1),
    }).includes("subject_too_long")
  );
  assert.ok(
    reasonsOf({
      body: "가".repeat(ASSISTANT_EMAIL_MAX_BODY_CHARS + 1),
    }).includes("body_too_long")
  );
});

test("공백뿐인 제목·본문은 비어 있는 것으로 본다", () => {
  assert.ok(reasonsOf({ subject: "   " }).includes("subject_required"));
  assert.ok(reasonsOf({ body: "  \n " }).includes("body_required"));
});

// ── 4. ★발신 주소 정직성 ───────────────────────────────────────────────────

test("발신 고지에 team@marblo.app 이 ko/en 양쪽에 들어 있다", () => {
  assert.equal(ASSISTANT_EMAIL_FROM_ADDRESS, "team@marblo.app");
  for (const locale of ["ko", "en"] as const) {
    assert.ok(
      assistantEmailFromNotice(locale).includes("team@marblo.app"),
      `${locale} 고지에 발신 주소가 없다`
    );
  }
});

test("발신 고지는 '본인 주소가 아니다'를 명시한다", () => {
  assert.match(assistantEmailFromNotice("ko"), /본인 주소가 아니라/);
  assert.match(assistantEmailFromNotice("en"), /NOT from your own/);
});

test("발송 결과 문장에 수신자와 발신 주소가 둘 다 들어 있다", () => {
  const summary = assistantEmailSentSummary({
    recipient: "owner@example.com",
    subject: "오늘의 브리핑",
    locale: "ko",
  });
  assert.ok(summary.includes("owner@example.com"));
  assert.ok(summary.includes("team@marblo.app"));
  assert.ok(summary.includes("Resend"));
});

test("메일 푸터에 발신 주소가 박힌다(html·text 둘 다)", () => {
  const content = buildAssistantEmail({
    subject: "오늘의 브리핑",
    body: "본문",
    locale: "ko",
  });
  assert.ok(content.html.includes("team@marblo.app"));
  assert.ok(content.text.includes("team@marblo.app"));
});

test("발신 주소를 env 로 덮어써도 문구가 같이 따라간다", () => {
  const notice = assistantEmailFromNotice("ko", "hello@example.org");
  assert.ok(notice.includes("hello@example.org"));
  assert.ok(!notice.includes("team@marblo.app"));
  const content = buildAssistantEmail({
    subject: "s",
    body: "b",
    locale: "en",
    fromAddress: "hello@example.org",
  });
  assert.ok(content.text.includes("hello@example.org"));
});

test("수신자 정책 고지가 ko/en 양쪽에 존재한다", () => {
  assert.match(assistantEmailRecipientPolicyNotice("ko"), /본인/);
  assert.match(assistantEmailRecipientPolicyNotice("en"), /YOUR OWN/);
});

test("모든 거절 사유에 ko/en 문장이 있다(빈 문장 금지)", () => {
  const all: AssistantEmailRejectReason[] = [
    "not_confirmed",
    "no_verified_sender_identity",
    "recipient_required",
    "recipient_not_self",
    "too_many_recipients",
    "cc_bcc_not_allowed",
    "invalid_recipient",
    "subject_required",
    "subject_too_long",
    "subject_control_characters",
    "body_required",
    "body_too_long",
  ];
  for (const reason of all) {
    for (const locale of ["ko", "en"] as const) {
      const msg = assistantEmailRejectMessage(reason, locale);
      assert.ok(msg && msg.length > 10, `${reason}/${locale} 문장이 비었다`);
    }
  }
  assert.ok(
    assistantEmailRejectSummary(["not_confirmed", "recipient_not_self"], "ko")
      .length > 20
  );
});

// ── 5. 본문 렌더링 ──────────────────────────────────────────────────────────

test("본문의 HTML 은 이스케이프된다 — 승인 안 된 마크업이 나가지 않는다", () => {
  const content = buildAssistantEmail({
    subject: "s",
    body: '<script>alert(1)</script> & "인용"',
    locale: "ko",
  });
  assert.ok(!content.html.includes("<script>"));
  assert.ok(content.html.includes("&lt;script&gt;"));
  assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
});

test("줄바꿈은 html 에서 <br> 로 보존된다", () => {
  const content = buildAssistantEmail({
    subject: "s",
    body: "첫 줄\n둘째 줄",
    locale: "ko",
  });
  assert.ok(content.html.includes("첫 줄<br>둘째 줄"));
  assert.ok(content.text.startsWith("첫 줄\n둘째 줄"));
});

// ── 6. 레이트리밋 예산 ──────────────────────────────────────────────────────

test("레이트리밋 키는 uid 로 격리된다", () => {
  assert.equal(assistantEmailRateKey("abc"), "assistant_email:uid:abc");
  assert.notEqual(assistantEmailRateKey("a"), assistantEmailRateKey("b"));
});

test("★분당 4번째 발송은 막힌다", () => {
  const now = 1_700_000_000_000;
  let attempts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const d = decide(attempts, ASSISTANT_EMAIL_RATE_RULES_UID, now + i * 1000);
    assert.equal(d.allowed, true, `${i + 1}번째가 막혔다`);
    attempts = d.attempts;
  }
  const blocked = decide(attempts, ASSISTANT_EMAIL_RATE_RULES_UID, now + 4000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);
});

test("★하루 한도가 존재한다 — 계정 하나로 도메인 평판을 태울 수 없다", () => {
  const daily = ASSISTANT_EMAIL_RATE_RULES_UID.find(
    (r) => r.windowSeconds >= 24 * 60 * 60
  );
  assert.ok(daily, "24시간 창 규칙이 없다");
  assert.ok(daily.max <= 100, "하루 한도가 너무 헐겁다");
});

// ── 7. 주소 형태 검사 ───────────────────────────────────────────────────────

test("이메일 형태 검사", () => {
  assert.equal(isPlausibleEmailAddress("a@b.com"), true);
  assert.equal(isPlausibleEmailAddress("a@b"), false);
  assert.equal(isPlausibleEmailAddress("a b@c.com"), false);
  assert.equal(isPlausibleEmailAddress(""), false);
  assert.equal(isPlausibleEmailAddress(`${"a".repeat(250)}@b.com`), false);
  assert.equal(normalizeEmailAddress(" A@B.COM "), "a@b.com");
  assert.equal(normalizeEmailAddress(null), "");
});

// ── 8. ★MCP 도구 설명의 정직성 잠금 ─────────────────────────────────────────
//
// 완료 기준 "발신 주소 명시가 도구 설명에 있음" 은 functions 밖(electron/mcp-server)
// 에 산다. 패키지가 달라 import 로는 못 잠그므로 파일을 읽어서 잠근다.
// npm 스크립트는 cwd=v3/functions 에서 돌기 때문에 이 경로는 안정적이다.

const TOOLS_TS = path.resolve(process.cwd(), "../electron/mcp-server/tools.ts");

test("★mail_send 도구 설명이 발신 주소와 수신자 정책을 명시한다", () => {
  assert.ok(
    fs.existsSync(TOOLS_TS),
    `MCP 도구 파일을 못 찾았다: ${TOOLS_TS} (cwd=${process.cwd()})`
  );
  const src = fs.readFileSync(TOOLS_TS, "utf-8");
  const idx = src.indexOf('"mail_send"');
  assert.ok(idx > 0, "mail_send 도구가 등록돼 있지 않다");
  // 도구 설명은 등록 직후 문자열들이다. 넉넉히 3KB 만 본다.
  const desc = src.slice(idx, idx + 3000);
  assert.ok(
    desc.includes("team@marblo.app"),
    "mail_send 설명에 발신 주소가 없다 — 사용자가 자기 주소로 나간다고 오해한다"
  );
  assert.ok(
    /NOT from|not from/.test(desc),
    "mail_send 설명이 '본인 주소가 아니다'를 말하지 않는다"
  );
  assert.ok(
    /confirm=true/.test(desc),
    "mail_send 설명에 2단계 확인 계약이 없다"
  );
  assert.ok(
    /own verified|yourself|your own/.test(desc),
    "mail_send 설명에 수신자 정책(본인에게만)이 없다"
  );
});
