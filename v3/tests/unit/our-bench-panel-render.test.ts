/**
 * @vitest-environment jsdom
 *
 * 우리 자체 실측 섹션의 **가시성 계약** (티켓 S3r33amMPLxM8y9UJOII, 이후
 * pvaMBWvxpJIGSn5N6STp 에서 라운드 아코디언으로 확장).
 *
 * ── 이 테스트가 잡는 사고 ────────────────────────────────────────────────
 * #922 가 실제로 잰 숫자가 마크다운과 jsonl 에만 있고 화면엔 한 글자도 없었다.
 * 그래서 이 섹션의 계약은 "표가 예쁘다" 가 아니라 **접힌 상태에서도 결론이
 * 보인다** 이다. 구체적으로 세 가지가 펼치기 전에 보여야 한다:
 *   1. 모델별 결과(우리가 잰 값) — 단, **최신 라운드만**. 다른 라운드를 다
 *      나열하면 "전모델 100%"(파이프라인 증명 라운드) 가 최신 라운드의 실제
 *      변별력 있는 숫자 옆에 라벨 없이 앉아 혼동을 준다(pvaMBWvxpJIGSn5N6STp).
 *   2. ★대조행 noop 0% / gold 100% — 없으면 위 100% 가 검증되지 않은 주장이 된다
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

/**
 * 컴포넌트의 `groupCellsByRound`/`roundTagOf` 를 export 하지 않으므로(렌더러
 * 내부 구현), 테스트는 **같은 규율**(scaffold 그룹핑 → 문자열 정렬 최댓값)을
 * 독립적으로 재구현해 기대값을 데이터에서 유도한다. "v2" 를 여기 박아 두면
 * 라운드가 하나 더 생겼을 때 이 테스트가 조용히 거짓을 검증하게 된다.
 */
function groupByRound(cells: ReturnType<typeof ourBenchPayload>["cells"]) {
  const order: string[] = [];
  const byScaffold = new Map<string, typeof cells>();
  for (const cell of cells) {
    if (!byScaffold.has(cell.scaffold)) {
      byScaffold.set(cell.scaffold, []);
      order.push(cell.scaffold);
    }
    byScaffold.get(cell.scaffold)!.push(cell);
  }
  return order
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((scaffold) => ({ scaffold, cells: byScaffold.get(scaffold)! }));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chipPattern(cell: {
  model: string | null;
  resolvedPct: number | null;
}): RegExp {
  const model = escapeRegExp(cell.model ?? "(cli default)");
  const pct =
    cell.resolvedPct === null
      ? "n/a"
      : escapeRegExp(`${cell.resolvedPct.toFixed(1)}%`);
  return new RegExp(`${model} ${pct}`);
}

const rounds = groupByRound(ourBenchPayload().cells);
const latestRound = rounds[rounds.length - 1];
const olderRounds = rounds.slice(0, -1);
const latestMeasured = latestRound.cells.filter(
  (c) => c.harness !== "noop" && c.harness !== "gold",
);

describe("OurBenchPanel — 접힌 상태에서 보여야 하는 것", () => {
  afterEach(cleanup);

  it("제목·최신 라운드 결과·대조행이 펼치기 전에 보인다", () => {
    render(createElement(OurBenchPanel));

    expect(screen.getByText(ko["usage.ourBench.title"])).toBeTruthy();

    // ★기대값을 **데이터에서 유도**한다(다시 측정해 숫자가 바뀌어도 이 테스트가
    // 깨지지 않는다) — 단, 최신 라운드로 그룹핑된 셀만 확인한다.
    expect(latestMeasured.length).toBeGreaterThan(0);
    for (const cell of latestMeasured) {
      expect(
        screen.getAllByText(chipPattern(cell)).length,
        `최신 라운드 ${cell.harness}/${cell.model} 칩이 화면에 없다`,
      ).toBeGreaterThan(0);
    }

    // ★대조행 — 이 줄이 위 100% 를 관측으로 만든다. noop/gold 는 라운드마다
    // 값이 같으므로(둘 다 0%/100%) 라운드에 상관없이 이 문구가 뜬다.
    expect(screen.getByText(/noop 0\.0% · gold 100\.0%/)).toBeTruthy();
  });

  it("이전 라운드 결과는 기본적으로 접혀 있다(다 나열하지 않는다)", () => {
    render(createElement(OurBenchPanel));

    for (const round of olderRounds) {
      const measured = round.cells.filter(
        (c) => c.harness !== "noop" && c.harness !== "gold",
      );
      for (const cell of measured) {
        // 최신 라운드와 같은 모델이라도 값이 다르면(예: opus 100%→91.7%) 이전
        // 라운드 고유의 칩 텍스트가 된다. 값이 우연히 같은 셀은 판별력이 없어
        // 건너뛴다.
        const sameInLatest = latestMeasured.some(
          (m) => m.model === cell.model && m.resolvedPct === cell.resolvedPct,
        );
        if (sameInLatest) continue;
        expect(
          screen.queryByText(chipPattern(cell)),
          `이전 라운드 ${cell.harness}/${cell.model} 칩이 접힌 상태에서 보인다`,
        ).toBeNull();
      }
    }

    // 접힌 헤더에 파이프라인 증명 설명이 남는다.
    if (olderRounds.length > 0) {
      expect(
        screen.getByText(ko["usage.ourBench.previousRoundCaption"]),
      ).toBeTruthy();
    }
  });

  it("‘공식 Docker 아님 → 비교 불가’ 캡션이 접힌 상태에서도 남는다", () => {
    render(createElement(OurBenchPanel));
    expect(screen.getByText(ko["usage.ourBench.caption.execEnv"])).toBeTruthy();
    expect(
      screen.getByText(ko["usage.ourBench.caption.separate"]),
    ).toBeTruthy();
  });

  it("최신 라운드는 기본으로 펼쳐져 있어 클릭 없이 전체 표가 보인다", () => {
    render(createElement(OurBenchPanel));

    // ★"최신 라운드만 기본 펼치고" — 클릭 없이도 셀별 요약과 인스턴스×하네스가
    // 이미 그려져 있어야 한다.
    expect(screen.getByText(ko["usage.ourBench.cellsTitle"])).toBeTruthy();
    expect(screen.getByText(ko["usage.ourBench.instancesTitle"])).toBeTruthy();
    expect(screen.getByText("django__django-15851")).toBeTruthy();
    expect(screen.getAllByText(/F2P 1\/1 · P2P 8\/8/).length).toBeGreaterThan(
      0,
    );
  });

  it("이전 라운드를 펼치면 그 라운드의 칩과 셀 표가 드러난다", () => {
    if (olderRounds.length === 0) return;
    render(createElement(OurBenchPanel));

    // 접힌 라운드의 "펼치기" 버튼을 누른다(최신 라운드는 이미 "접기" 상태이므로
    // 화면에는 "펼치기" 텍스트 버튼이 이전 라운드 수만큼 남아 있다).
    for (const button of screen.getAllByText(ko["usage.ourBench.expand"])) {
      fireEvent.click(button);
    }

    for (const round of olderRounds) {
      const measured = round.cells.filter(
        (c) => c.harness !== "noop" && c.harness !== "gold",
      );
      expect(measured.length).toBeGreaterThan(0);
      for (const cell of measured) {
        expect(
          screen.getAllByText(chipPattern(cell)).length,
          `펼친 이전 라운드 ${cell.harness}/${cell.model} 칩이 안 보인다`,
        ).toBeGreaterThan(0);
      }
    }

    // 셀별 요약 표 제목이 라운드 수만큼(최신 + 펼친 이전 라운드) 뜬다.
    expect(
      screen.getAllByText(ko["usage.ourBench.cellsTitle"]).length,
    ).toBeGreaterThanOrEqual(1 + olderRounds.length);
  });

  it("데이터가 없어도 제목과 안내가 남는다(섹션이 사라지지 않는다)", () => {
    payload.value = null;
    try {
      render(createElement(OurBenchPanel));
      expect(screen.getByText(ko["usage.ourBench.title"])).toBeTruthy();
      expect(screen.getByText(ko["usage.ourBench.empty"])).toBeTruthy();
      // 라운드가 없으므로 펼치기 버튼도 없다 — 대신 왜 비었는지를 글로 말한다.
      expect(screen.queryByText(ko["usage.ourBench.expand"])).toBeNull();
    } finally {
      payload.value = ourBenchPayload();
    }
  });
});
