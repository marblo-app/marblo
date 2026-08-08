import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLoginScreenBackstop,
  looksLikeLoginScreen,
  LOGIN_BACKSTOP_GRACE_MS,
  type LoginBackstopFireReason,
} from "../../electron/harness-manager";

/**
 * 그록 인증 팝업 오탐 근본수정 (ticket UO8F2SM7i6YTQcnbqrSX).
 *
 * 종전 백스톱은 부팅 PTY 버퍼에 로그인 패턴이 **한 번이라도** 스치면 즉시
 * needsAuth 를 래치했다. 정상 인증된 grok 도 부팅 중 'Browser OIDC'(인증 방법 안내)
 * 와 'You are not authenticated'(토큰 갱신 중 순간 출력)를 뱉기 때문에, 아무 문제
 * 없는 스폰마다 인증 팝업이 떴다.
 *
 * ★후속 주의(AFfUD3h2DaQZweNdwDhy): 아래 grok 픽스처 문자열들은 라이브 캡처가 아니라
 * 창작이다 — 'Browser OIDC'·'Select login method'·'grok 0.2.112' 는 grok 1.0.0
 * 바이너리 문자열표에 0회다. 이 스위트는 **조정기(grace/철회) 상태기계**를 고정하는
 * 용도로 그대로 두고, grok 실문구·개행 없는 TUI 버퍼 축은 라이브 캡처 기반의
 * grok-login-detection.test.ts 가 담당한다.
 */

// grok 이 정상 인증 상태로 부팅할 때 실제로 스쳐 지나가는 문구들.
const GROK_TRANSIENT_BOOT =
  "grok 0.2.112\nAuth: Browser OIDC\nYou are not authenticated. Refreshing session...\n";
// 진짜 로그인 메뉴 — 선택을 기다리며 CLI 가 멈춰 있다.
const GROK_LOGIN_MENU =
  "You are not authenticated.\n" +
  "Select login method:\n" +
  "  1) Browser OIDC\n" +
  "  2) API key\n" +
  "Use the arrow keys to choose, enter to select\n";
const READY = "Loaded 41 MCP tools\n? for shortcuts\n";

describe("looksLikeLoginScreen — 약한 신호 tighten", () => {
  it("지나가는 인증 안내에는 걸리지 않는다 (grok 오탐 진범)", () => {
    expect(looksLikeLoginScreen("Auth: Browser OIDC")).toBe(false);
    expect(looksLikeLoginScreen("You are not authenticated. Refreshing…")).toBe(
      false,
    );
    expect(looksLikeLoginScreen("Log in with Grok to use more models")).toBe(
      false,
    );
    expect(looksLikeLoginScreen(GROK_TRANSIENT_BOOT)).toBe(false);
  });

  it("로그인 메뉴 맥락이 함께 있으면 확정으로 친다", () => {
    expect(looksLikeLoginScreen(GROK_LOGIN_MENU)).toBe(true);
    expect(
      looksLikeLoginScreen("Browser OIDC\nUse the arrow keys to pick one"),
    ).toBe(true);
    expect(
      looksLikeLoginScreen("You are not authenticated\nlogin method: choose"),
    ).toBe(true);
  });

  it("강한 신호는 맥락 없이도 그대로 확정이다 (회귀 가드)", () => {
    expect(looksLikeLoginScreen("Sign in with ChatGPT")).toBe(true);
    expect(looksLikeLoginScreen("Select login method")).toBe(true);
    expect(looksLikeLoginScreen("Sign in with xAI to continue")).toBe(true);
    expect(looksLikeLoginScreen("Waiting for authentication...")).toBe(true);
  });

  it("준비된 CLI 출력은 여전히 로그인 화면이 아니다", () => {
    expect(looksLikeLoginScreen(READY)).toBe(false);
    expect(looksLikeLoginScreen("Explain this codebase")).toBe(false);
    expect(looksLikeLoginScreen("")).toBe(false);
  });
});

describe("createLoginScreenBackstop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeBackstop(
    preProbeAuthenticated: boolean | null,
    hasProbe = true,
  ) {
    const fired: LoginBackstopFireReason[] = [];
    let resolved = 0;
    const backstop = createLoginScreenBackstop({
      hasProbe,
      preProbeAuthenticated,
      onNeedsAuth: (reason) => fired.push(reason),
      onResolved: () => {
        resolved++;
      },
    });
    return { backstop, fired, resolvedCount: () => resolved };
  }

  // (a) — 이 티켓의 진짜 시나리오.
  it("probe=authed + 'Browser OIDC' 뒤 readiness → needsAuth 미발화", () => {
    const { backstop, fired } = makeBackstop(true);

    // 강한 신호까지 섞인 최악의 케이스로도(=메뉴 맥락 있는 버퍼) grace 로 보류한다.
    expect(backstop.observe(GROK_LOGIN_MENU)).toBe("hold");
    expect(fired).toEqual([]);

    // grace 가 끝나기 전에 readiness 도달 → transient 로 확정.
    vi.advanceTimersByTime(LOGIN_BACKSTOP_GRACE_MS - 1_000);
    backstop.noteReadiness();
    vi.advanceTimersByTime(60_000);

    expect(fired).toEqual([]);
    expect(backstop.state()).toBe("clear");
  });

  it("probe=authed + 지나가는 안내문만 → 애초에 hold 조차 걸리지 않는다", () => {
    const { backstop, fired } = makeBackstop(true);
    expect(backstop.observe(GROK_TRANSIENT_BOOT)).toBe("clear");
    vi.advanceTimersByTime(60_000);
    expect(fired).toEqual([]);
  });

  it("probe 결과가 아직 안 왔어도 grace 로 보류한다 (미도착≠미인증)", () => {
    const { backstop, fired } = makeBackstop(null);
    expect(backstop.observe(GROK_LOGIN_MENU)).toBe("hold");
    vi.advanceTimersByTime(LOGIN_BACKSTOP_GRACE_MS - 1);
    expect(fired).toEqual([]);
  });

  it("grace 안에 readiness 가 없고 로그인 화면이 지속되면 발화한다", () => {
    const { backstop, fired } = makeBackstop(true);
    backstop.observe(GROK_LOGIN_MENU);
    // 같은 화면이 계속 보인다 = 사용자의 선택을 기다리며 멈춰 있다.
    backstop.observe(GROK_LOGIN_MENU);
    vi.advanceTimersByTime(LOGIN_BACKSTOP_GRACE_MS);
    expect(fired).toEqual(["grace-expired"]);
    expect(backstop.state()).toBe("blocked");
  });

  it("스쳐 지나간 매칭은 grace 만료 시점에 소멸한다 (blind fallback 살림)", () => {
    const { backstop, fired } = makeBackstop(true);
    backstop.observe(GROK_LOGIN_MENU);
    // 메뉴가 4KB 창 밖으로 밀려나고 평범한 출력만 남았다.
    backstop.observe("thinking…\nrunning tool: read_file\n");
    vi.advanceTimersByTime(LOGIN_BACKSTOP_GRACE_MS + 1_000);
    expect(fired).toEqual([]);
  });

  // (b) — 실미인증 회귀 가드.
  it("probe=unauthed + 로그인메뉴 → grace 없이 즉시 발화", () => {
    const { backstop, fired } = makeBackstop(false);
    expect(backstop.observe(GROK_LOGIN_MENU)).toBe("blocked");
    expect(fired).toEqual(["probe-unauthenticated"]);
  });

  it("probe 가 없는 모델(agy)은 종전대로 즉시 발화", () => {
    const { backstop, fired } = makeBackstop(null, /* hasProbe */ false);
    expect(backstop.observe("Waiting for authentication...")).toBe("blocked");
    expect(fired).toEqual(["no-probe"]);
  });

  it("보류 중 probe 가 '미인증'으로 도착하면 grace 를 앞당겨 발화", () => {
    const { backstop, fired } = makeBackstop(null);
    backstop.observe(GROK_LOGIN_MENU);
    expect(fired).toEqual([]);
    backstop.setPreProbeAuthenticated(false);
    expect(fired).toEqual(["probe-unauthenticated"]);
  });

  // (c) — 발화 후 철회.
  it("발화 후 readiness 도달 → 철회(onResolved)한다", () => {
    const { backstop, fired, resolvedCount } = makeBackstop(false);
    backstop.observe(GROK_LOGIN_MENU);
    expect(fired).toEqual(["probe-unauthenticated"]);
    expect(backstop.state()).toBe("blocked");

    expect(backstop.noteReadiness()).toBe(true);
    expect(resolvedCount()).toBe(1);
    expect(backstop.state()).toBe("clear");
  });

  it("철회는 한 번만 — 이후 로그인 문구가 또 보여도 재발화하지 않는다", () => {
    const { backstop, fired, resolvedCount } = makeBackstop(false);
    backstop.observe(GROK_LOGIN_MENU);
    backstop.noteReadiness();
    expect(backstop.noteReadiness()).toBe(false);
    expect(resolvedCount()).toBe(1);

    // 준비된 에이전트가 대화 중에 로그인 문구를 언급해도 다시 걸리지 않는다.
    expect(backstop.observe(GROK_LOGIN_MENU)).toBe("clear");
    expect(fired).toEqual(["probe-unauthenticated"]);
  });

  it("dispose 후에는 grace 타이머가 발화하지 않는다", () => {
    const { backstop, fired } = makeBackstop(true);
    backstop.observe(GROK_LOGIN_MENU);
    backstop.dispose();
    vi.advanceTimersByTime(60_000);
    expect(fired).toEqual([]);
  });

  it("grace 창은 에이전트 blind fallback(10s)보다 짧다", () => {
    expect(LOGIN_BACKSTOP_GRACE_MS).toBeLessThan(10_000);
  });
});
