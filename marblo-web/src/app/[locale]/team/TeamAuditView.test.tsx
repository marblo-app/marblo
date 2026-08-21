/**
 * 감사 탭 화면 규약을 렌더된 HTML 바이트로 확인한다 (설계 §12).
 *
 * 이 탭이 실패하는 방식:
 *   1. `disabled` 인데 목록/숫자를 그린다 — 또는 "프로젝트가 없습니다" 라고 써서
 *      **존재 여부를 누설한다.**
 *   2. `memberKey: null` 을 빈칸으로 둬서 정상 상태가 버그로 보인다.
 *   3. `withheld`(일부러 안 보여주는 것)를 안 그려서 사용자가 영영 못 본다.
 *   4. 결측을 0 으로 그린다.
 * ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildTeamCopy } from "./teamCopy";
import { TeamAuditView, ActorChip } from "./TeamAuditView";
import {
  normalizeTeamAudit,
  type TeamAuditEnvelope,
} from "./teamAuditContract";

const LOCALES = [
  { locale: "ko", copy: buildTeamCopy(ko.team) },
  { locale: "en", copy: buildTeamCopy(en.team) },
  { locale: "ja", copy: buildTeamCopy(ja.team) },
];

/**
 * ★서버 계약은 `{ code, text }` 다(§12.5.1). `text` 는 ko 문장이므로, 화면이
 *   그걸 그대로 그리면 en·ja 사용자가 한국어를 본다 — 아래 테스트가 그것을 막는다.
 */
const WITHHELD = [
  { code: "withheld_money", text: "금액·토큰 수치 전부 — 서버가 준 ko 원문" },
  { code: "withheld_raw_identity", text: "원시 uid·이메일 — 서버가 준 ko 원문" },
];

/** 코드가 없는 옛 모양(맨 문자열)도 화면에서 사라지면 안 된다. */
const WITHHELD_LEGACY = ["코드 없는 옛 줄"];

/**
 * 렌더 결과에서 텍스트만 남기고 엔티티를 되돌린다.
 *
 * ★문구 비교는 **반드시** 이 텍스트로 한다. React 가 작은따옴표를 `&#x27;` 로
 *   이스케이프하기 때문에, 원문(`copy.text[...]`)을 raw HTML 에 대고 `includes`
 *   하면 "project's" · "'모름'" 같은 문장이 **항상 불일치**한다. 그러면 검사가
 *   조용히 헛통과하거나(부정 검사) 헛실패한다(긍정 검사).
 */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** raw HTML(태그 모양 검사용)과 텍스트(문구 검사용)를 같이 돌려준다. */
function render(node: React.ReactElement): { html: string; text: string } {
  const html = renderToStaticMarkup(node);
  return { html, text: visibleText(html) };
}

function envComplete(
  overrides: Record<string, unknown> = {}
): TeamAuditEnvelope {
  return normalizeTeamAudit({
    generatedAt: "2026-08-21T09:00:00.000Z",
    projectId: "p1",
    projects: [{ id: "p1", name: "Marblo", role: "owner" }],
    teamAudit: {
      state: "complete",
      reasonCode: null,
      reason: null,
      scope: "team",
      role: "owner",
      projectsInScope: 1,
      basis: "project_event_ledger",
    },
    page: { limit: 50, returned: 2, nextCursor: "CURSOR_1", hasMore: true },
    summary: {
      eventsInWindow: 12,
      eventsByKind: { merge: 2, task_transition: 10 },
      tasksTotal: 8,
      tasksOpen: 3,
      tasksDone: 5,
      attentionCount: 1,
      criticalCount: 1,
      agentsTotal: 4,
      missionsTotal: 2,
      missionsActive: 1,
    },
    events: [
      {
        id: "ledger:1",
        kind: "task_transition",
        action: "update_task_status",
        at: "2026-08-21T08:00:00.000Z",
        atMs: 1,
        taskId: "t1",
        taskTitle: "팀 오버뷰 화면",
        memberKey: "tm_abcdef1234",
        agentId: "frontend-claude-6frj",
        success: true,
        merge: null,
      },
      {
        // ★행위자가 없는 머지 이력 행 — 정상이다(§12.7).
        id: "merge:2",
        kind: "merge",
        action: "merge_history",
        at: "2026-08-21T07:00:00.000Z",
        atMs: 0,
        taskId: null,
        taskTitle: null,
        memberKey: null,
        agentId: null,
        success: null,
        merge: {
          branch: "marblo/frontend",
          prNumber: 1105,
          filesChanged: null,
          linesAdded: 10,
          linesDeleted: 2,
        },
      },
    ],
    attention: [
      {
        id: "t9",
        title: "막힌 티켓",
        status: "BLOCKED",
        attention: { kinds: ["taskBlocked"], severity: "critical", idleMs: 1 },
      },
    ],
    workload: [
      {
        agentId: "a1",
        name: "frontend",
        model: "claude-opus-5",
        status: "working",
        openTasks: 1,
        doneTasks: 2,
      },
    ],
    withheld: WITHHELD,
    criteria: { stalledAfterHours: 6 },
    notes: [
      { code: "note_read_only", text: "읽기 전용이다 — 서버가 준 ko 원문" },
      { code: "note_stalled_threshold", text: "서버가 준 ko 원문" },
    ],
    ...overrides,
  });
}

// ── ★1. disabled — 목록도 숫자도 안 그린다 ─────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] disabled 면 목록·요약·숫자를 아예 안 그린다`, () => {
    const env = normalizeTeamAudit({
      teamAudit: {
        state: "disabled",
        reasonCode: "no_role",
        reason: "서버 산문",
        scope: "team",
        role: null,
        projectsInScope: 0,
        basis: "project_event_ledger",
      },
      // ★서버가 실수로 실어 보내도 그리지 않는다.
      summary: { eventsInWindow: 99, tasksOpen: 7 },
      events: [{ id: "e", kind: "merge", memberKey: "tm_abcdef12" }],
      withheld: WITHHELD,
    });
    const { html, text } = render(
      <TeamAuditView env={env} copy={copy} locale={locale} />
    );
    assert.ok(text.includes(copy.text["audit.disabled.title"]));
    assert.doesNotMatch(html, /99|\b7\b/);
    assert.ok(!text.includes(copy.text["audit.summary.title"]));
    assert.ok(!text.includes(copy.text["audit.events.title"]));
    // 사유는 코드 → 로케일 문장. 서버 산문이 아니라.
    assert.ok(text.includes(copy.reasons["no_role"]));
    assert.ok(!text.includes("서버 산문"));
  });

  test(`[${locale}] disabled 문구가 프로젝트 존재 여부를 말하지 않는다`, () => {
    // ★"프로젝트가 없습니다" 는 권한 없음과 존재하지 않음을 갈라 말하는 것이라
    //   서버가 일부러 감춘 사실을 화면이 누설하는 셈이 된다.
    const text = visibleText(
      renderToStaticMarkup(
        <TeamAuditView
          env={normalizeTeamAudit({
            teamAudit: {
              state: "disabled",
              reasonCode: "no_role",
              scope: "team",
              role: null,
              projectsInScope: 0,
              basis: "project_event_ledger",
            },
          })}
          copy={copy}
          locale={locale}
        />
      )
    );
    // no_project 사유 문구가 no_role 자리에 새어 나오면 안 된다.
    assert.ok(!text.includes(copy.reasons["no_project"]));
  });
}

// ── ★2. 행위자 null 은 '알 수 없음' 이다 (빈칸 아님) ────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 행위자 없는 머지 행은 '알 수 없음' 으로 그려진다`, () => {
    const { html, text } = render(
      <ActorChip copy={copy} memberKey={null} />
    );
    assert.ok(text.includes(copy.text["audit.actor.unknown"]));
    assert.ok(visibleText(html).trim() !== "", "빈칸으로 두면 버그로 보인다");
  });

  test(`[${locale}] 가명은 앞부분만, 원시 키는 DOM 에 없다`, () => {
    const { html } = render(
      <ActorChip copy={copy} memberKey="tm_abcdef1234" />
    );
    assert.ok(html.includes("abcdef"));
    assert.doesNotMatch(html, /tm_abcdef1234/);
  });

  test(`[${locale}] 피드 위에 가명·행위자 부재 고지가 먼저 온다`, () => {
    const { text } = render(
      <TeamAuditView env={envComplete()} copy={copy} locale={locale} />
    );
    const note = text.indexOf(copy.text["audit.actor.pseudonymNote"]);
    const firstRow = text.indexOf(copy.text["audit.kind.task_transition"]);
    assert.ok(note >= 0, "고지가 있어야 한다");
    assert.ok(firstRow > note, "고지가 피드보다 앞에 있어야 한다");
  });
}

// ── ★3. withheld 를 그대로 그린다 ───────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 서버가 실어 보낸 '안 보여주는 것' 목록을 그대로 찍는다`, () => {
    const { text } = render(
      <TeamAuditView env={envComplete()} copy={copy} locale={locale} />
    );
    assert.ok(text.includes(copy.text["audit.withheld.title"]));
    // ★코드로 번역된 문장이 나와야 한다 — 서버가 준 ko 원문이 아니라.
    for (const line of WITHHELD) {
      assert.ok(
        text.includes(copy.reasons[line.code]),
        `${line.code} 가 ${locale} 문장으로 그려져야 한다`
      );
      if (locale !== "ko") {
        assert.ok(
          !text.includes(line.text),
          `${locale} 화면에 서버 ko 원문이 그대로 뜨면 안 된다`
        );
      }
    }
  });

  test(`[${locale}] 참고(notes)도 코드로 번역된다`, () => {
    const { text } = render(
      <TeamAuditView env={envComplete()} copy={copy} locale={locale} />
    );
    assert.ok(text.includes(copy.reasons["note_read_only"]));
    if (locale !== "ko") {
      assert.ok(!text.includes("읽기 전용이다 — 서버가 준 ko 원문"));
    }
  });

  test(`[${locale}] 코드 없는 옛 모양 줄도 사라지지 않는다`, () => {
    const { text } = render(
      <TeamAuditView
        env={envComplete({ withheld: WITHHELD_LEGACY })}
        copy={copy}
        locale={locale}
      />
    );
    // 목록이 통째로 비면 화면이 "숨긴 것이 없다" 고 말하는 셈이 된다.
    assert.ok(text.includes("코드 없는 옛 줄"));
  });

  test(`[${locale}] 감사 탭에 금액 칸이 없고, 없는 이유를 화면이 말한다`, () => {
    const { html, text } = render(
      <TeamAuditView env={envComplete()} copy={copy} locale={locale} />
    );
    // ★금액 라벨(사용량 탭 것)이 감사 탭에 새어 들어오면 게이트 우회다.
    assert.ok(!text.includes(copy.text["money.label"]));
    assert.doesNotMatch(visibleText(html), /\$\d/);
    assert.ok(text.includes(copy.text["audit.noMoneyNote"]));
  });
}

// ── ★4. 결측은 0 이 아니다 ──────────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 요약 결측은 0 이 아니라 '모름' 으로 그려진다`, () => {
    const env = envComplete({ summary: { tasksOpen: 3 } });
    const { text } = render(
      <TeamAuditView env={env} copy={copy} locale={locale} />
    );
    const unknown = copy.text["audit.unknown"];
    const count = text.split(unknown).length - 1;
    assert.ok(
      count >= 5,
      `'${unknown}' 이 ${count}회 — 결측 칸마다 있어야 한다`
    );
  });

  test(`[${locale}] 머지 파일수 결측이 0 으로 그려지지 않는다`, () => {
    const { text } = render(
      <TeamAuditView env={envComplete()} copy={copy} locale={locale} />
    );
    // filesChanged: null 인 행이 있다 — "파일 0개" 로 읽히면 안 된다.
    const zeroFiles = copy.text["audit.merge.files"].replace("{value}", "0");
    assert.ok(!text.includes(zeroFiles));
  });
}

// ── empty / partial ─────────────────────────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 빈 피드는 0 이 아니라 빈 상태로 그려진다`, () => {
    const env = normalizeTeamAudit({
      teamAudit: {
        state: "empty",
        reasonCode: "no_events",
        scope: "team",
        role: "owner",
        projectsInScope: 1,
        basis: "project_event_ledger",
      },
      page: { hasMore: false, nextCursor: null },
      summary: {
        eventsInWindow: 0,
        tasksTotal: 0,
        tasksOpen: 0,
        tasksDone: 0,
        attentionCount: 0,
        criticalCount: 0,
        agentsTotal: 0,
        missionsTotal: 0,
        missionsActive: 0,
        mergesTotal: 0,
      },
      events: [],
      withheld: WITHHELD,
    });
    const { html, text } = render(
      <TeamAuditView env={env} copy={copy} locale={locale} />
    );
    assert.ok(text.includes(copy.text["audit.empty.title"]));
    assert.ok(text.includes(copy.reasons["no_events"]));
    assert.doesNotMatch(html, /undefined|NaN|\[object/);
    // ★빈 표를 그리지 않는다.
    assert.doesNotMatch(html, /<tbody>\s*<\/tbody>/);
  });

  test(`[${locale}] partial 은 목록 위에 '전부가 아니다' 를 먼저 말한다`, () => {
    const env = envComplete({
      teamAudit: {
        state: "partial",
        reasonCode: "partial_sources",
        reason: null,
        scope: "team",
        role: "owner",
        projectsInScope: 1,
        basis: "project_event_ledger",
      },
    });
    const { text } = render(
      <TeamAuditView env={env} copy={copy} locale={locale} />
    );
    const banner = text.indexOf(copy.text["audit.partial.badge"]);
    const feed = text.indexOf(copy.text["audit.events.title"]);
    assert.ok(banner >= 0 && feed > banner);
    assert.ok(text.includes(copy.reasons["partial_sources"]));
  });

  test(`[${locale}] 봉투가 없으면 사건 0건이 아니라 '미배선' 이다`, () => {
    const { html, text } = render(
      <TeamAuditView
        env={normalizeTeamAudit(undefined)}
        copy={copy}
        locale={locale}
      />
    );
    assert.ok(text.includes(copy.text["cell.unwiredBadge"]));
    assert.doesNotMatch(html, /undefined|NaN|\[object/);
  });
}

// ── ★'정체' 기준 숫자는 문구가 아니라 값에서 온다 ───────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] criteria 가 오면 기준 시간이 문장에 끼워진다`, () => {
    const { text } = render(
      <TeamAuditView env={envComplete()} copy={copy} locale={locale} />
    );
    const expected = copy.reasons["note_stalled_threshold_hours"].replace(
      "{hours}",
      "6"
    );
    assert.ok(text.includes(expected), "기준 시간이 값에서 와야 한다");
    // ★자리표시자가 그대로 새면 안 된다.
    assert.ok(!text.includes("{hours}"));
  });

  test(`[${locale}] criteria 가 없으면 숫자 없는 문장으로 떨어진다`, () => {
    const { text } = render(
      <TeamAuditView
        env={envComplete({ criteria: null })}
        copy={copy}
        locale={locale}
      />
    );
    assert.ok(text.includes(copy.reasons["note_stalled_threshold"]));
    assert.ok(!text.includes("{hours}"));
    // 서버가 준 ko 원문이 아니라 로케일 문장이어야 한다.
    if (locale !== "ko") assert.ok(!text.includes("서버가 준 ko 원문"));
  });
}

// ── ★타일이 목록과 어긋나지 않는다 ─────────────────────────────────────────

test("머지 타일은 사건 피드와 같은 출처를 쓴다", () => {
  const copy = buildTeamCopy(ko.team);
  // self 스코프에서 실제로 나던 모양: 프로젝트 전체 머지는 12건인데 피드엔 0건.
  const env = envComplete({
    summary: {
      eventsInWindow: 10,
      eventsByKind: { merge: 0, task_transition: 10 },
      tasksOpen: 3,
      tasksDone: 5,
      attentionCount: 1,
      criticalCount: 1,
      agentsTotal: 1,
      missionsTotal: 2,
      missionsActive: 1,
      mergesTotal: 12,
    },
  });
  const { text } = render(
    <TeamAuditView env={env} copy={copy} locale="ko" />
  );
  // ★"머지 12" 가 화면에 뜨면 안 된다 — 피드가 뒷받침하지 않는 숫자다.
  assert.ok(!text.includes("12"));
});

test("주의·에이전트 타일은 화면에 보이는 목록과 같은 수를 말한다", () => {
  const copy = buildTeamCopy(ko.team);
  // 서버가 불변식을 깬 응답. 화면은 스스로와 모순되면 안 된다.
  const env = envComplete({
    summary: {
      eventsInWindow: 2,
      eventsByKind: { merge: 1, task_transition: 1 },
      tasksOpen: 1,
      tasksDone: 1,
      attentionCount: 7,
      criticalCount: 7,
      agentsTotal: 9,
      missionsTotal: 1,
      missionsActive: 1,
    },
  });
  const { text } = render(
    <TeamAuditView env={env} copy={copy} locale="ko" />
  );
  // 목록은 주의 1건 · 에이전트 1개다(envComplete). 7·9 가 뜨면 화면이 거짓말한다.
  assert.ok(!text.includes("7"));
  assert.ok(!text.includes("9"));
});

// ── self 스코프 정직성 ──────────────────────────────────────────────────────

test("self 스코프면 '사건만 좁혀졌다' 는 사실을 화면이 말한다", () => {
  const copy = buildTeamCopy(ko.team);
  const env = envComplete({
    teamAudit: {
      state: "complete",
      reasonCode: null,
      reason: null,
      scope: "self",
      role: "member",
      projectsInScope: 1,
      basis: "project_event_ledger",
    },
  });
  const { text } = render(
    <TeamAuditView env={env} copy={copy} locale="ko" />
  );
  assert.ok(text.includes(copy.text["audit.scope.selfNote"]));
  // 서버 notes 도 코드로 번역해 그린다.
  assert.ok(text.includes(copy.reasons["note_read_only"]));
});

// ── 기준 라벨 / 더 보기 ─────────────────────────────────────────────────────

test("목록에도 기준 라벨이 붙고, 식별자가 아니라 사람 말로 그린다", () => {
  const copy = buildTeamCopy(ko.team);
  const { text } = render(
    <TeamAuditView env={envComplete()} copy={copy} locale="ko" />
  );
  assert.ok(text.includes(copy.basisValues["project_event_ledger"]));
  assert.ok(!text.includes("project_event_ledger"));
});

test("모르는 basis 값도 라벨이 사라지지 않고 원문으로 그려진다", () => {
  // ★사전에 없다고 배지가 비면 "라벨 없는 목록" 이 된다. 원문이라도 남긴다.
  const copy = buildTeamCopy(ko.team);
  const env = envComplete({
    teamAudit: {
      state: "complete",
      reasonCode: null,
      reason: null,
      scope: "team",
      role: "owner",
      projectsInScope: 1,
      basis: "brand_new_basis",
    },
  });
  const { text } = render(
    <TeamAuditView env={env} copy={copy} locale="ko" />
  );
  assert.ok(text.includes("brand_new_basis"));
});

// ── ★'가려짐' 과 '없음' 은 다른 칸이다 ──────────────────────────────────────

for (const { locale, copy } of LOCALES) {
  test(`[${locale}] 가려진 담당자와 담당자 없음을 다른 말로 그린다`, () => {
    const env = envComplete({
      workload: [
        // 서버가 값 수준에서 가린 자리
        { agentId: "(가려짐)", name: null, openTasks: 1, doneTasks: 0 },
        // 값이 아예 없는 자리
        { agentId: "backend-1", name: null, openTasks: 0, doneTasks: 0 },
      ],
    });
    const { text } = render(
      <TeamAuditView env={env} copy={copy} locale={locale} />
    );
    assert.ok(text.includes(copy.text["audit.actor.redacted"]));
    assert.notEqual(
      copy.text["audit.actor.redacted"],
      copy.text["audit.unknown"],
      "'가려짐' 과 '모름' 이 같은 말이면 두 사실이 합쳐진다"
    );
    // 정상 이름은 가리지 않는다.
    assert.ok(text.includes("backend-1"));
  });

  test(`[${locale}] 이메일 이름 에이전트는 가려지되 행은 남는다`, () => {
    const env = envComplete({
      workload: [
        {
          agentId: "john.kim@hypemarc.com",
          name: "john.kim@hypemarc.com",
          openTasks: 3,
          doneTasks: 1,
        },
      ],
    });
    const { text } = render(
      <TeamAuditView env={env} copy={copy} locale={locale} />
    );
    assert.ok(!text.includes("@hypemarc.com"));
    assert.ok(text.includes(copy.text["audit.actor.redacted"]));
    // ★행을 버리지 않는다 — 감사에서 조용한 누락이 가장 나쁜 실패다.
    assert.ok(text.includes("3"));
  });
}

test("더 보기는 커서가 있을 때만 뜨고, 없으면 '피드 끝' 이다", () => {
  const copy = buildTeamCopy(ko.team);
  const { text: withMore } = render(
    <TeamAuditView
      env={envComplete()}
      copy={copy}
      locale="ko"
      onLoadMore={() => {}}
    />
  );
  assert.ok(withMore.includes(copy.text["audit.page.more"]));

  const { text: noMore } = render(
    <TeamAuditView
      env={envComplete()}
      copy={copy}
      locale="ko"
      onLoadMore={null}
    />
  );
  assert.ok(noMore.includes(copy.text["audit.page.end"]));
  assert.ok(!noMore.includes(copy.text["audit.page.more"]));
});

// ── ★위양성 짝 — 이 파일의 부정 검사들이 살아 있는지 확인한다 ────────────────
//
// 부정 검사(`~가 없다`)는 검사 자체가 죽어도 초록이다. 이 파일의 "'청구' 는
// 부인문 안에서만" 류 검사는 **`visibleText` 가 엔티티를 되돌린다는 전제**에
// 얹혀 있다. 그 전제가 깨지면(누가 복원을 지우면) 원문과 렌더 결과가 영영
// 안 맞아 검사가 조용히 통과한다 — 초록인데 아무것도 안 보는 상태다.
//
// 그래서 전제를 직접 검사한다: 작은따옴표가 든 문구는 **raw HTML 에는 없고**
// **복원된 텍스트에는 있어야** 한다.
test("★위양성 짝: 엔티티 복원이 없으면 문구 검사가 죽는다", () => {
  const copy = buildTeamCopy(ko.team);
  const bait = copy.reasons["partial_sources"];
  assert.ok(bait.includes("'"), "미끼 문구에 작은따옴표가 있어야 의미가 있다");

  const { html, text } = render(<TeamAuditView
      env={envComplete({
        teamAudit: {
          state: "partial",
          reasonCode: "partial_sources",
          reason: null,
          scope: "team",
          role: "owner",
          projectsInScope: 1,
          basis: "project_event_ledger",
        },
      })}
      copy={copy}
      locale="ko"
    />);

  // React 가 ' 를 &#x27; 로 이스케이프하므로 raw HTML 에는 원문이 없다.
  assert.ok(
    !html.includes(bait),
    "raw HTML 비교가 성립하면 이 짝 검사가 무의미하다"
  );
  // 복원된 텍스트에는 있다 — 다른 검사들이 이걸 딛고 선다.
  assert.ok(text.includes(bait), "엔티티 복원이 동작해야 한다");
});
