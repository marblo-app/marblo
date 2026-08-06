import { expect, test } from "@playwright/test";

async function renderSurveyModal(page: import("@playwright/test").Page) {
  await page.setContent(`
    <html>
      <head>
        <style>
          body { margin: 0; min-height: 100vh; background: #11111b; color: #cdd6f4; font-family: Inter, system-ui, sans-serif; }
          .modal { position: fixed; right: 24px; bottom: 24px; width: min(24rem, calc(100vw - 2rem)); border: 1px solid #313244; border-radius: 12px; background: #1e1e2e; padding: 20px; box-shadow: 0 25px 50px rgba(0,0,0,.45); }
          .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
          .eyebrow { margin: 0; color: #89b4fa; font-size: 12px; font-weight: 600; text-transform: uppercase; }
          h2 { margin: 4px 0 0; font-size: 16px; line-height: 24px; }
          button { cursor: pointer; }
          .close { border: 0; background: transparent; color: #a6adc8; }
          .stars { display: flex; justify-content: space-between; margin-top: 16px; }
          .star { border: 0; background: transparent; color: #f9e2af; font-size: 30px; }
          label { display: block; margin-top: 16px; color: #a6adc8; font-size: 14px; }
          textarea, input { box-sizing: border-box; margin-top: 8px; width: 100%; border: 1px solid #313244; border-radius: 8px; background: #11111b; color: #cdd6f4; padding: 8px 12px; font-size: 14px; outline: none; }
          textarea { height: 80px; resize: none; }
          .hint { margin: 8px 0 0; color: #a6adc8; font-size: 12px; line-height: 20px; }
          .submit { margin-top: 16px; width: 100%; border: 0; border-radius: 8px; background: #89b4fa; color: #11111b; padding: 10px 16px; font-weight: 700; }
        </style>
      </head>
      <body>
        <section class="modal" role="dialog" aria-modal="true" aria-labelledby="experience-survey-title">
          <div class="top">
            <div>
              <p class="eyebrow">Experience survey</p>
              <h2 id="experience-survey-title">마블로 사용경험은 어땠나요?</h2>
            </div>
            <button class="close" type="button" aria-label="설문 닫기">×</button>
          </div>
          <div class="stars" aria-label="첫 프로젝트 경험 별점">
            <button class="star" type="button" aria-pressed="true" title="1점">★</button>
            <button class="star" type="button" aria-pressed="true" title="2점">★</button>
            <button class="star" type="button" aria-pressed="true" title="3점">★</button>
            <button class="star" type="button" aria-pressed="true" title="4점">★</button>
            <button class="star" type="button" aria-pressed="false" title="5점">★</button>
          </div>
          <label for="liked">좋았던 점</label>
          <textarea id="liked">오케스트레이터가 티켓을 나눠줘서 좋았습니다.</textarea>
          <label for="improvements">개선점</label>
          <textarea id="improvements">처음 연결 안내가 더 촘촘하면 좋겠습니다.</textarea>
          <label for="share-url">마블로 경험을 SNS에 공유하고 링크를 붙여주세요</label>
          <input id="share-url" type="url" placeholder="https://..." />
          <p class="hint">인스타, 블로그, 유튜브 등 어떤 링크든 가능합니다. 제출하면 5개월 Pro 무료 리워드가 자동 적용되고 어드민 검토 플래그가 함께 남습니다.</p>
          <button class="submit" type="button">링크 제출하고 5개월 Pro 받기</button>
        </section>
      </body>
    </html>
  `);
}

test.describe("experience survey modal mocked", () => {
  test("renders the survey and accepts an SNS URL", async ({ page }) => {
    await renderSurveyModal(page);

    const dialog = page.getByRole("dialog", {
      name: "마블로 사용경험은 어땠나요?",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("좋았던 점")).toBeVisible();
    await expect(dialog.getByText("개선점")).toBeVisible();
    await expect(
      dialog.getByText("마블로 경험을 SNS에 공유하고 링크를 붙여주세요"),
    ).toBeVisible();

    const input = dialog.getByLabel("마블로 경험을 SNS에 공유하고 링크를 붙여주세요");
    await input.fill("https://blog.example.com/marblo-review");
    await expect(input).toHaveValue("https://blog.example.com/marblo-review");
    await expect(
      dialog.getByRole("button", { name: "링크 제출하고 5개월 Pro 받기" }),
    ).toBeVisible();
  });
});
