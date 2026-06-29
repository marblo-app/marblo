// redactSecrets 단위테스트. firebase 의존성 없는 순수 모듈이라 컴파일 후
// `node --test` 로 바로 실행할 수 있다.
//   tsc src/redact.ts src/redact.test.ts --outDir /tmp/out --module commonjs \
//       --target es2020 --esModuleInterop && node --test /tmp/out/redact.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "./redact";

test("OpenAI sk- 키 마스킹", () => {
  const out = redactSecrets("key=sk-abcdefABCDEF0123456789 done");
  assert.ok(!out.includes("sk-abcdefABCDEF0123456789"), out);
  assert.ok(out.includes("[REDACTED]"));
});

test("GitHub ghp_ 토큰 마스킹", () => {
  const secret = "ghp_" + "A".repeat(36);
  const out = redactSecrets(`token used ${secret} here`);
  assert.ok(!out.includes(secret), out);
  assert.ok(out.includes("[REDACTED_GH_TOKEN]"));
});

test("github_pat_ 토큰 마스킹", () => {
  const secret = "github_pat_" + "B".repeat(40);
  const out = redactSecrets(secret);
  assert.ok(!out.includes(secret));
  assert.ok(out.includes("[REDACTED_GH_TOKEN]"));
});

test("AWS AKIA 키 마스킹", () => {
  const out = redactSecrets("aws AKIAIOSFODNN7EXAMPLE creds");
  assert.ok(!out.includes("AKIAIOSFODNN7EXAMPLE"), out);
  assert.ok(out.includes("[REDACTED_AWS_KEY]"));
});

test("Bearer 토큰 마스킹 (헤더 밖 단독)", () => {
  const out = redactSecrets("curl -H Bearer eyJhbGciOi.JIUzI1NiJ9.abc-123");
  assert.ok(!out.includes("eyJhbGciOi.JIUzI1NiJ9.abc-123"), out);
  assert.ok(out.includes("Bearer [REDACTED]"));
});

test("Authorization: Bearer 헤더 마스킹", () => {
  const out = redactSecrets(
    "Authorization: Bearer eyJhbGciOi.JIUzI1NiJ9.abc-123"
  );
  assert.ok(!out.includes("eyJhbGciOi.JIUzI1NiJ9.abc-123"), out);
  assert.ok(out.includes("[REDACTED]"));
});

test("Authorization 헤더값(비 Bearer) 마스킹", () => {
  const out = redactSecrets("authorization=Basic dXNlcjpwYXNz");
  assert.ok(!out.includes("dXNlcjpwYXNz"), out);
  assert.ok(out.includes("[REDACTED]"));
});

test("token= 쿼리 파라미터 마스킹", () => {
  const out = redactSecrets(
    "https://api.example.com/x?token=supersecretvalue123&y=1"
  );
  assert.ok(!out.includes("supersecretvalue123"), out);
  assert.ok(out.includes("token=[REDACTED]"));
});

test("api_key / api-key 마스킹", () => {
  const out = redactSecrets(
    'config: api_key="myApiKey_9876" api-key: other-key-val'
  );
  assert.ok(!out.includes("myApiKey_9876"), out);
  assert.ok(!out.includes("other-key-val"), out);
});

test("Slack 토큰 마스킹", () => {
  const secret = "xoxb-" + "1".repeat(24);
  const out = redactSecrets(secret);
  assert.ok(!out.includes(secret));
  assert.ok(out.includes("[REDACTED_SLACK_TOKEN]"));
});

test("홈경로 사용자명 마스킹", () => {
  const out = redactSecrets("/Users/johnkim/.config/app  /home/alice/secret");
  assert.ok(!out.includes("/Users/johnkim"), out);
  assert.ok(!out.includes("/home/alice"), out);
  assert.ok(out.includes("/Users/[USER]"));
  assert.ok(out.includes("/home/[USER]"));
});

test("일반 로그는 변형하지 않음", () => {
  const clean = "INFO: agent started on route /missions step 3 ok";
  assert.equal(redactSecrets(clean), clean);
});

test("문자열이 아니면 빈 문자열", () => {
  assert.equal(redactSecrets(undefined), "");
  assert.equal(redactSecrets(null), "");
  assert.equal(redactSecrets(42), "");
});
