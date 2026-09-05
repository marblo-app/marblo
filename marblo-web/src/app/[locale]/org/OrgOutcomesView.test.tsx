/**
 * ★조직 작업 성과(완료·실패) 화면 규약을 **렌더된 HTML 바이트로** 확인한다
 * (`OrgUsageView.test.tsx` 와 같은 규약). 이 화면이 실패하는 방식은 넷이다:
 *   1. 결합 0건과 "결합은 있는데 권한이 없다" 가 같은 문장으로 뭉개진다.
 *   2. 성공률이 분모 없이 그려진다.
 *   3. 제외·상한 절단이 조용히 넘어간다.
 *   4. 실패 많은 팀이 표 순서로 안 먼저 보인다.
 * ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildOrgCopy } from "./orgCopy";
import { OrgOutcomesSection } from "./OrgOutcomesView";
import type { OrgOutcomesData } from "./orgOutcomesContract";

const LOCALES = [
  { locale: "ko", copy: buildOrgCopy(ko.org) },
  { locale: "en", copy: buildOrgCopy(en.org) },
  { locale: "ja", copy: buildOrgCopy(ja.org) },
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function render(entry: typeof LOCALES[number], data: OrgOutcomesData): string {
  return renderToStaticMarkup(
    <OrgOutcomesSection
      copy={entry.copy}
      locale={entry.locale}
      state={{ kind: "loaded", data }}
    />
  );
}

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★결합 0건 — "권한 없음" 과 다른 문장`, () => {
    const html = render(entry, { kind: "noBindings" });
    assert.ok(html.includes(esc(entry.copy.text["outcomes.noBindings.title"])));
    assert.ok(html.includes(esc(entry.copy.text["outcomes.noBindings.body"])));
    assert.ok(!html.includes(esc(entry.copy.text["outcomes.noAccess.title"])));
  });

  test(`[${entry.locale}] ★결합은 있는데 전부 권한 밖 — attempted 수를 밝힌다`, () => {
    const html = render(entry, { kind: "noAccess", attempted: 5 });
    assert.ok(html.includes(esc(entry.copy.text["outcomes.noAccess.title"])));
    const expectedBody = entry.copy.text["outcomes.noAccess.body"].replace(
      "{n}",
      "5"
    );
    assert.ok(
      html.includes(esc(expectedBody)),
      "시도한 프로젝트 수(5)가 문장에 없다"
    );
  });

  test(`[${entry.locale}] ★성공률은 분모(완료·실패)와 함께 나온다`, () => {
    const html = render(entry, {
      kind: "data",
      generatedAt: "2026-09-05T00:00:00.000Z",
      tasksDone: 180,
      tasksFailed: 20,
      tasksOpen: 4,
      byTeam: [
        {
          teamId: "t1",
          teamDisplayName: "플랫폼팀",
          tasksDone: 180,
          tasksFailed: 20,
          tasksOpen: 4,
          projects: 2,
        },
      ],
      includedProjects: 2,
      excludedProjects: 0,
      cappedOmitted: 0,
      hasPartialSource: false,
    });
    assert.ok(html.includes("90%"), "성공률 숫자가 없다");
    const denom = entry.copy.text["outcomes.rate.denominator"]
      .replace("{done}", "180")
      .replace("{failed}", "20");
    assert.ok(
      html.includes(esc(denom)),
      "분모 문장이 없다 — 5중5와 200중180을 못 가른다"
    );
  });

  test(`[${entry.locale}] ★완료·실패가 둘 다 0 이면 성공률이 아니라 '아직 판정 안 됨'`, () => {
    const html = render(entry, {
      kind: "data",
      generatedAt: null,
      tasksDone: 0,
      tasksFailed: 0,
      tasksOpen: 6,
      byTeam: [],
      includedProjects: 1,
      excludedProjects: 0,
      cappedOmitted: 0,
      hasPartialSource: false,
    });
    assert.ok(!html.includes("0%"), "분모 0인데 0% 로 그려졌다");
    assert.ok(html.includes(esc(entry.copy.text["outcomes.rate.none"])));
  });

  test(`[${entry.locale}] ★제외·상한 절단이 조용히 넘어가지 않는다`, () => {
    const html = render(entry, {
      kind: "data",
      generatedAt: null,
      tasksDone: 1,
      tasksFailed: 0,
      tasksOpen: 0,
      byTeam: [],
      includedProjects: 1,
      excludedProjects: 3,
      cappedOmitted: 5,
      hasPartialSource: false,
    });
    const excluded = entry.copy.text["outcomes.excludedNote"].replace(
      "{n}",
      "3"
    );
    assert.ok(html.includes(esc(excluded)), "제외 3건이 안 밝혀졌다");
    assert.ok(html.includes("(5)"), "상한 절단 5건이 안 밝혀졌다");
  });

  test(`[${entry.locale}] ★실패 많은 팀이 표에서 먼저 나온다`, () => {
    const html = render(entry, {
      kind: "data",
      generatedAt: null,
      tasksDone: 60,
      tasksFailed: 8,
      tasksOpen: 0,
      byTeam: [
        {
          teamId: "noisy",
          teamDisplayName: "말썽팀",
          tasksDone: 10,
          tasksFailed: 8,
          tasksOpen: 0,
          projects: 1,
        },
        {
          teamId: "quiet",
          teamDisplayName: "조용팀",
          tasksDone: 50,
          tasksFailed: 0,
          tasksOpen: 0,
          projects: 1,
        },
      ],
      includedProjects: 2,
      excludedProjects: 0,
      cappedOmitted: 0,
      hasPartialSource: false,
    });
    const noisyAt = html.indexOf("말썽팀");
    const quietAt = html.indexOf("조용팀");
    assert.ok(noisyAt >= 0 && quietAt >= 0);
    assert.ok(noisyAt < quietAt, "실패 많은 팀이 먼저 안 나온다");
  });

  test(`[${entry.locale}] 부분 스캔 배너 + 산정 기준 문장이 항상 뜬다`, () => {
    const html = render(entry, {
      kind: "data",
      generatedAt: null,
      tasksDone: 1,
      tasksFailed: 0,
      tasksOpen: 0,
      byTeam: [],
      includedProjects: 1,
      excludedProjects: 0,
      cappedOmitted: 0,
      hasPartialSource: true,
    });
    assert.ok(html.includes(esc(entry.copy.text["outcomes.partialNote"])));
    assert.ok(html.includes(esc(entry.copy.text["outcomes.basisNote"])));
  });
}
