/**
 * ★F5 렌더 증명 — "이스케이프된다"를 주장이 아니라 **HTML 바이트로** 확인한다.
 *
 * 흉내낸 컴포넌트가 아니라 페이지가 실제로 쓰는 `PublicReplayArticle` 을,
 * 실제 파서(`parsePublicReplayDocument`)가 만든 뷰모델로 렌더한다. 즉 이 테스트가
 * 도는 경로 = 발행 바이트 → 신뢰 경계 → 화면. 중간에 대역이 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import PublicReplayArticle, {
  formatDuration,
  type ReplayLabels,
} from "./PublicReplayArticle";
import { parsePublicReplayDocument } from "@/lib/publicReplay";

const LABELS: ReplayLabels = {
  level: "L3",
  redactedBadge: "Redacted public copy",
  untitled: "Untitled mission",
  duration: (d) => `Took ${d}`,
  completedAt: (at) => `Completed ${at}`,
  castTitle: "Agent cast",
  unknownAgent: "Anonymous agent",
  tasksCompleted: (count) => `${count} tasks completed`,
  timelineTitle: "Timeline",
  beatsOmitted: (count) => `${count} more`,
  prTitle: "Pull requests",
  creditedTo: "Credited to",
  privacyNote: "Redacted on device.",
  cta: "Explore Marblo",
  stats: {
    tasksDone: "Tasks done",
    agents: "Agents",
    prs: "PRs",
    filesChanged: "Files changed",
    lines: "Lines changed",
    testsPassed: "Tests passing",
    riskFlags: "Risk flags",
    retries: "Retries",
    costTotal: "Cost",
  },
};

/**
 * 공격자 통제 필드를 전부 채운 발행 payload. `goal`·`title` 마크업은 v3
 * `redactReplay()` 실행 결과에서 그대로 가져온 것이다(비식별화를 통과한다).
 */
const HOSTILE_PAYLOAD = JSON.stringify({
  goal: "<img src=x onerror=alert(1)>Ship public replay page</script>",
  templateId: '"><script>alert("template")</script>',
  launchedAt: "+00:00",
  completedAt: "+03:00",
  durationMs: 10800000,
  stats: {
    tasksDone: 5,
    agents: 3,
    testsPassed: 4,
    reportsScanned: 5,
    costTotal: 12.34,
  },
  cast: [
    {
      agentRef: "<b>agent-1</b>",
      vendor: "claude",
      spawnedModel: "<script>alert('model')</script>",
      role: "frontend",
      tasksCompleted: 3,
    },
  ],
  beats: [
    {
      id: "T-1",
      ts: "+00:10",
      kind: "<svg onload=alert(1)>",
      taskId: "T-2",
      agentRef: "agent-1",
      actorRef: "member-1",
      title: "<script>alert('xss')</script> Implement page",
      detail: "javascript:alert(1)\n</p><script>alert(2)</script>",
      sensitivity: "process",
    },
  ],
  prUrl: [
    "javascript:alert('href')",
    "https://github.com/marblo-app/marblo/pull/735",
  ],
  credits: { mode: "credited", handle: "@melocream" },
});

function renderHostile(payload = HOSTILE_PAYLOAD): string {
  const view = parsePublicReplayDocument({
    schemaVersion: 1,
    replayVersion: 1,
    level: "L3",
    status: "published",
    payload,
    publishedAt: "2026-08-01T12:00:00.000Z",
  });
  assert.ok(view, "fixture must parse");
  return renderToStaticMarkup(
    <PublicReplayArticle replay={view} labels={LABELS} homeHref="/en" />
  );
}

/**
 * 이 컴포넌트가 만들 수 있는 태그 전부. 출력에 여기 없는 태그가 있다면 그건
 * **데이터가 태그가 됐다**는 뜻이고, 그게 정확히 F5 다.
 *
 * ★"문자열에 onerror= 가 없다" 식 검사는 부족할 뿐 아니라 틀린다: 올바르게
 * 이스케이프된 텍스트(`&lt;img src=x onerror=alert(1)&gt;`)에도 그 부분문자열은
 * 그대로 들어 있다. 위험한 것은 문자열의 등장이 아니라 **파서가 그것을 태그·
 * 속성으로 읽는가**이므로 구조로 검사한다.
 */
const ALLOWED_TAGS = new Set([
  "div",
  "header",
  "footer",
  "section",
  "h1",
  "h2",
  "p",
  "span",
  "ul",
  "ol",
  "li",
  "a",
]);

test("★F5 — 어떤 필드도 실행 가능한 마크업으로 나가지 않는다", () => {
  const html = renderHostile();

  // 1) 출력에 존재하는 태그가 전부 우리가 쓴 태그다(= 주입된 원소 0개).
  const tags = [...html.matchAll(/<\/?([a-zA-Z][^\s/>]*)/g)].map((m) =>
    m[1].toLowerCase()
  );
  const injected = [...new Set(tags)].filter((tag) => !ALLOWED_TAGS.has(tag));
  assert.deepEqual(injected, [], `주입된 태그: ${injected.join(", ")}`);

  // 2) 태그 **안쪽**에 이벤트 핸들러 속성이 없다(텍스트 안의 같은 문자열은 무해).
  assert.ok(
    !/<[^>]*\son[a-z]+\s*=/i.test(html),
    "이벤트 핸들러 속성이 렌더됐다"
  );

  // 3) href/src 속성값에 실행 스킴이 없다.
  assert.ok(
    !/(?:href|src)\s*=\s*"\s*(?:javascript|data|vbscript):/i.test(html),
    "실행 가능한 스킴이 속성으로 렌더됐다"
  );

  // 4) 내용은 **텍스트로** 살아 있다 — 조용히 지우는 게 아니라 이스케이프다.
  assert.ok(
    html.includes("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;")
  );
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&lt;svg onload=alert(1)&gt;"));
});

test("허용된 PR 링크만 href 가 된다", () => {
  const html = renderHostile();
  assert.ok(
    html.includes('href="https://github.com/marblo-app/marblo/pull/735"')
  );
  assert.equal((html.match(/href="https:\/\//g) ?? []).length, 1);
  assert.ok(html.includes('rel="noopener noreferrer nofollow ugc"'));
});

test("크레딧은 opt-in — 익명 payload 에는 핸들이 렌더되지 않는다", () => {
  const credited = renderHostile();
  assert.ok(credited.includes("@melocream"));
  assert.ok(credited.includes("Credited to"));

  const anonymous = renderHostile(
    JSON.stringify({
      goal: "anon mission",
      credits: { mode: "anonymous", handle: "@melocream" },
    })
  );
  assert.ok(!anonymous.includes("@melocream"), "익명인데 핸들이 샜다");
  assert.ok(!anonymous.includes("Credited to"));
});

test("드롭된 수치는 0 으로 채우지 않고 타일 자체를 그리지 않는다", () => {
  // L1/L2 에서 비용은 드롭된다(R14 기본 OFF).
  const html = renderHostile(
    JSON.stringify({ goal: "process only", stats: { tasksDone: 5 } })
  );
  assert.ok(html.includes("Tasks done"));
  assert.ok(!html.includes("Cost"), "없는 비용이 0 으로 그려졌다");
  assert.ok(!html.includes("Risk flags"));
});

test("★dangerouslySetInnerHTML 은 이 라우트에 존재하지 않는다", () => {
  // 이 레포의 다른 페이지는 JSON-LD 를 dangerouslySetInnerHTML 로 주입한다.
  // 그 관행이 이 라우트로 흘러들어오는 순간 goal 안의 "</script>" 가 곧바로
  // 스크립트 주입이 된다. 리뷰 관습이 아니라 테스트로 막는다.
  const files = [
    "src/components/PublicReplayArticle.tsx",
    "src/app/[locale]/replay/[replayId]/page.tsx",
    "src/lib/publicReplay.ts",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const occurrences = source.split("dangerouslySetInnerHTML").length - 1;
    // 주석에서 이 단어를 언급하는 것은 허용하되, JSX 속성으로 쓰이면 실패한다.
    assert.ok(
      !/dangerouslySetInnerHTML\s*=/.test(source),
      `${file} 에 dangerouslySetInnerHTML 사용이 있다`
    );
    assert.ok(
      occurrences <= 3,
      `${file} 의 언급이 과하다 — 실사용인지 확인 필요`
    );
  }
});

test("소요시간 포맷", () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(-1), null);
  assert.equal(formatDuration(45 * 60_000), "45m");
  assert.equal(formatDuration(3 * 3_600_000), "3h 0m");
  assert.equal(formatDuration(3 * 3_600_000 + 13 * 60_000), "3h 13m");
});
