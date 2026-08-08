/**
 * @vitest-environment jsdom
 *
 * 시작하기 탭의 원클릭 두 패널(티켓 afW5wNdX) — 화면 계약.
 *
 * 스토어 로직은 one-click-onboarding.test.ts 가, 터미널 주입은
 * one-click-signin-injection.test.ts 가 못박는다. 여기서 지키는 건 **버튼이
 * 실제로 그 경로를 부르는가**, 그리고 **누를 게 없을 때 누를 수 없는 버튼을
 * 띄우지 않는가** 다. 후자가 중요한 이유: 눌러도 아무 일이 없는 버튼은 신규
 * 사용자에게 "앱이 고장났다" 로 읽힌다.
 *
 * (테스트는 이 repo 관례대로 .ts + createElement — vitest include 가
 * `tests/** /*.test.ts` 라 .tsx 는 아예 수집되지 않는다.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// vi.mock 은 파일 최상단으로 호이스팅되므로 팩토리가 참조하는 값도 호이스팅돼야
// 한다(vi.hoisted) — 평범한 const 는 "before initialization" 으로 죽는다.
const actions = vi.hoisted(() => ({
  oneClickSignIn: vi.fn(() => "claude" as const),
  launchLogin: vi.fn(),
}));
vi.mock("../../src/services/cliSetupActions", () => actions);

import {
  InstallAllPanel,
  OneClickSignInPanel,
} from "../../src/components/onboarding/CliSetupRows";
import { useCliSetupStore } from "../../src/stores/cliSetupStore";

const probe = (installed: boolean, authenticated: boolean) => ({
  installed,
  authenticated,
});

function seed(
  results: Record<string, { installed: boolean; authenticated: boolean }>,
) {
  useCliSetupStore.setState({
    results,
    states: Object.fromEntries(
      Object.entries(results).map(([id, r]) => [id, { ...r, checking: false }]),
    ),
    bulkInstall: null,
    installErrors: {},
  });
}

describe("InstallAllPanel — '모두 설치' 원클릭", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCliSetupStore.setState({ runInstallAll: vi.fn(async () => undefined) });
  });
  afterEach(cleanup);

  it("미설치 CLI 수를 보여주고, 누르면 일괄 설치를 부른다", () => {
    seed({
      "cli-claude-code": probe(false, false),
      "cli-codex": probe(false, false),
      "cli-grok": probe(true, false),
    });
    render(createElement(InstallAllPanel));

    const btn = screen.getByTestId("cli-install-all-button");
    expect(btn.textContent).toContain("2"); // claude + codex (grok 은 이미 설치)
    fireEvent.click(btn);
    expect(useCliSetupStore.getState().runInstallAll).toHaveBeenCalledTimes(1);
  });

  it("★설치할 게 없으면 버튼 대신 완료 줄만 남는다", () => {
    seed({
      "cli-claude-code": probe(true, false),
      "cli-codex": probe(true, false),
    });
    render(createElement(InstallAllPanel));

    expect(screen.queryByTestId("cli-install-all-button")).toBeNull();
    expect(screen.getByTestId("cli-install-all")).toBeTruthy();
  });

  it("진행 중에는 n/총 진행률을 보여주고 재클릭을 막는다", () => {
    seed({ "cli-claude-code": probe(false, false) });
    useCliSetupStore.setState({
      bulkInstall: { running: true, total: 2, done: 1, failedIds: [] },
    });
    render(createElement(InstallAllPanel));

    const btn = screen.getByTestId(
      "cli-install-all-button",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("1/2");
    expect(screen.getByTestId("cli-install-all-progress")).toBeTruthy();
  });

  it("부분 실패는 실패 개수를 남긴다(실패 행 카드의 수동 폴백으로 이어진다)", () => {
    // 실패한 행은 여전히 미설치다 → 패널은 계속 떠 있고 재시도할 수 있다.
    seed({
      "cli-claude-code": probe(true, false),
      "cli-codex": probe(false, false),
    });
    useCliSetupStore.setState({
      bulkInstall: {
        running: false,
        total: 2,
        done: 2,
        failedIds: ["cli-codex"],
      },
    });
    render(createElement(InstallAllPanel));
    expect(screen.getByTestId("cli-install-all-result").textContent).toContain(
      "1",
    );
  });
});

describe("OneClickSignInPanel — '원클릭 사인인'", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("설치·미인증 CLI 가 있으면 그 CLI 이름을 달고 뜨며, 누르면 사인인을 시작한다", () => {
    seed({
      "cli-claude-code": probe(true, false),
      "cli-codex": probe(true, true),
    });
    render(createElement(OneClickSignInPanel));

    const btn = screen.getByTestId("cli-signin-oneclick-button");
    expect(btn.textContent).toContain("Claude Code");
    fireEvent.click(btn);
    expect(actions.oneClickSignIn).toHaveBeenCalledTimes(1);
    // 터미널을 띄웠다는 사실을 사용자에게 남긴다(브라우저로 넘어갔다 돌아와도
    // 무슨 일이 일어났는지 화면에 남아 있어야 한다).
    expect(screen.getByTestId("cli-signin-oneclick-note")).toBeTruthy();
  });

  it("★사인인할 대상이 없으면 패널 자체가 뜨지 않는다", () => {
    seed({
      "cli-claude-code": probe(true, true),
      "cli-codex": probe(false, false), // 미설치 → 인증할 게 없다
    });
    render(createElement(OneClickSignInPanel));
    expect(screen.queryByTestId("cli-signin-oneclick")).toBeNull();
  });
});
