/**
 * @vitest-environment jsdom
 *
 * StateBlock — "안 될 때" 의 화면 계약(정본 §3-2 · §3-4).
 *
 *   ① failed 는 숫자도 0도 그리지 않는다(inline: 숫자 자리에 라벨, block: 본문에 숫자 없음)
 *   ② err.message 원문은 접힌 <details> 안에만 있다
 *   ③ denied 는 "0 이 아니라 알 수 없음" + 누구에게 요청하는지
 *   ④ not_ready 는 숫자 자리에 상태 라벨 + 언제 생기나
 *   ⑤ partial 은 {shown}/{total} + 더 보기
 *   ⑥ empty 는 만드는 법 한 문장 + primary 행동 하나
 *   ⑦ loading 은 골격(최종 높이) → 5초 뒤 "계속 시도 중" + 취소, 높이 불변
 *   ⑧ 재시도 라벨은 로케일 키 하나 — ko "다시 시도" / en "Retry"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { useLocaleStore } from "../../src/lib/i18n";
import { en } from "../../src/locales/en";
import { ko } from "../../src/locales/ko";
import type { LoadState } from "../../src/components/common/loadState";
import {
  hasData,
  isNumberless,
  LOADING_STILL_TRYING_MS,
} from "../../src/components/common/loadState";
import { StateBlock } from "../../src/components/common/StateBlock";

const noop = () => {};

function block(state: LoadState, children: () => ReactNode = () => "42") {
  return render(
    createElement(StateBlock, {
      variant: "block",
      state,
      minHeight: 240,
      label: "common.period.label",
      children,
    }),
  );
}

function inline(state: LoadState, children: () => ReactNode = () => "42") {
  return render(
    createElement(StateBlock, { variant: "inline", state, children }),
  );
}

function banner(state: LoadState) {
  return render(createElement(StateBlock, { variant: "banner", state }));
}

/** `<details>` 바깥의 텍스트만 — 본문에 원문/숫자가 새는지 볼 때 쓴다. */
function textOutsideDetails(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((d) => d.remove());
  return clone.textContent ?? "";
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StateBlock — failed: 숫자도 0도 그리지 않는다", () => {
  const failed: LoadState = {
    kind: "failed",
    reasonCode: "common.state.reason.network",
    detail: "Error: HTTP 500 at /api/tickets",
    retry: noop,
  };

  it("inline: 숫자 자리에 숫자 대신 라벨이 들어가고 children 은 호출되지 않는다", () => {
    const children = vi.fn(() => "0");
    const { container } = inline(failed, children);
    expect(children).not.toHaveBeenCalled();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d/);
    expect(text).toContain("불러오지 못함");
    // inline 은 원문(detail)을 아예 보이지 않는다 — 툴팁에도.
    expect(container.innerHTML).not.toContain("HTTP 500");
    const el = container.querySelector('[data-state-kind="failed"]');
    expect(el?.getAttribute("data-state-block")).toBe("inline");
  });

  it("block: 본문에 숫자가 없고, 원문은 접힌 '상세' 안에만 있다", () => {
    const children = vi.fn(() => "0");
    const { container } = block(failed, children);
    expect(children).not.toHaveBeenCalled();
    expect(textOutsideDetails(container)).not.toMatch(/\d/);
    expect(textOutsideDetails(container)).not.toContain("HTTP 500");
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("상세");
    expect(details?.textContent).toContain("HTTP 500");
    // 사유는 i18n 키에서 온 문장이다.
    expect(container.textContent).toContain("네트워크 연결을 확인하세요.");
  });

  it("다시 시도 버튼이 있고 누르면 retry 가 불린다", () => {
    const retry = vi.fn();
    block({ ...failed, retry });
    const btn = screen.getByRole("button", { name: "다시 시도" });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("banner: 데이터가 있는 화면 위 한 줄 + 다시 시도", () => {
    const { container } = banner(failed);
    expect(
      container.querySelector('[data-state-block="banner"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
    expect(container.innerHTML).not.toContain("HTTP 500");
  });
});

describe("StateBlock — denied: 0 이 아니라 알 수 없음 + 누구에게", () => {
  const denied: LoadState = {
    kind: "denied",
    reasonCode: "common.state.reason.ownerOnly",
    askWhom: "김오너",
  };

  it("block 은 정본 문장과 요청 대상을 말한다", () => {
    const { container } = block(denied);
    const text = container.textContent ?? "";
    expect(text).toContain("0 이 아니라 알 수 없음입니다");
    expect(text).toContain("김오너에게 요청하세요");
    expect(text).toContain("팀 오너만 볼 수 있는 정보입니다.");
  });

  it("inline 은 숫자 자리에 '알 수 없음' 과 물음표 툴팁", () => {
    const { container } = inline(denied, () => "0");
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).toContain("알 수 없음");
    const labeled = container.querySelector("[title]");
    expect(labeled?.getAttribute("title")).toContain("김오너에게 요청하세요");
  });

  it("onAsk 가 있으면 요청 버튼이 된다", () => {
    const onAsk = vi.fn();
    block({ ...denied, onAsk });
    fireEvent.click(screen.getByRole("button", { name: "김오너에게 요청" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});

describe("StateBlock — not_ready: 숫자 자리에 상태 라벨 + 언제 생기나", () => {
  it("inline 라벨과 사유·시점", () => {
    const { container } = inline(
      {
        kind: "not_ready",
        reasonCode: "common.state.reason.notCollected",
        availableWhen: "common.period.7d",
      },
      () => "0",
    );
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).toContain("아직 수집되지 않음");
    expect(container.querySelector("[title]")?.getAttribute("title")).toContain(
      "아직 수집을 시작하지 않았습니다",
    );
  });

  it("enable 이 있으면 켜는 버튼", () => {
    const onClick = vi.fn();
    block({
      kind: "not_ready",
      reasonCode: "common.state.reason.notCollected",
      enable: { label: "common.confirm", onClick },
    });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("StateBlock — partial: {shown}/{total} + 더 보기", () => {
  const partial: LoadState = {
    kind: "partial",
    shown: 3,
    total: 10,
    showMore: noop,
  };

  it("block 은 배너 + children(있는 만큼은 그린다)", () => {
    const children = vi.fn(() => "rows");
    const { container } = block(partial, children);
    expect(children).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("3/10 만 그렸습니다");
    expect(
      container.querySelector('[data-state-block="banner"]'),
    ).not.toBeNull();
  });

  it("더 보기를 누르면 showMore", () => {
    const showMore = vi.fn();
    banner({ ...partial, showMore });
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(showMore).toHaveBeenCalledTimes(1);
  });

  it("inline 은 수치 + 3/10 링크", () => {
    const { container } = inline(partial, () => "42");
    expect(container.textContent).toContain("42");
    expect(screen.getByRole("button", { name: /더 보기/ }).textContent).toBe(
      "3/10",
    );
  });
});

describe("StateBlock — empty: 만드는 법 한 문장 + primary 행동 하나", () => {
  it("block 은 힌트와 버튼 하나", () => {
    const onClick = vi.fn();
    const { container } = block({
      kind: "empty",
      hint: "common.selectFolderPrompt",
      create: { label: "common.state.action.create", onClick },
    });
    expect(container.textContent).toContain("아직 항목이 없습니다");
    expect(container.textContent).toContain(
      "프로젝트 폴더를 선택하여 시작하세요",
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.className).toContain("bg-accent");
    fireEvent.click(buttons[0]!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("inline 의 empty 는 진짜 0 — 이때만 children(0) 을 그린다", () => {
    const { container } = inline(
      {
        kind: "empty",
        hint: "common.selectFolderPrompt",
        create: { label: "common.state.action.create", onClick: noop },
      },
      () => "0",
    );
    expect(container.textContent).toBe("0");
  });

  it("banner 는 ready/loading/empty 에서 아무것도 그리지 않는다", () => {
    for (const state of [
      { kind: "ready" } as const,
      { kind: "loading" } as const,
      {
        kind: "empty",
        hint: "common.selectFolderPrompt",
        create: { label: "common.state.action.create", onClick: noop },
      } as const,
    ]) {
      const { container, unmount } = banner(state);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });
});

describe("StateBlock — loading: 형태 유지, 5초 뒤 계속 시도 중 + 취소", () => {
  it("골격이 minHeight 를 받고, 모든 상태가 같은 min-height 를 가진다", () => {
    const states: LoadState[] = [
      { kind: "loading" },
      { kind: "ready" },
      {
        kind: "failed",
        reasonCode: "common.state.reason.unknown",
        retry: noop,
      },
      {
        kind: "empty",
        hint: "common.selectFolderPrompt",
        create: { label: "common.state.action.create", onClick: noop },
      },
    ];
    for (const state of states) {
      const { container, unmount } = block(state);
      const root = container.querySelector<HTMLElement>("[data-state-block]");
      expect(root?.style.minHeight, state.kind).toBe("240px");
      if (state.kind === "loading") {
        const sk = container.querySelector<HTMLElement>("[data-skeleton]");
        expect(sk?.style.height).toBe("240px");
      }
      unmount();
    }
  });

  it("5초가 지나면 '계속 시도 중' 과 취소가 골격 위에 겹쳐 나타난다(높이 불변)", () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { container } = block({ kind: "loading", cancel });
    expect(container.textContent).not.toContain("계속 시도 중");
    act(() => {
      vi.advanceTimersByTime(LOADING_STILL_TRYING_MS - 1);
    });
    expect(container.textContent).not.toContain("계속 시도 중");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.textContent).toContain("계속 시도 중");
    const overlay = screen.getByText("계속 시도 중…").parentElement;
    expect(overlay?.className).toContain("absolute");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLElement>("[data-state-block]")?.style
        .minHeight,
    ).toBe("240px");
  });

  it("since 가 이미 5초 전이면 즉시 계속 시도 중", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container } = block({
      kind: "loading",
      since: 100_000 - LOADING_STILL_TRYING_MS - 1,
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(container.textContent).toContain("계속 시도 중");
  });

  it("ready 는 children 을 그린다", () => {
    const { container } = block({ kind: "ready" }, () => "rows");
    expect(container.textContent).toBe("rows");
  });
});

describe("StateBlock — 재시도 라벨은 로케일 키 하나", () => {
  it("ko '다시 시도' / en 'Retry'", () => {
    expect(ko["common.state.action.retry"]).toBe("다시 시도");
    expect(en["common.state.action.retry"]).toBe("Retry");
    useLocaleStore.setState({ locale: "en" });
    block({
      kind: "failed",
      reasonCode: "common.state.reason.unknown",
      retry: noop,
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("loadState 헬퍼", () => {
  it("hasData / isNumberless 가 상태를 가른다", () => {
    expect(hasData({ kind: "ready" })).toBe(true);
    expect(
      hasData({ kind: "partial", shown: 1, total: 2, showMore: noop }),
    ).toBe(true);
    expect(hasData({ kind: "loading" })).toBe(false);
    expect(
      isNumberless({
        kind: "failed",
        reasonCode: "common.state.reason.unknown",
        retry: noop,
      }),
    ).toBe(true);
    expect(
      isNumberless({
        kind: "denied",
        reasonCode: "common.state.reason.ownerOnly",
        askWhom: "x",
      }),
    ).toBe(true);
    expect(isNumberless({ kind: "ready" })).toBe(false);
  });
});
