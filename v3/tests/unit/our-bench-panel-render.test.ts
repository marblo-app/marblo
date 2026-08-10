/**
 * @vitest-environment jsdom
 *
 * 우리 자체 실측 섹션의 **가시성 계약** (티켓 S3r33amMPLxM8y9UJOII).
 *
 * ── 이 테스트가 잡는 사고 ────────────────────────────────────────────────
 * #922 가 실제로 잰 숫자가 마크다운과 jsonl 에만 있고 화면엔 한 글자도 없었다.
 * 그래서 이 섹션의 계약은 "표가 예쁘다" 가 아니라 **접힌 상태에서도 결론이
 * 보인다** 이다. 구체적으로 세 가지가 펼치기 전에 보여야 한다:
 *   1. 모델별 결과(우리가 잰 값)
 *   2. ★대조행 noop 0% / gold 100% — 없으면 위 100% 가 증거 없는 주장이 된다
 *   3. ★"공식 Docker 아님 → 리더보드와 비교 불가" 캡션 — 숫자와 조건은 같이 다닌다
 *
 * 데이터는 **실제 커밋된 소스**(`electron/model-bench-ours.ts`)를 그대로 쓴다.
 * 화면용 더미를 만들면 "그 데이터가 실제로 그려지는가" 를 못 본다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ourBenchPayload } from "../../electron/model-bench-ours";

const payload = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../../src/stores/ourBenchStore", () => ({
  useOurBenchStore: (sel: (s: unknown) => unknown) =>
    sel({
      report: payload.value,
      status: "ready",
      error: null,
      load: () => {},
      reload: () => {},
    }),
}));

import { OurBenchPanel } from "../../src/components/usage/OurBenchPanel";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

payload.value = ourBenchPayload();
useLocaleStore.setState({ locale: "ko" });

describe("OurBenchPanel — 접힌 상태에서 보여야 하는 것", () => {
  afterEach(cleanup);

  it("제목·모델 결과·대조행이 펼치기 전에 보인다", () => {
    render(createElement(OurBenchPanel));

    expect(screen.getByText(ko["usage.ourBench.title"])).toBeTruthy();

    // 우리가 잰 모델 셀(요약 칩).
    expect(screen.getByText(/claude-sonnet-5 100\.0%/)).toBeTruthy();
    expect(screen.getByText(/gpt-5\.6-luna 100\.0%/)).toBeTruthy();

    // ★대조행 — 이 줄이 위 100% 를 관측으로 만든다.
    expect(screen.getByText(/noop 0\.0% · gold 100\.0%/)).toBeTruthy();
  });

  it("‘공식 Docker 아님 → 비교 불가’ 캡션이 접힌 상태에서도 남는다", () => {
    render(createElement(OurBenchPanel));
    expect(screen.getByText(ko["usage.ourBench.caption.execEnv"])).toBeTruthy();
    expect(
      screen.getByText(ko["usage.ourBench.caption.separate"]),
    ).toBeTruthy();
  });

  it("펼치면 전체 표(셀별 + 인스턴스×하네스)가 나온다", () => {
    render(createElement(OurBenchPanel));
    // 펼치기 전엔 세부가 없다 — 접힘이 실제로 접혀 있어야 요약의 의미가 산다.
    expect(screen.queryByText(ko["usage.ourBench.cellsTitle"])).toBeNull();

    fireEvent.click(screen.getByText(ko["usage.ourBench.expand"]));

    expect(screen.getByText(ko["usage.ourBench.cellsTitle"])).toBeTruthy();
    expect(screen.getByText(ko["usage.ourBench.instancesTitle"])).toBeTruthy();
    // 인스턴스 id 와 채점 근거(F2P/P2P)가 표에 그대로 있다.
    expect(screen.getByText("django__django-15851")).toBeTruthy();
    expect(screen.getAllByText(/F2P 1\/1 · P2P 8\/8/).length).toBeGreaterThan(
      0,
    );
  });

  it("데이터가 없어도 제목과 안내가 남는다(섹션이 사라지지 않는다)", () => {
    payload.value = null;
    try {
      render(createElement(OurBenchPanel));
      expect(screen.getByText(ko["usage.ourBench.title"])).toBeTruthy();
      expect(screen.getByText(ko["usage.ourBench.empty"])).toBeTruthy();
      // 펼치기 버튼은 없다(펼칠 것이 없으므로) — 대신 왜 비었는지를 글로 말한다.
      expect(screen.queryByText(ko["usage.ourBench.expand"])).toBeNull();
    } finally {
      payload.value = ourBenchPayload();
    }
  });
});
