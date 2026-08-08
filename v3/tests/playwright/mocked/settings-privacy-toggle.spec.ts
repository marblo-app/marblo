import { test, expect } from "../helpers/fixtures";

test.use({ marbloOptions: { mock: true } });

/**
 * Privacy 토글의 "핀 나감" 회귀 가드 (티켓 8lYqKIYj).
 *
 * 두 겹의 원인이 있었다:
 *   1. 버튼에 `flex-shrink-0` 이 없었다. 형제 라벨이 flex-1(basis 0) 이라 좁은
 *      창의 축소분을 토글이 **전부** 흡수하는데, 노브는 absolute 고정폭이라 같이
 *      줄지 않는다 → 트랙만 찌그러지고 노브가 밖으로 나간다.
 *   2. 노브에 `left` 앵커가 없어 x 가 abspos 의 static position 에서 왔는데,
 *      버튼 기본 `text-align:center` 탓에 그 값이 0 이 아니다(실측 4px). 그 4px 이
 *      translate 에 더해져 ON 상태 노브가 트랙 오른쪽으로 밀려났다.
 *
 * 단언은 스크린샷이 아니라 **기하와 계산된 스타일**이다:
 *   (1) 축소 계수가 0 인가 — 좁은 창에서 트랙이 찌그러질 수 있는지의 직접 판정.
 *   (2) ON/OFF 양쪽에서 노브가 트랙 사각형 안에 있는가.
 * 창을 실제로 줄이지 않는 이유는, Electron 창 리사이즈가 셸 레이아웃 분기를
 * 건드려 이 검사와 무관한 이유로 패널이 사라지기 때문이다.
 */
const TOGGLES = ["privacy-toggle-firstPartyTelemetry", "privacy-toggle-sentry"];

test("@mocked Privacy 토글: 축소되지 않고 노브가 트랙 안에 머문다", async ({
  marblo,
}) => {
  const { page } = marblo;

  await page.evaluate(() => {
    localStorage.setItem("marblo:locale", "ko");
    localStorage.removeItem("marblo.firstRun.inProgress");
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await marblo.openTab("settings");
  await page.getByRole("button", { name: "Privacy" }).click();
  await expect(page.getByTestId(TOGGLES[0])).toBeVisible();

  for (const testId of TOGGLES) {
    const toggle = page.getByTestId(testId);

    // (1) 좁은 창에서 트랙이 찌그러질 수 있는가.
    const flexShrink = await toggle.evaluate(
      (el) => getComputedStyle(el).flexShrink,
    );
    expect(flexShrink, `${testId} flex-shrink`).toBe("0");

    // (2) ON 과 OFF 양쪽 — 튀어나가는 쪽은 translate 가 걸린 ON 이다.
    for (const phase of ["initial", "toggled"] as const) {
      if (phase === "toggled") {
        await toggle.click();
        await page.waitForTimeout(300); // transition-transform 이 끝날 때까지
      }
      const box = await toggle.boundingBox();
      const knob = await toggle.locator("span").first().boundingBox();
      expect(box, `${testId}/${phase} track`).not.toBeNull();
      expect(knob, `${testId}/${phase} knob`).not.toBeNull();
      if (!box || !knob) continue;

      expect(box.width, `${testId}/${phase} track width`).toBeCloseTo(36, 0);
      expect(knob.x, `${testId}/${phase} knob left`).toBeGreaterThanOrEqual(
        box.x - 0.5,
      );
      expect(
        knob.x + knob.width,
        `${testId}/${phase} knob right`,
      ).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
  }
});
