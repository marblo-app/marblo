// telemetryMetadata 순수 로직 단위테스트 (betaSegments.test.ts 규약).
//
// 실행:
//   cd v3/functions && npm run test:telemetry-metadata
//
// ★이 파일의 존재 이유는 한 줄로 요약된다: **events 에 계정 식별자를 다시
// 붙이는 변경을 빨갛게 만든다**(ticket woXp2c70oR0tliGB8Vs6). 그 전에는 서버가
// 조용히 accountUserId(=Firebase uid)를 metadata 에 얹고 있었고, 처리방침은 같은
// 테이블을 익명이라고 고지하고 있었다.
import test from "node:test";
import assert from "node:assert/strict";

import { buildMetadata, safeParseObject } from "./telemetryMetadata";

// 계정 식별자로 읽힐 수 있는 키들. 서버 조립 결과에 이 중 하나라도 나타나면
// 프라이버시 회귀다.
const ACCOUNT_IDENTIFIER_KEYS = [
  "accountUserId",
  "uid",
  "userId",
  "email",
  "phone",
  "senderId",
];

function parsed(json: string | null): Record<string, unknown> {
  assert.ok(json != null, "metadata should not be null here");
  return JSON.parse(json) as Record<string, unknown>;
}

test("★계정 식별자를 서버가 새로 얹지 않는다 — 일반 이벤트", () => {
  const out = buildMetadata({
    event: "agent:spawned",
    metadata: JSON.stringify({ harness: "claude" }),
  });
  const obj = parsed(out);
  assert.deepEqual(obj, { harness: "claude" });
  for (const key of ACCOUNT_IDENTIFIER_KEYS) {
    assert.equal(key in obj, false, `${key} 가 metadata 에 새로 붙었다`);
  }
});

test("★계정 식별자를 서버가 새로 얹지 않는다 — dispatch:decision", () => {
  const out = buildMetadata({
    event: "dispatch:decision",
    metadata: null,
    reuseVsSpawn: "spawn",
    selectedModel: "claude-opus-5",
  } as never);
  const obj = parsed(out);
  assert.deepEqual(obj, {
    reuseVsSpawn: "spawn",
    selectedModel: "claude-opus-5",
  });
  for (const key of ACCOUNT_IDENTIFIER_KEYS) {
    assert.equal(key in obj, false, `${key} 가 metadata 에 새로 붙었다`);
  }
});

test("★계정 식별자를 서버가 새로 얹지 않는다 — onboarding:spawn_blocked (티켓 iyxb4KsJ)", () => {
  // 차단 '사유' 계측은 익명 설치 축으로만 존재한다. 사유를 계정에 귀속시키고 싶은
  // 유혹이 가장 큰 이벤트라(누가 구독이 없나) 여기에 못을 하나 더 박는다.
  const out = buildMetadata({
    event: "onboarding:spawn_blocked",
    metadata: JSON.stringify({
      reason: "no_subscription",
      surface: "dispatch",
      installed: true,
    }),
  });
  const obj = parsed(out);
  assert.equal(obj.reason, "no_subscription");
  for (const key of ACCOUNT_IDENTIFIER_KEYS) {
    assert.equal(key in obj, false, `${key} 가 metadata 에 새로 붙었다`);
  }
});

test("metadata 가 없고 접을 결정필드도 없으면 null(빈 '{}' 을 적지 않는다)", () => {
  assert.equal(buildMetadata({ event: "app:first_run" }), null);
  assert.equal(
    buildMetadata({ event: "dispatch:decision", metadata: undefined }),
    null,
  );
});

test("dispatch:decision 은 화이트리스트 필드만 접는다", () => {
  const obj = parsed(
    buildMetadata({
      event: "dispatch:decision",
      reuseVsSpawn: "reuse",
      // 화이트리스트에 없는 필드 — 조용히 사라져야 한다.
      secretHint: "should-not-survive",
    } as never),
  );
  assert.equal(obj.reuseVsSpawn, "reuse");
  assert.equal("secretHint" in obj, false);
});

test("화이트리스트 필드는 클라 metadata 위에 덮어쓴다(서버 관측이 우선)", () => {
  const obj = parsed(
    buildMetadata({
      event: "dispatch:decision",
      metadata: JSON.stringify({ reuseVsSpawn: "stale", note: "keep" }),
      reuseVsSpawn: "spawn",
    } as never),
  );
  assert.equal(obj.reuseVsSpawn, "spawn");
  assert.equal(obj.note, "keep");
});

test("undefined 인 결정필드는 접지 않는다(null 은 접는다)", () => {
  const obj = parsed(
    buildMetadata({
      event: "dispatch:decision",
      reuseVsSpawn: "spawn",
      spawnedModel: undefined,
      modelFallbackReason: null,
    } as never),
  );
  assert.equal("spawnedModel" in obj, false);
  assert.equal(obj.modelFallbackReason, null);
});

test("깨진/비-object metadata 문자열은 {} 로 접힌다", () => {
  assert.deepEqual(safeParseObject("not json"), {});
  assert.deepEqual(safeParseObject("[1,2]"), {});
  assert.deepEqual(safeParseObject("null"), {});
  assert.deepEqual(safeParseObject('{"a":1}'), { a: 1 });
  assert.equal(buildMetadata({ event: "x", metadata: "not json" }), null);
});

test("이미 object 인 metadata 도 그대로 받는다(문자열 강제 아님)", () => {
  const obj = parsed(
    buildMetadata({ event: "x", metadata: { a: 1 } } as never),
  );
  assert.deepEqual(obj, { a: 1 });
});
