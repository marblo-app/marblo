/**
 * 공개 Replay 리더 회귀 스위트 — §5.7 F5(저장형 XSS) · F6(fail-closed).
 *
 * ★픽스처는 상상이 아니다. `PUBLISHED_PAYLOAD_L3` 는 v3 의 `redactReplay()` 를
 * 실제로 돌려 얻은 발행 바이트다(합성 MissionReplay 의 goal·beat.title 에 마크업을
 * 심고 L1/L2/L3 로 비식별화). 결과: **마크업이 그대로 통과한다.** 비식별화는
 * 시크릿·경로·PII 를 지우지, HTML 을 안전하게 만들지 않는다 — 그게 F5 의 전제이고
 * 이 스위트가 지키는 계약이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_REPLAY_MAX_PAYLOAD_CHARS,
  REPLAY_ID_PATTERN,
  decodeRestDocument,
  fetchPublicReplay,
  parsePublicReplayDocument,
  safeCardImageUrl,
  safeHandle,
  safeNumber,
  safeParagraph,
  safePrUrl,
  safeText,
  type PublicReplayDocument,
} from "./publicReplay";

/** v3 `redactReplay(replay, {level:"L3", …})` 의 실제 출력(요약). */
const PUBLISHED_PAYLOAD_L3 = JSON.stringify({
  goal: "<img src=x onerror=alert(1)>Ship public replay page</script>",
  templateId: "feature-build",
  launchedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T03:00:00.000Z",
  durationMs: 10800000,
  stats: {
    tasks: 6,
    tasksDone: 5,
    agents: 3,
    prs: 2,
    filesChanged: 14,
    linesAdded: 820,
    linesDeleted: 130,
    testsPassed: 4,
    riskFlags: 1,
    reportsScanned: 5,
    retries: 2,
    costTotal: 12.34,
  },
  cast: [
    {
      agentRef: "agent-1",
      vendor: "claude",
      spawnedModel: "claude-opus-5",
      detectedModelId: "claude-opus-5",
      role: "frontend",
      tasksCompleted: 3,
      beats: 12,
    },
  ],
  beats: [
    {
      id: "T-1",
      ts: "2026-08-01T00:10:00.000Z",
      kind: "step.completed",
      taskId: "T-2",
      agentRef: "agent-1",
      actorRef: "member-1",
      title: "<script>alert('xss')</script> Implement page",
      detail: "javascript:alert(1)",
      sensitivity: "process",
    },
  ],
  prUrl: ["https://github.com/marblo-app/marblo/pull/735"],
  credits: { mode: "credited", handle: "@melocream" },
});

const VALID_ID = "r0123456789abcdefghjkmnpqrs";

function doc(
  overrides: Partial<PublicReplayDocument> = {}
): PublicReplayDocument {
  return {
    schemaVersion: 1,
    replayVersion: 1,
    level: "L3",
    status: "published",
    payload: PUBLISHED_PAYLOAD_L3,
    publishedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

// ── F5: 마크업은 살아서 도착한다. 우리 일은 그것을 텍스트로 다루는 것 ──────

test("★F5 전제 — 비식별화를 통과한 payload 에 마크업이 그대로 들어 있다", () => {
  assert.ok(PUBLISHED_PAYLOAD_L3.includes("<img src=x onerror="));
  assert.ok(PUBLISHED_PAYLOAD_L3.includes("<script>alert("));
});

test("마크업 필드는 값이 보존된 채 문자열로만 노출된다(렌더에서 이스케이프)", () => {
  const view = parsePublicReplayDocument(doc());
  assert.ok(view);
  assert.equal(typeof view.goal, "string");
  // 값을 몰래 고치지 않는다 — 내용 왜곡 없이, 이스케이프는 렌더 계층의 책임이다.
  assert.ok(view.goal.includes("<img src=x onerror=alert(1)>"));
  assert.ok(view.beats[0].title.includes("<script>alert('xss')</script>"));
});

test("beat.detail 의 javascript: 문자열은 텍스트일 뿐 링크가 되지 않는다", () => {
  const view = parsePublicReplayDocument(doc());
  assert.ok(view);
  assert.equal(view.beats[0].detail, "javascript:alert(1)");
  // detail 로 href 를 만드는 경로가 없어야 한다 — prUrls 만 링크가 된다.
  assert.deepEqual(view.prUrls, [
    "https://github.com/marblo-app/marblo/pull/735",
  ]);
});

// ── 봉투 검증 = fail-closed ─────────────────────────────────────

test("발행 상태가 아니면 렌더하지 않는다", () => {
  assert.equal(parsePublicReplayDocument(doc({ status: "unpublished" })), null);
  assert.equal(parsePublicReplayDocument(doc({ status: undefined })), null);
  assert.equal(parsePublicReplayDocument(null), null);
});

test("스키마/버전/등급이 어긋나면 렌더하지 않는다", () => {
  assert.equal(parsePublicReplayDocument(doc({ schemaVersion: 2 })), null);
  assert.equal(parsePublicReplayDocument(doc({ replayVersion: 2 })), null);
  assert.equal(parsePublicReplayDocument(doc({ level: "L0" })), null);
  assert.equal(parsePublicReplayDocument(doc({ level: "L4" })), null);
  // "1" 같은 문자열 버전도 통과시키지 않는다.
  assert.equal(parsePublicReplayDocument(doc({ schemaVersion: "1" })), null);
});

test("payload 가 비었거나 상한을 넘거나 JSON 이 아니면 렌더하지 않는다", () => {
  assert.equal(parsePublicReplayDocument(doc({ payload: "" })), null);
  assert.equal(
    parsePublicReplayDocument(
      doc({ payload: "x".repeat(PUBLIC_REPLAY_MAX_PAYLOAD_CHARS + 1) })
    ),
    null
  );
  assert.equal(parsePublicReplayDocument(doc({ payload: "not json" })), null);
  // 객체가 아닌 최상위(배열·null·스칼라)도 거부.
  assert.equal(parsePublicReplayDocument(doc({ payload: "[1,2,3]" })), null);
  assert.equal(parsePublicReplayDocument(doc({ payload: "null" })), null);
  assert.equal(parsePublicReplayDocument(doc({ payload: "42" })), null);
});

// ── URL 스킴: React 가 막아주지 않는 유일한 구멍 ────────────────

test("PR 링크는 https + 호스트 화이트리스트만 통과한다", () => {
  assert.equal(
    safePrUrl("https://github.com/a/b/pull/1"),
    "https://github.com/a/b/pull/1"
  );
  assert.equal(safePrUrl("javascript:alert(1)"), null);
  assert.equal(safePrUrl("JavaScript:alert(1)"), null);
  assert.equal(safePrUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safePrUrl("http://github.com/a/b/pull/1"), null);
  assert.equal(safePrUrl("https://evil.com/a/b/pull/1"), null);
  // 호스트 스푸핑: 자격증명 앞자리에 github.com 을 심는 고전 수법.
  assert.equal(safePrUrl("https://github.com:x@evil.com/pull/1"), null);
  assert.equal(safePrUrl("//github.com/a/b"), null);
  assert.equal(safePrUrl(42), null);
});

test("payload 안 악성 prUrl 은 뷰에 아예 실리지 않는다", () => {
  const payload = JSON.stringify({
    goal: "ok",
    prUrl: [
      "javascript:alert(1)",
      "https://evil.example.com/pull/1",
      "https://github.com/marblo-app/marblo/pull/2",
    ],
  });
  const view = parsePublicReplayDocument(doc({ payload }));
  assert.ok(view);
  assert.deepEqual(view.prUrls, [
    "https://github.com/marblo-app/marblo/pull/2",
  ]);
});

test("OG 카드 이미지는 Firebase Storage 호스트만 허용한다", () => {
  assert.equal(
    safeCardImageUrl(
      "https://firebasestorage.googleapis.com/v0/b/x/o/card.png"
    ),
    "https://firebasestorage.googleapis.com/v0/b/x/o/card.png"
  );
  assert.equal(safeCardImageUrl("https://evil.com/card.png"), null);
  assert.equal(safeCardImageUrl("javascript:alert(1)"), null);
  assert.equal(
    safeCardImageUrl("data:image/svg+xml,<svg onload=alert(1)>"),
    null
  );
});

// ── 크레딧(Q5) ─────────────────────────────────────────────────

test("크레딧은 opt-in — 익명이면 핸들이 없다", () => {
  const payload = JSON.stringify({
    goal: "ok",
    credits: { mode: "anonymous" },
  });
  const view = parsePublicReplayDocument(doc({ payload }));
  assert.ok(view);
  assert.equal(view.creditHandle, null);
});

test("크레딧 핸들은 문자 집합을 좁힌다 — 마크업이 섞이면 표시하지 않는다", () => {
  assert.equal(safeHandle("melocream"), "@melocream");
  assert.equal(safeHandle("@melocream"), "@melocream");
  assert.equal(safeHandle("<script>alert(1)</script>"), null);
  assert.equal(safeHandle("a b"), null);
  assert.equal(safeHandle("https://evil.com"), null);
  assert.equal(safeHandle("x".repeat(50)), null);
  assert.equal(safeHandle(""), null);
  assert.equal(safeHandle(null), null);
});

// ── 문자열 위생 ────────────────────────────────────────────────

test("제어문자·양방향 문자는 제거한다(Trojan Source 스푸핑 방지)", () => {
  const bidi = String.fromCharCode(0x202e); // RIGHT-TO-LEFT OVERRIDE
  const zeroWidth = String.fromCharCode(0x200b);
  const nul = String.fromCharCode(0x00);
  const cleaned = safeText(`gpj.${bidi}exe${zeroWidth} run${nul}me`);
  assert.ok(!cleaned.includes(bidi));
  assert.ok(!cleaned.includes(zeroWidth));
  assert.ok(!cleaned.includes(nul));
});

test("긴 문자열은 잘린다(레이아웃·DoS)", () => {
  const long = "a".repeat(5000);
  assert.ok(safeText(long, 100).length <= 101);
  assert.ok(safeParagraph(long, 100).length <= 101);
});

test("문자열이 아닌 값은 빈 문자열, 숫자 아닌 값은 null", () => {
  assert.equal(safeText({ toString: () => "<script>" }), "");
  assert.equal(safeText(undefined), "");
  assert.equal(safeNumber("5"), null);
  assert.equal(safeNumber(Number.NaN), null);
  assert.equal(safeNumber(Number.POSITIVE_INFINITY), null);
  assert.equal(safeNumber(5), 5);
});

test("모르는 필드는 뷰로 넘어오지 않는다(렌더 쪽 default-deny)", () => {
  const payload = JSON.stringify({
    goal: "ok",
    stats: { tasksDone: 1, secretLeak: "sk-ant-should-never-render" },
    surpriseField: "<script>alert(1)</script>",
  });
  const view = parsePublicReplayDocument(doc({ payload }));
  assert.ok(view);
  assert.equal(JSON.stringify(view).includes("surpriseField"), false);
  assert.equal(JSON.stringify(view).includes("secretLeak"), false);
  assert.equal(JSON.stringify(view).includes("sk-ant-"), false);
});

test("프로토타입 오염 시도는 파싱 단계에서 버려진다", () => {
  const payload =
    '{"goal":"ok","__proto__":{"polluted":true},"constructor":{"x":1}}';
  const view = parsePublicReplayDocument(doc({ payload }));
  assert.ok(view);
  assert.equal(
    (Object.prototype as unknown as { polluted?: boolean }).polluted,
    undefined
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("비트 수는 상한이 있고, 잘린 수를 정직하게 보고한다", () => {
  const beats = Array.from({ length: 420 }, (_, i) => ({
    id: `T-${i}`,
    ts: `+00:${i}`,
    kind: "task.status_changed",
    title: `beat ${i}`,
    sensitivity: "process",
  }));
  const view = parsePublicReplayDocument(
    doc({ payload: JSON.stringify({ goal: "ok", beats }) })
  );
  assert.ok(view);
  assert.equal(view.beats.length, 300);
  assert.equal(view.beatsOmitted, 120);
});

// ── F6: 추측불가 id + fail-closed 페치 ──────────────────────────

test("replayId 형태가 아니면 네트워크에 나가지도 않는다", async () => {
  const called: string[] = [];
  const spyFetch = (async (url: string) => {
    called.push(String(url));
    throw new Error("should not be called");
  }) as unknown as typeof fetch;

  for (const bad of [
    "../publicReplayOwners/abc",
    "R0123456789ABCDEFGHJKMNPQRS", // 대문자
    "r0123456789abcdefghjkmnpqr", // 25자
    "rilou123456789abcdefghjkmnp", // 제외 문자(i·l·o·u)
    "",
  ]) {
    assert.equal(await fetchPublicReplay(bad, { fetchImpl: spyFetch }), null);
  }
  assert.deepEqual(called, []);
  assert.ok(REPLAY_ID_PATTERN.test(VALID_ID));
});

test("룰 거부(403)·문서 없음(404)은 똑같이 null 이다", async () => {
  for (const status of [403, 404, 500]) {
    const fetchImpl = (async () =>
      new Response("{}", { status })) as unknown as typeof fetch;
    assert.equal(await fetchPublicReplay(VALID_ID, { fetchImpl }), null);
  }
});

test("REST 응답을 디코드해 뷰를 만든다", async () => {
  const body = {
    fields: {
      schemaVersion: { integerValue: "1" },
      replayVersion: { integerValue: "1" },
      level: { stringValue: "L3" },
      status: { stringValue: "published" },
      payload: { stringValue: PUBLISHED_PAYLOAD_L3 },
      publishedAt: { timestampValue: "2026-08-01T12:00:00Z" },
    },
  };
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
    })) as unknown as typeof fetch;

  const view = await fetchPublicReplay(VALID_ID, { fetchImpl });
  assert.ok(view);
  assert.equal(view.level, "L3");
  assert.equal(view.stats.tasksDone, 5);
  assert.equal(view.creditHandle, "@melocream");
  assert.equal(view.publishedAt, "2026-08-01T12:00:00Z");
});

test("REST 봉투가 아니면 null", () => {
  assert.equal(decodeRestDocument({}), null);
  assert.equal(decodeRestDocument(null), null);
  assert.equal(decodeRestDocument({ fields: "nope" }), null);
});
