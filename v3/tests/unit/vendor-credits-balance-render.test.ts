/**
 * @vitest-environment jsdom
 *
 * `VendorCreditsPanel` 잔액 표시 계약 (티켓 zGlnSwXk).
 *
 * ── 이 테스트가 지키는 것 ────────────────────────────────────────────────
 * 잔액 배선의 요구는 "숫자가 뜬다" 가 아니라 **네 가지 규율**이고, 셋은 화면에서만
 * 확인된다:
 *
 *   1. 무료분(만료 가능)과 충전액이 **갈라져** 보인다. 총액만 보이면 "충전액이
 *      아직 남았다" 로 오독된다.
 *   2. 실패 사유가 **구분돼** 보인다. 키 없음 / 401 / 네트워크가 같은 문장이면
 *      사용자는 충전이 안 된 건지 키가 틀린 건지 모른다(Solar 학습).
 *   3. 통화를 **환산하지 않는다**. CNY 로 오면 CNY 로 뜬다.
 *   4. 탭을 다시 열어도 **자동 재조회가 없다**(수동 새로고침만).
 *
 * (repo 관례대로 .ts + createElement — vitest include 가 `tests/**\/*.test.ts` 다.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useLocaleStore } from "../../src/lib/i18n";
import { useVendorBalanceStore } from "../../src/stores/vendorBalanceStore";

const { VendorCreditsPanel } =
  await import("../../src/components/usage/VendorCreditsPanel");

const FAKE_KEY = "test-deepseek-key-not-a-real-secret";

/** 카탈로그가 실제로 내려주는 모양(값 없이 키 이름 + boolean). */
function deepseekGroup(over: Record<string, unknown> = {}) {
  return {
    vendor: "deepseek",
    label: "DeepSeek",
    harness: "gpt",
    command: "codex",
    requiredEnvKeys: ["DEEPSEEK_API_KEY"],
    missingEnvKeys: [],
    available: true,
    models: [],
    ...over,
  } as unknown as QuickLaneVendorGroup;
}

function installBalanceApi(result: unknown) {
  const vendorBalance = vi.fn(async () => result);
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = { usage: { vendorBalance } };
  return vendorBalance;
}

const OK_RESULT = {
  vendor: "deepseek",
  status: "ok",
  amounts: [{ currency: "CNY", total: 110, granted: 10, toppedUp: 100 }],
  isAvailable: true,
  fetchedAt: 1_700_000_000_000,
  cached: false,
};

function renderPanel(groups = [deepseekGroup()]) {
  return render(createElement(VendorCreditsPanel, { groups }));
}

/** effect 안의 async IPC 가 끝날 때까지 한 틱 흘린다. */
async function settle() {
  await screen.findByText(/DeepSeek/);
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  useVendorBalanceStore.setState({ byVendor: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useVendorBalanceStore.setState({ byVendor: {} });
});

describe("성공 — 잔액이 실제 API 값으로 뜬다", () => {
  it("총액·무료분·충전액이 **각각** 보인다(합쳐서만 보여주지 않는다)", async () => {
    installBalanceApi(OK_RESULT);
    renderPanel();
    await settle();

    // 총액
    expect(await screen.findByText(/110\.00 CNY/)).toBeTruthy();
    // 무료분과 충전액이 갈라져 있다
    const detail = await screen.findByText(/무료분 10\.00 CNY/);
    expect(detail.textContent).toContain("충전액 100.00 CNY");
  });

  it("★통화를 환산하지 않는다 — CNY 가 CNY 로 뜬다(USD 표기가 없다)", async () => {
    installBalanceApi(OK_RESULT);
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("CNY");
    expect(container.textContent).not.toContain("USD");
    expect(container.textContent).not.toContain("$");
  });

  it("과금축이 '선불 충전' 으로 뜨고 '조회불가' 가 아니다", async () => {
    installBalanceApi(OK_RESULT);
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("선불 충전");
    expect(container.textContent).not.toContain("조회불가");
  });

  it("★키 값은 화면 어디에도 없다", async () => {
    installBalanceApi(OK_RESULT);
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).not.toContain(FAKE_KEY);
    // 키 **이름**은 크레덴셜 상태 줄에 정상적으로 보인다(값이 아니다).
    expect(container.textContent).toContain("DEEPSEEK_API_KEY");
  });

  it("벤더가 계정을 사용 불가로 표시하면 그 사실이 따로 뜬다", async () => {
    installBalanceApi({ ...OK_RESULT, isAvailable: false });
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("사용 불가");
  });
});

describe("★실패 — 사유가 구분돼 보인다", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    [
      "키 없음",
      {
        vendor: "deepseek",
        status: "no-key",
        amounts: [],
        missingEnvKeys: ["DEEPSEEK_API_KEY"],
        fetchedAt: 1,
        cached: false,
      },
      /키가 없어 잔액을 조회하지 못했습니다/,
    ],
    [
      "401",
      {
        vendor: "deepseek",
        status: "unauthorized",
        amounts: [],
        httpStatus: 401,
        fetchedAt: 1,
        cached: false,
      },
      /키를 거부했습니다\(HTTP 401\)/,
    ],
    [
      "5xx",
      {
        vendor: "deepseek",
        status: "http-error",
        amounts: [],
        httpStatus: 503,
        fetchedAt: 1,
        cached: false,
      },
      /벤더 응답 오류\(HTTP 503\)/,
    ],
    [
      "네트워크",
      {
        vendor: "deepseek",
        status: "network-error",
        amounts: [],
        fetchedAt: 1,
        cached: false,
      },
      /벤더에 닿지 못했습니다/,
    ],
    [
      "형식 불일치",
      {
        vendor: "deepseek",
        status: "malformed",
        amounts: [],
        fetchedAt: 1,
        cached: false,
      },
      /형식이 예상과 다릅니다/,
    ],
  ];

  it.each(cases)("%s 은 자기 문장으로 뜬다", async (_label, result, re) => {
    installBalanceApi(result);
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toMatch(re);
  });

  it("★다섯 사유의 문장이 서로 다르다(뭉치기 금지의 화면단 집행)", async () => {
    const seen = new Set<string>();
    for (const [, result] of cases) {
      useVendorBalanceStore.setState({ byVendor: {} });
      installBalanceApi(result);
      const { container } = renderPanel();
      await settle();
      const line = [...container.querySelectorAll("p")]
        .map((p) => p.textContent ?? "")
        .find((txt) => txt.startsWith("!") && !txt.includes("크레덴셜"));
      expect(line, JSON.stringify(result)).toBeTruthy();
      seen.add(line!);
      cleanup();
    }
    expect(seen.size).toBe(cases.length);
  });

  it("401 문장이 '잔액 부족' 으로 읽히지 않는다(그 구분이 이 티켓의 요구다)", async () => {
    installBalanceApi(cases[1][1]);
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("잔액 부족이 아닙니다");
  });
});

describe("★호출 빈도 — 화면이 벤더를 반복해 때리지 않는다", () => {
  it("첫 렌더에서 한 번만 읽는다", async () => {
    const api = installBalanceApi(OK_RESULT);
    renderPanel();
    await settle();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith("deepseek", { force: false });
  });

  it("탭을 닫았다 다시 열어도(재마운트) 추가 요청이 없다", async () => {
    const api = installBalanceApi(OK_RESULT);
    renderPanel();
    await settle();
    cleanup();
    renderPanel();
    await settle();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("새로고침 버튼을 누를 때만 force 로 다시 읽는다", async () => {
    const api = installBalanceApi(OK_RESULT);
    renderPanel();
    await settle();
    fireEvent.click(screen.getByText(/잔액 새로고침/));
    await new Promise((r) => setTimeout(r, 0));
    expect(api).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenLastCalledWith("deepseek", { force: true });
  });

  it("조회 수단이 없는 벤더는 요청 자체를 안 한다", async () => {
    const api = installBalanceApi(OK_RESULT);
    renderPanel([deepseekGroup({ vendor: "zai", label: "Z.ai GLM" })]);
    await screen.findByText(/Z\.ai GLM/);
    await new Promise((r) => setTimeout(r, 0));
    expect(api).not.toHaveBeenCalled();
    // 종전 그대로 "조회불가" 로 남는다(회귀 방지).
    expect(screen.getByText("조회불가")).toBeTruthy();
  });
});

describe("브리지 없음(웹 미리보기)", () => {
  it("던지지 않고 조회불가로 그린다", async () => {
    (
      globalThis as unknown as { window: { electronAPI: unknown } }
    ).window.electronAPI = undefined;
    const { container } = renderPanel();
    await settle();
    expect(container.textContent).toContain("조회불가");
  });
});
