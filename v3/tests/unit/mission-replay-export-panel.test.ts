/**
 * `ReplayExportPanel` — SSR-markup contract test (같은 패턴을 쓰는
 * `replay-redact-visibility.test.ts` 참고). `useEffect` 는 `renderToStaticMarkup`
 * 에서 돌지 않으므로, 여기서 고정되는 건 **초기 렌더** 뿐이다:
 *
 *   - `redacted.verified === false` → 카드를 그리려 시도조차 하지 않고
 *     차단 문구를 보여준다(design §3.2 "검증 1건이라도 실패=발행 중단"
 *     불변식을 카드 생성에도 그대로 적용).
 *   - `redacted.verified === true` → 초기 상태는 "그리는 중"이다(캔버스
 *     렌더는 effect 안에서만 실행되고, effect 는 SSR 에 없다 — 실제 브라우저
 *     경로에서만 카드가 나타난다).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayExportPanel } from "../../src/components/work-history/replay/ReplayExportPanel";
import type { RedactedReplay } from "../../src/types/missionReplay";

function makeRedacted(overrides: Partial<RedactedReplay> = {}): RedactedReplay {
  return {
    level: "L2",
    payload: { goal: "Ship the export card" },
    serialized: JSON.stringify({ goal: "Ship the export card" }, null, 2),
    removed: [],
    verified: true,
    ...overrides,
  };
}

describe("ReplayExportPanel", () => {
  it("never attempts to render a card when verification failed", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, {
        redacted: makeRedacted({ verified: false }),
      }),
    );
    expect(markup).toContain('data-testid="replay-export-blocked"');
    expect(markup).toContain("검증 실패");
    expect(markup).not.toContain('data-testid="replay-export-rendering"');
    expect(markup).not.toContain("<img");
  });

  it("starts in the rendering state for a verified payload (card draws client-side only)", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).toContain('data-testid="replay-export-rendering"');
    expect(markup).not.toContain('data-testid="replay-export-blocked"');
    expect(markup).not.toContain("<img");
  });

  it("never renders a download affordance before a card exists", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).not.toContain("PNG 다운로드");
  });

  it("labels itself PNG-only, matching the CEO-cut scope (no GIF/video/badge)", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).toContain("PNG only");
  });
});
