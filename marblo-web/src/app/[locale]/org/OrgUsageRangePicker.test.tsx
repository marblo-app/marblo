/**
 * ★조회 기간 선택자가 실제로 동작한다(티켓 jNWaeaazqJYNImWs4BXO, 사장님 지시).
 *
 * "선택지가 있다" 와 "골라서 콜백이 정확한 값으로 나간다" 는 다른 명제다 —
 * 앞의 것은 `renderToStaticMarkup` 으로 되지만 뒤의 것은 마운트해서 조작해야
 * 한다(`OrgUsageRetry.test.tsx` 와 같은 규약).
 *
 * ★이 파일이 고정하는 것 넷:
 *   1. 프리셋을 고르면 그 값 그대로 콜백이 나간다.
 *   2. "시작일 지정" 을 고르면 날짜 입력이 나타나고, 날짜를 고르면 올바른
 *      일수로 환산돼 콜백이 나간다.
 *   3. 날짜 입력이 365일보다 먼 과거를 애초에 못 고르게 막는다(`min` 속성).
 *   4. "요청한 구간" 과 "실제 조회된 구간" 이 다르면(게이트로 잘렸으면) 그
 *      사실이 화면에 뜬다 — 다르지 않으면 안 뜬다.
 *
 * ★jsdom 은 브라우저 GUI 가 아니라 DOM 구현체다. Playwright·Electron 은 안 띄운다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../../components/charts/testEnv";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildOrgCopy } from "./orgCopy";
import { buildTeamCopy } from "../team/teamCopy";
import { OrgUsageSection } from "./OrgUsageView";
import {
  computeRequestedFromDay,
  minCustomStartDay,
  normalizeOrgUsage,
  utcDayOf,
  type OrgUsageData,
} from "./orgUsageContract";

const LOCALES = [
  {
    locale: "ko",
    copy: buildOrgCopy(ko.org),
    teamCopy: buildTeamCopy(ko.team),
  },
  {
    locale: "en",
    copy: buildOrgCopy(en.org),
    teamCopy: buildTeamCopy(en.team),
  },
  {
    locale: "ja",
    copy: buildOrgCopy(ja.org),
    teamCopy: buildTeamCopy(ja.team),
  },
] as const;

const NOW = Date.parse("2026-09-07T01:00:00.000Z");

function loadedData(windowFromDay: string, windowToDay: string): OrgUsageData {
  const data = normalizeOrgUsage({
    restricted: false,
    rangeDays: 30,
    generatedAt: new Date(NOW).toISOString(),
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 900 },
    teamUsage: {
      state: "complete",
      disabledReason: null,
      disabledReasonCode: null,
      effectiveFrom: "2026-04-01",
      basis: "account_ledger",
      basisLabel: "로그인한 계정 기준으로 집계합니다.",
      costLabel: "사용량 환산 비용(추정)",
      costNotBillingNote: "청구액이 아닙니다.",
      scope: "team",
      projectsInScope: 1,
      projectsOmitted: 0,
      projectsTruncatedNote: null,
      fromDay: windowFromDay,
      toDayExclusive: (() => {
        const d = new Date(`${windowToDay}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })(),
    },
    orchestratorAxis: {
      state: "not_collected",
      reason: null,
      reasonCode: "orchestrator_not_collected",
      collectingSince: null,
      legacySegment: null,
    },
    totals: {
      costUsd: 5,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      tokens: 15,
    },
    byDay: [],
    byMember: [],
    byProject: [
      {
        projectId: "p1",
        projectName: "프로젝트-A",
        costUsd: 5,
        tokens: 15,
        teamId: null,
        teamDisplayName: null,
      },
    ],
    byTeam: [
      {
        teamId: null,
        teamDisplayName: null,
        costUsd: 5,
        tokens: 15,
        projects: 1,
      },
    ],
    byModel: [],
    byActorKind: [],
    coverage: { rowsInWindow: 2 },
  });
  assert.equal(data.kind, "data");
  return data;
}

async function mountPicker(
  entry: typeof LOCALES[number],
  days: number,
  onChange: (days: number) => void,
  windowFromDay = computeRequestedFromDay(NOW, days),
  windowToDay = utcDayOf(NOW)
) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrgUsageSection
        copy={entry.copy}
        teamCopy={entry.teamCopy}
        locale={entry.locale}
        now={NOW}
        state={{ kind: "loaded", data: loadedData(windowFromDay, windowToDay) }}
        range={{ days, onChange }}
      />
    );
  });
  return { host, act };
}

function setNativeValue(
  el: HTMLInputElement | HTMLSelectElement,
  value: string
) {
  const proto =
    el.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  assert.ok(setter, "네이티브 value setter 를 못 찾았다");
  setter!.call(el, value);
}

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★프리셋을 고르면 그 값 그대로 콜백이 나간다`, async () => {
    let lastDays: number | null = null;
    const { host, act } = await mountPicker(entry, 30, (d) => {
      lastDays = d;
    });
    const select = host.querySelector<HTMLSelectElement>("select");
    assert.ok(select, "기간 선택자가 없다");
    assert.equal(select!.value, "30", "초기 선택값이 현재 days 와 다르다");
    await act(async () => {
      setNativeValue(select!, "90");
      select!.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.equal(lastDays, 90, "프리셋 변경이 콜백에 그대로 안 나갔다");
  });

  test(`[${entry.locale}] ★"시작일 지정" 을 고르면 날짜 입력이 나타난다`, async () => {
    const { host, act } = await mountPicker(entry, 30, () => {});
    assert.equal(
      host.querySelector('input[type="date"]'),
      null,
      "고르기 전인데 날짜 입력이 이미 있다"
    );
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      setNativeValue(select, "custom");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.ok(
      host.querySelector('input[type="date"]'),
      "시작일 지정을 골랐는데 날짜 입력이 안 나타났다"
    );
  });

  test(`[${entry.locale}] ★날짜를 고르면 올바른 일수로 환산돼 콜백이 나간다`, async () => {
    // ★"시작일 지정" 을 처음 고른 순간 날짜 입력의 기본값은 현재 days(90)
    //   에 해당하는 날짜다. 그 값과 **다른** 날짜를 골라야 진짜 변경이다 —
    //   같은 값을 다시 세팅하면 리액트의 제어 입력 값 추적기가 "안 바뀐 값"
    //   으로 보고 change 를 안 낸다(실측으로 잡은 함정 — days:30 으로 두고
    //   그 30일 환산 날짜를 그대로 다시 넣었더니 콜백이 한 번도 안 불렸다).
    let lastDays: number | null = null;
    const { host, act } = await mountPicker(entry, 90, (d) => {
      lastDays = d;
    });
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      setNativeValue(select, "custom");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const dateInput =
      host.querySelector<HTMLInputElement>('input[type="date"]')!;
    assert.notEqual(
      dateInput.value,
      "2026-08-09",
      "테스트 전제가 깨졌다 — 기본값이 이미 목표 날짜와 같다"
    );
    await act(async () => {
      setNativeValue(dateInput, "2026-08-09"); // 2026-09-07 기준 30일 전
      dateInput.dispatchEvent(new window.Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.equal(lastDays, 30, "시작일 → 일수 환산이 서버 산수와 다르다");
  });

  test(`[${entry.locale}] ★날짜 입력이 365일보다 먼 과거를 막는다`, async () => {
    const { host } = await mountPicker(entry, 365, () => {});
    const select = host.querySelector<HTMLSelectElement>("select")!;
    assert.equal(select.value, "365");
    // 365 는 프리셋이라 날짜 입력이 안 뜬다 — custom 으로 전환해 min 을 본다.
    const { act } = await import("react");
    await act(async () => {
      setNativeValue(select, "custom");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const dateInput =
      host.querySelector<HTMLInputElement>('input[type="date"]')!;
    assert.equal(dateInput.min, minCustomStartDay(NOW));
    assert.equal(dateInput.max, utcDayOf(NOW));
  });

  test(`[${entry.locale}] ★요청한 구간과 실제 조회된 구간이 다르면 그 사실이 뜬다`, async () => {
    // 365일을 요청했지만(2025-09-08 부터여야 함) 게이트가 접어 실제로는
    // 2026-04-01 부터만 왔다 — 오케가 속았던 바로 그 시나리오.
    const { host } = await mountPicker(
      entry,
      365,
      () => {},
      "2026-04-01",
      "2026-09-07"
    );
    assert.ok(
      host.textContent?.includes(
        entry.copy.text["usage.range.clamped"].replace("{date}", "2026-04-01")
      ),
      "잘렸다는 사실이 화면에 없다"
    );
  });

  test(`[${entry.locale}] ★요청한 구간과 실제 조회된 구간이 같으면 그 문구가 안 뜬다`, async () => {
    const { host } = await mountPicker(entry, 30, () => {});
    const clampedTemplate = entry.copy.text["usage.range.clamped"];
    const staticPart = clampedTemplate.split("{date}")[0];
    assert.ok(
      !host.textContent?.includes(staticPart),
      "안 잘렸는데 잘렸다는 문구가 떴다"
    );
  });
}
