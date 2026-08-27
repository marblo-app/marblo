import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "./rateLimitCore";
import {
  ASSISTANT_WEBHOOK_MAX_RAW_BODY_BYTES,
  ASSISTANT_WEBHOOK_RATE_RULES_WEBHOOK,
  signAssistantWebhookBody,
  shouldAcceptAssistantWebhookRateLimit,
  validateAssistantWebhookPayload,
  verifyAssistantWebhookSignature,
} from "./assistantWebhook";

test("인증 없는 요청은 거부된다", () => {
  const body = Buffer.from(JSON.stringify({ event: "row.created" }));

  assert.equal(
    verifyAssistantWebhookSignature(undefined, body, "secret"),
    false,
  );
  assert.equal(
    verifyAssistantWebhookSignature("ts=1;h1=bad", body, "secret"),
    false,
  );
});

test("HMAC over raw body 서명을 검증한다", () => {
  const rawBody = Buffer.from(
    JSON.stringify({ event: "form.submitted", payload: { email: "a@b.com" } }),
  );
  const signature = signAssistantWebhookBody({
    rawBody,
    secret: "known-secret",
    timestampSeconds: 1_800_000_000,
  });

  assert.equal(
    verifyAssistantWebhookSignature(signature, rawBody, "known-secret"),
    true,
  );
  assert.equal(
    verifyAssistantWebhookSignature(
      signature,
      Buffer.from(JSON.stringify({ payload: { email: "a@b.com" }, event: "form.submitted" })),
      "known-secret",
    ),
    false,
  );
});

test("스키마 밖 페이로드는 거부된다", () => {
  assert.equal(
    validateAssistantWebhookPayload({ payload: { ok: true } }, 20).ok,
    false,
  );
  assert.equal(
    validateAssistantWebhookPayload(
      { event: "nested", payload: { nested: { unsafe: true } } },
      40,
    ).ok,
    false,
  );
  assert.equal(
    validateAssistantWebhookPayload(
      { event: "arrays", payload: { items: [1, 2] } },
      40,
    ).ok,
    false,
  );
});

test("크기 초과 요청은 거부된다", () => {
  const result = validateAssistantWebhookPayload(
    { event: "too.large", payload: {} },
    ASSISTANT_WEBHOOK_MAX_RAW_BODY_BYTES + 1,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "payload_too_large");
});

test("레이트리밋 결정은 초과 요청을 막는다", () => {
  const nowMs = 1_800_000_000_000;
  const existing = Array.from(
    { length: ASSISTANT_WEBHOOK_RATE_RULES_WEBHOOK[0].max },
    (_, i) => nowMs - i * 100,
  );
  const limited = decide(existing, ASSISTANT_WEBHOOK_RATE_RULES_WEBHOOK, nowMs);

  assert.equal(limited.allowed, false);
  assert.equal(shouldAcceptAssistantWebhookRateLimit([limited]), false);
});

test("정상 페이로드는 정규화되어 통과한다", () => {
  const result = validateAssistantWebhookPayload(
    {
      event: "  sheet.row.created ",
      source: "  google-sheets ",
      payload: {
        rowId: "  R1 ",
        amount: 10,
        active: true,
        memo: null,
      },
    },
    120,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.value?.payload, {
    rowId: "R1",
    amount: 10,
    active: true,
    memo: null,
  });
});
