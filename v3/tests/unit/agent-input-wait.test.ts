import { describe, it, expect } from "vitest";
import {
  foldInputWait,
  shouldAutoAcceptBypass,
  INPUT_WAIT_PROMPT_GRACE_MS,
  BYPASS_CONSENT_WINDOW_MS,
} from "../../electron/agent-input-wait";
import { classifyPtyFrame } from "../../electron/agent-status-reconcile";

/**
 * 입력 대기 판정 — #935 의 프레임 분류를 **사람이 필요한가** 로 접는 층.
 *
 * 여기서 지키는 계약은 두 갈래다.
 *   ① 알림이 뜨지 않아야 할 때 뜨지 않는다(끝난 에이전트·일하는 에이전트).
 *   ② 바이패스 동의 화면은 알림이 아니라 **자동 응답**으로 사라진다. 그래서
 *      자동 응답의 게이트를 하나씩 무너뜨려 보고, 하나라도 빠지면 안 쏜다는
 *      것을 확인한다 — 살아 있는 컴포저에 "2⏎" 가 들어가는 것이 이 기능에서
 *      유일하게 비싼 오작동이라서다.
 */

const T0 = 1_000_000;

function base(overrides: Partial<Parameters<typeof foldInputWait>[1]> = {}) {
  return {
    kind: null,
    promptIdleSince: null,
    turnCompletedAt: null,
    terminal: false,
    now: T0,
    ...overrides,
  };
}

describe("foldInputWait", () => {
  it("확인 다이얼로그는 유예 없이 즉시 알린다", () => {
    expect(foldInputWait(null, base({ kind: "awaiting-input" }))).toBe(
      "confirm",
    );
  });

  it("다이얼로그 리페인트가 일반 output 으로 와도 알림이 깜빡이지 않는다", () => {
    // 질문 줄과 선택지 줄이 서로 다른 write 로 오면 뒤 청크는 마커가 없어
    // "output" 으로 분류된다. 서 있는 confirm 이 거기서 꺼지면 알림이 켜졌다
    // 꺼졌다 한다.
    expect(foldInputWait("confirm", base({ kind: "output" }))).toBe("confirm");
    expect(foldInputWait("confirm", base({ kind: "repaint" }))).toBe("confirm");
  });

  it("작업이 재개되면(busy) 서 있던 confirm 을 철회한다", () => {
    expect(foldInputWait("confirm", base({ kind: "busy" }))).toBeNull();
  });

  it("컴포저로 돌아오면(idle-at-prompt) 낡은 confirm 을 철회한다", () => {
    expect(
      foldInputWait("confirm", base({ kind: "idle-at-prompt" })),
    ).toBeNull();
  });

  it("프롬프트 앞 정차는 유예를 채운 뒤에만 알린다", () => {
    const justParked = base({
      kind: "idle-at-prompt",
      promptIdleSince: T0 - (INPUT_WAIT_PROMPT_GRACE_MS - 1),
    });
    expect(foldInputWait(null, justParked)).toBeNull();

    const parked = base({
      kind: "idle-at-prompt",
      promptIdleSince: T0 - INPUT_WAIT_PROMPT_GRACE_MS,
    });
    expect(foldInputWait(null, parked)).toBe("prompt");
  });

  it("프레임 없이 타이머만으로도(하트비트) 유예 경과를 잡는다", () => {
    // 정차한 뒤 완전히 침묵하는 CLI — 새 프레임이 영영 안 온다.
    const parked = base({
      kind: null,
      promptIdleSince: T0 - INPUT_WAIT_PROMPT_GRACE_MS,
    });
    expect(foldInputWait(null, parked)).toBe("prompt");
  });

  it("턴을 끝냈다고 보고한 에이전트는 프롬프트에 서 있어도 알리지 않는다", () => {
    // 이게 없으면 완료한 에이전트 전부에 "답해 주세요" 배지가 붙는다.
    const done = base({
      kind: "idle-at-prompt",
      promptIdleSince: T0 - INPUT_WAIT_PROMPT_GRACE_MS * 10,
      turnCompletedAt: T0 - 1_000,
    });
    expect(foldInputWait(null, done)).toBeNull();
  });

  it("종단(stopped/error/stopRequested) 에이전트는 무엇이 서 있든 철회한다", () => {
    expect(
      foldInputWait(
        "confirm",
        base({ kind: "awaiting-input", terminal: true }),
      ),
    ).toBeNull();
  });

  it("일하다가 다시 output 을 내면 prompt 알림이 저절로 꺼진다", () => {
    // applyPtyFrame 이 promptIdleSince 를 null 로 되돌린 뒤의 상태.
    expect(
      foldInputWait("prompt", base({ kind: "output", promptIdleSince: null })),
    ).toBeNull();
  });

  it("실제 y/n 프레임이 분류기를 통과해 confirm 으로 접힌다", () => {
    // 분류기를 새로 만들지 않았다는 것 자체를 고정한다 — 입력은 #935 의 출력.
    const kind = classifyPtyFrame("Overwrite existing file? [y/n]", "claude");
    expect(kind).toBe("awaiting-input");
    expect(foldInputWait(null, base({ kind }))).toBe("confirm");
  });
});

describe("shouldAutoAcceptBypass", () => {
  const CONSENT_FRAME = [
    "  WARNING: Claude Code running in Bypass Permissions mode",
    "",
    "❯ 1. No, exit",
    "  2. Yes, I accept",
  ].join("\n");

  const ok = {
    chunk: CONSENT_FRAME,
    model: "claude",
    spawnedAt: T0,
    now: T0 + 3_000,
    alreadyAnswered: false,
  };

  it("부팅 직후 claude 의 동의 화면을 답한다", () => {
    expect(shouldAutoAcceptBypass(ok)).toBe(true);
  });

  it("agy(antigravity) 도 같은 플래그를 쓰므로 함께 답한다", () => {
    expect(shouldAutoAcceptBypass({ ...ok, model: "antigravity" })).toBe(true);
  });

  it("ANSI 로 덧칠된 화면도 같은 판정을 받는다", () => {
    const painted = `\x1b[2m  2. \x1b[0m\x1b[1mYes, I accept\x1b[0m`;
    expect(shouldAutoAcceptBypass({ ...ok, chunk: painted })).toBe(true);
  });

  it("래치가 걸린 뒤에는 두 번 답하지 않는다", () => {
    expect(shouldAutoAcceptBypass({ ...ok, alreadyAnswered: true })).toBe(
      false,
    );
  });

  it("부팅 창을 벗어나면 답하지 않는다", () => {
    // 몇 분 뒤의 같은 문자열은 first-run 화면이 아니라 누군가 그 문자열을
    // 출력한 것에 가깝다 — 살아 있는 컴포저에 키를 넣지 않는다.
    expect(
      shouldAutoAcceptBypass({
        ...ok,
        now: T0 + BYPASS_CONSENT_WINDOW_MS + 1,
      }),
    ).toBe(false);
  });

  it("바이패스 플래그를 안 쓰는 하네스에는 답하지 않는다", () => {
    for (const model of ["gpt", "gemini", "grok", "local", undefined]) {
      expect(shouldAutoAcceptBypass({ ...ok, model })).toBe(false);
    }
  });

  it("동의 화면이 아닌 출력에는 답하지 않는다", () => {
    expect(
      shouldAutoAcceptBypass({ ...ok, chunk: "Running tests... 12 passed" }),
    ).toBe(false);
  });
});
