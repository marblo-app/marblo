/**
 * @vitest-environment jsdom
 *
 * Guide 탭 — **드리프트 가드** (티켓 SkXk6NSdyo4OWeSPCB7W).
 *
 * 이 탭이 옛 버전으로 썩었던 이유는 콘텐츠가 손으로 유지되는 사본이었기
 * 때문이다: 탭이 늘어도, 슬래시 커맨드가 늘어도 가이드는 가만히 있었고, 결국
 * 존재하지 않는 fleet("Gemini")을 광고하고 실제로 배포된 커맨드 4개를 빠뜨린
 * 채로 사용자 앞에 서 있었다.
 *
 * 그래서 새 가이드는 탭 목록을 `visibleRightTabs` 에서, 커맨드 목록을
 * `SLASH_COMMANDS` 에서 **파생**한다. 여기서 못박는 것은 그 파생이 실제로
 * 유지되는가 — 즉 새 탭/커맨드가 들어오면 가이드에 자동으로 나타나는가다.
 * 사람이 다시 사본을 만들면 이 테스트가 먼저 깨진다.
 *
 * (테스트는 이 repo 관례대로 .ts + createElement — vitest include 가
 * `tests/** /*.test.ts` 라 .tsx 는 수집되지 않는다.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";

import { GuideTab } from "../../src/components/guide/GuideTab";
import { GUIDE_CONTENT } from "../../src/components/guide/guideContent";
import { SLASH_COMMANDS } from "../../src/components/orchestrator/SlashCommandPopup";
import { visibleRightTabs } from "../../src/lib/splitWorkspaceLayout";
import { useLocaleStore, t, type Locale } from "../../src/lib/i18n";
import type { MessageKey } from "../../src/locales/ko";

const HANGUL = /[ㄱ-ㆎ가-힣]/;

function renderAt(locale: Locale): HTMLElement {
  useLocaleStore.setState({ locale });
  return render(createElement(GuideTab)).container;
}

/** `data-<attr>` values of every row carrying `testid`, in render order. */
function rowKeys(root: HTMLElement, testid: string, attr: string): string[] {
  return [...root.querySelectorAll(`[data-testid="${testid}"]`)].map(
    (el) => el.getAttribute(attr) ?? "",
  );
}

afterEach(() => {
  cleanup();
  useLocaleStore.setState({ locale: "ko" });
});

describe("Guide 탭 콘텐츠", () => {
  it("ko/en 이 같은 섹션을 같은 순서로 갖는다 (앵커·바로가기 대조 가능)", () => {
    const ko = GUIDE_CONTENT.ko.sections.map((s) => s.id);
    const en = GUIDE_CONTENT.en.sections.map((s) => s.id);
    expect(en).toEqual(ko);
    // 앵커는 URL 파편이자 React key — 중복이면 조용히 하나가 사라진다.
    expect(new Set(ko).size).toBe(ko.length);
  });

  it("FAQ 섹션이 있다", () => {
    for (const locale of ["ko", "en"] as const) {
      expect(GUIDE_CONTENT[locale].sections.map((s) => s.id)).toContain("faq");
    }
  });

  // ★핵심 가드 ①: 탭이 하나 늘면 가이드에도 나타나야 한다. 파생을 손으로 만든
  // 표로 되돌리는 순간 여기서 깨진다. (본문 산문에 "코드"·"보드" 같은 낱말이
  // 우연히 섞여도 통과하지 않도록 표의 **행**을 직접 센다.)
  it("지금 보이는 모든 탭을, 탭 바와 같은 순서로 문서화한다", () => {
    for (const locale of ["ko", "en"] as const) {
      const root = renderAt(locale);
      expect(rowKeys(root, "guide-tab-row", "data-tab")).toEqual(
        visibleRightTabs([]),
      );
      cleanup();
    }
  });

  it("각 탭 행이 탭 바와 같은 라벨과 비어 있지 않은 설명을 갖는다", () => {
    const root = renderAt("ko");
    for (const el of root.querySelectorAll('[data-testid="guide-tab-row"]')) {
      const id = el.getAttribute("data-tab") ?? "";
      const text = el.textContent ?? "";
      const label = t(`workspace.tab.${id}` as MessageKey);
      expect(text, `탭 ${id} 라벨 불일치`).toContain(label);
      // 하한은 낮게 — "지금 보고 있는 이 문서."(guide 탭) 처럼 한 줄이 정답인
      // 칸도 있다. 잡으려는 건 빈 칸이지 짧은 칸이 아니다.
      expect(
        text.replace(label, "").trim().length,
        `탭 ${id} 설명 없음`,
      ).toBeGreaterThan(10);
    }
  });

  // ★핵심 가드 ②: 오케 팔레트에 커맨드가 늘면 가이드 표에도 나타나야 한다.
  it("오케스트레이터 슬래시 커맨드를 하나도 빠뜨리지 않는다", () => {
    const root = renderAt("ko");
    expect(rowKeys(root, "guide-command-row", "data-command")).toEqual(
      SLASH_COMMANDS.map((c) => c.command),
    );
  });

  // 로케일 누수 가드: 영문 화면에 한글이 섞이면(=ko 블록에서 복사해 오면) 여기서
  // 잡힌다. 반대 방향(ko 에 영문)은 식별자·명령어가 정상이라 검사하지 않는다.
  it("영문 로케일 화면에 한글이 남아 있지 않다", () => {
    const text = renderAt("en").textContent ?? "";
    expect(
      text.match(new RegExp(`${HANGUL.source}[^]{0,40}`, "g")) ?? [],
    ).toEqual([]);
  });

  // 옛 문구 재유입 가드 — 실제로 틀렸던 주장들. Gemini 는 fleet 에 없고,
  // BYOK API 키 등록은 벤더 키(BYOM) 경로로 대체됐다.
  it("현행이 아닌 옛 문구를 되살리지 않는다", () => {
    for (const locale of ["ko", "en"] as const) {
      const text = renderAt(locale).textContent ?? "";
      expect(text).not.toContain("Gemini");
      expect(text).not.toContain("BYOK");
      cleanup();
    }
  });
});
