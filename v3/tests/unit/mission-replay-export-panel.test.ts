/**
 * `ReplayExportPanel` — SSR-markup contract test (같은 패턴을 쓰는
 * `replay-redact-visibility.test.ts` 참고). `useEffect` 는 `renderToStaticMarkup`
 * 에서 돌지 않으므로, 여기서 고정되는 건 **초기 렌더** 뿐이다:
 *
 *   - `redacted.verified === false` → PNG/GIF/영상 전부 그리려 시도조차 하지
 *     않고 차단 문구를 보여준다(design §3.2 "검증 1건이라도 실패=발행 중단"
 *     불변식을 카드 생성에도 그대로 적용).
 *   - `redacted.verified === true` → 초기 상태는 "그리는 중"이다(캔버스
 *     렌더는 effect 안에서만 실행되고, effect 는 SSR 에 없다 — 실제 브라우저
 *     경로에서만 카드가 나타난다). WebM 은 이 테스트 환경(Node, WebCodecs 없음)
 *     에서는 항상 "unsupported" 로 떨어진다 — 이것도 계약의 일부(폴백 인코더
 *     없이 명시적으로 미지원을 표시).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayExportPanel } from "../../src/components/work-history/replay/ReplayExportPanel";
import { REPLAY_EXPORT_TEMPLATES } from "../../src/lib/replay/export/gifStoryboard";
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

  it("offers PNG, GIF, and WebM — the CEO-cut PNG-only scope was brought back forward", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).toContain("PNG");
    expect(markup).toContain('data-testid="replay-export-gif"');
    expect(markup).toContain('data-testid="replay-export-webm"');
  });

  it("renders the GIF row as generating on initial (verified) render", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).toContain(
      '<div data-testid="replay-export-gif" data-status="rendering"',
    );
  });

  it("marks WebM unsupported when the runtime has no WebCodecs VideoEncoder", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).toContain(
      '<div data-testid="replay-export-webm" data-status="unsupported"',
    );
  });

  it("offers all three scenario templates, defaulting to the narrative cut", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, { redacted: makeRedacted() }),
    );
    expect(markup).toContain('data-testid="replay-export-templates"');
    for (const template of REPLAY_EXPORT_TEMPLATES) {
      expect(markup).toContain(
        `data-testid="replay-export-template-${template.id}"`,
      );
      expect(markup).toContain(template.label);
    }
    expect(markup).toContain(
      '<button type="button" role="radio" aria-checked="true" data-testid="replay-export-template-story"',
    );
    expect(markup).toContain(
      'data-testid="replay-export-template-stats" data-selected="false"',
    );
  });

  it("honors an explicit default template", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, {
        redacted: makeRedacted(),
        defaultTemplate: "cast",
      }),
    );
    expect(markup).toContain(
      'data-testid="replay-export-template-cast" data-selected="true"',
    );
    expect(markup).toContain(
      'data-testid="replay-export-template-story" data-selected="false"',
    );
  });

  it("never shows the template picker when verification failed", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, {
        redacted: makeRedacted({ verified: false }),
      }),
    );
    expect(markup).not.toContain('data-testid="replay-export-templates"');
  });

  it("never shows the motion section when verification failed", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayExportPanel, {
        redacted: makeRedacted({ verified: false }),
      }),
    );
    expect(markup).not.toContain('data-testid="replay-export-gif"');
    expect(markup).not.toContain('data-testid="replay-export-webm"');
  });
});
