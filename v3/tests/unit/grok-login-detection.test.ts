import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_LOGIN_PATTERNS,
  LOGIN_SCREEN_PATTERNS,
  looksLikeLoginScreen,
} from "../../electron/harness-manager";
import { CLI_READINESS_PATTERNS } from "../../electron/agent-manager";

/**
 * 그록 인증 팝업 잔여 오탐 (ticket AFfUD3h2DaQZweNdwDhy — #846 후속).
 *
 * #846 은 grok 오탐을 "약한 신호 + grace" 로 눌렀지만 두 구멍이 남아 있었다.
 * 이 스위트는 **라이브 PTY 캡처**로 두 구멍을 고정한다.
 *
 * 캡처 방법(2026-08-08, grok 1.0.0 / `grok --version` = 1.0.0 (3cd0d0cbcebe)):
 *   node-pty 로 실제 스폰과 같은 argv 로 띄웠다 —
 *   `grok --minimal --permission-mode bypassPermissions --session-id <uuid> -m <model>`
 *   fixtures/grok-1.0.0-device-login.pty.txt 는 그 캡처(130,177 바이트)에서
 *   device-code 로그인 화면이 그려지는 구간을 잘라낸 **가공하지 않은 PTY 바이트**다.
 */

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "../fixtures/grok-1.0.0-device-login.pty.txt"),
  "utf-8",
);

describe("grok 1.0.0 실제 로그인 화면 (라이브 캡처)", () => {
  it("★TUI PTY 버퍼에는 개행이 없다 — `.*` 는 화면 전체를 가로지른다", () => {
    // 이 사실이 `/Grok Build.*(login|auth)/i` 오탐의 메커니즘이다. 전체 캡처
    // 130,177 바이트에 `\n` 은 1개뿐이었고, 잘라낸 이 구간에는 0개다.
    expect(FIXTURE.length).toBeGreaterThan(1_000);
    expect(FIXTURE.split("\n").length - 1).toBe(0);
  });

  it("진짜 미인증 grok 은 로그인 화면으로 판정된다 (종전엔 미탐)", () => {
    // 종전 패턴 집합으로는 이 버퍼가 매칭 0 이었다 — 진짜 미인증 grok 을 못 잡고
    // 10s blind fallback 이 로그인 화면에 지시문을 타이핑했다.
    expect(looksLikeLoginScreen(FIXTURE)).toBe(true);
  });

  it("캡처에서 실제로 렌더된 문구들이 패턴에 잡힌다", () => {
    for (const phrase of [
      "Approve in your browser to finish signing in.",
      "Make sure your browser shows this code.",
      "Waiting for approval...",
      "Copying not working? Click here to show full URL.",
    ]) {
      expect(FIXTURE).toContain(phrase); // 캡처 원문에 존재
      expect(looksLikeLoginScreen(phrase)).toBe(true); // 감지기가 잡는다
    }
  });

  it("로그인 화면에는 준비 상태 지표가 없다", () => {
    expect(CLI_READINESS_PATTERNS.some((re) => re.test(FIXTURE))).toBe(false);
  });
});

describe("LOGIN_SCREEN_PATTERNS 구조 불변식", () => {
  it("임의 텍스트를 건너뛰는 `.*` / `.+` 브리지가 없다", () => {
    // 개행 없는 TUI 버퍼에서 `.` 는 화면 전체를 가로지르므로, `A.*B` 는 화면
    // 어딘가의 A 와 그 뒤 어딘가의 B 를 잇는다. 상시 표시되는 헤더/푸터를 A 로
    // 두면 사실상 항상 참이 되는 패턴이 만들어진다(= 이 티켓의 오탐).
    const offenders = LOGIN_SCREEN_PATTERNS.filter((re) =>
      /\.[*+]/.test(re.source),
    ).map(String);
    expect(offenders).toEqual([]);
  });

  it("약한 신호도 마찬가지로 브리지가 없다", () => {
    const offenders = AMBIGUOUS_LOGIN_PATTERNS.filter((re) =>
      /\.[*+]/.test(re.source),
    ).map(String);
    expect(offenders).toEqual([]);
  });
});

describe("준비 상태의 grok 을 로그인 화면으로 오판하지 않는다", () => {
  /**
   * grok 1.0.0 minimal 렌더러의 준비 상태 화면을 **재구성**한 버퍼.
   * 문구는 바이너리 문자열표 실측값이고(푸터 "Grok Build  v1.0.0 … Model … /help
   * for commands", MCP 패널의 "needs auth"), 개행이 없다는 성질은 라이브 캡처
   * 실측이다. 정상 인증 grok 의 라이브 캡처는 이 맥의 리프레시 토큰이 서버에서
   * revoke 되어(RefreshTokenRejected) 이 티켓 시점에 확보하지 못했다 — 그래서
   * 이 케이스만 재구성 픽스처다.
   *
   * 종전 패턴 `/Grok Build.*(login|auth)/i` 는 이 버퍼에서 상태 푸터의
   * "Grok Build" 와 그 뒤 재도색 조각의 "needs auth" 를 이어 붙여 매칭했다
   * = 준비된 grok 에 인증 팝업. (grok 은 매 프레임 화면을 다시 그리므로 4KB
   * 롤링 창에는 여러 부분 도색이 임의 순서로 섞여 들어간다.)
   */
  const GROK_READY_MINIMAL =
    "\x1b[38;1H Grok Build  v1.0.0   Model grok-4-fast   /help for commands " +
    "\x1b[38;5;245m\x1b[2;1H  marblo  ready   github  ready   playwright  needs auth";

  it("재구성 버퍼에 개행이 없다 (라이브와 같은 조건)", () => {
    expect(GROK_READY_MINIMAL.split("\n").length - 1).toBe(0);
  });

  it("종전 패턴이라면 잡혔을 버퍼다 (오탐 메커니즘 고정)", () => {
    expect(/Grok Build.*(login|auth)/i.test(GROK_READY_MINIMAL)).toBe(true);
  });

  it("지금은 로그인 화면이 아니다", () => {
    expect(looksLikeLoginScreen(GROK_READY_MINIMAL)).toBe(false);
  });

  it("준비 지표로 잡혀 noteReadiness 가 발화한다", () => {
    expect(
      CLI_READINESS_PATTERNS.some((re) => re.test(GROK_READY_MINIMAL)),
    ).toBe(true);
    expect(/\/help for commands/i.test(GROK_READY_MINIMAL)).toBe(true);
  });
});

describe("다른 하네스 회귀 가드", () => {
  it("codex/claude/agy 로그인 화면은 그대로 잡힌다", () => {
    expect(looksLikeLoginScreen("Sign in with ChatGPT")).toBe(true);
    expect(looksLikeLoginScreen("Select login method")).toBe(true);
    expect(looksLikeLoginScreen("Waiting for authentication...")).toBe(true);
    expect(looksLikeLoginScreen("Sign in with Google")).toBe(true);
  });

  it("준비된 CLI 출력은 로그인 화면이 아니다", () => {
    expect(looksLikeLoginScreen("Loaded 41 MCP tools\n? for shortcuts\n")).toBe(
      false,
    );
    expect(looksLikeLoginScreen("Explain this codebase")).toBe(false);
    expect(looksLikeLoginScreen("")).toBe(false);
  });
});
