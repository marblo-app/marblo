/**
 * 사용량 에러 카드에서 **다시 시도가 실제로 눌린다**(감사 #1495 P1-5).
 *
 * ★"버튼이 있다" 와 "눌러서 콜러블이 다시 나간다" 는 다른 명제다. 앞의 것은
 *   `renderToStaticMarkup` 으로 되지만 뒤의 것은 마운트해서 눌러 봐야 한다.
 *   이 파일은 뒤의 것을 고정한다 — 콜백이 정확히 몇 번 불렸는지를 센다.
 *
 * ★`onRetry` 를 안 주면 버튼을 안 그리는 것도 같이 고정한다. 누를 데가 없는
 *   버튼을 그리면 "눌렀는데 아무 일도 안 난다" 가 되고, 그건 에러보다 나쁘다.
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

const LOCALES = [
  { locale: "ko", msgs: ko },
  { locale: "en", msgs: en },
  { locale: "ja", msgs: ja },
] as const;

const NOW = Date.parse("2026-09-06T01:00:00.000Z");

async function mountError(
  entry: (typeof LOCALES)[number],
  onRetry?: () => void,
) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { OrgUsageSection } = await import("./OrgUsageView");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OrgUsageSection
        copy={buildOrgCopy(entry.msgs.org)}
        teamCopy={buildTeamCopy(entry.msgs.team)}
        locale={entry.locale}
        now={NOW}
        state={onRetry ? { kind: "error", onRetry } : { kind: "error" }}
      />,
    );
  });
  const click = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  };
  return { host, click };
}

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★에러 카드의 다시 시도가 콜백을 부른다 — 복구 경로가 카드 안에 있다`, async () => {
    let retries = 0;
    const { host, click } = await mountError(entry, () => retries++);
    const btn = host.querySelector("button");
    assert.ok(btn, "에러 카드에 다시 시도 버튼이 없다");
    assert.equal(
      btn.textContent?.trim(),
      buildOrgCopy(entry.msgs.org).text["action.retry"],
      "버튼 문구가 사전의 action.retry 가 아니다",
    );
    await click(btn);
    assert.equal(retries, 1, "눌렀는데 콜러블 재호출이 안 나갔다");
    await click(btn);
    assert.equal(retries, 2, "두 번째 시도가 막혔다");
  });

  test(`[${entry.locale}] ★에러 문구는 그대로 남는다 — 버튼이 사유를 밀어내지 않는다`, async () => {
    const { host } = await mountError(entry, () => {});
    const copy = buildOrgCopy(entry.msgs.org);
    assert.match(
      host.textContent ?? "",
      new RegExp(
        copy.text["usage.error"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
      "에러 사유가 사라졌다",
    );
  });
}

test("★onRetry 가 없으면 버튼을 그리지 않는다 — 누를 데 없는 버튼 금지", async () => {
  const { host } = await mountError(LOCALES[0]);
  assert.equal(
    host.querySelector("button"),
    null,
    "복구 경로가 없는데 버튼을 그렸다",
  );
});
