/**
 * 컴포저 판정 — **실측 PTY 녹화로** 잠근다 (티켓 RtyOMpOArfI7a5JNSzsg).
 *
 * 이 판정이 틀리면 두 가지 중 하나가 난다: 오염을 못 막거나(고치려던 병), 멀쩡한
 * 전달을 영영 막거나(고치다 만든 병). 그래서 화면 읽기는 상상이 아니라
 * `tests/fixtures/pty` 의 **진짜 바이트**로 검증한다 — 클로드는 단어 사이를 커서
 * 이동으로 칠해 공백이 사라지고(`❯1.No,exit`), 코덱스는 컴포저를 개행 없이
 * 절대좌표로 그린다. 손으로 지어낸 문자열로는 둘 다 놓친다.
 *
 * GUI 를 띄우지 않는다(AGENTS.md "★GUI 를 띄우는 검증 금지") — 순수 함수와
 * 순수 클래스만 돈다.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  ComposerTracker,
  verdictFor,
  type ComposerState,
} from "../../electron/composer-gate";
import {
  classifyComposerLine,
  classifyComposerRaw,
  classifyTranscriptLine,
  EMPTY_PROMPT_RE,
} from "../../electron/transcript-lines";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures", "pty");

/** 녹화 1개를 원시 바이트 한 덩이로 되살린다. */
function replay(name: string): string {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"),
  ) as { frames: Array<{ b64: string }> };
  return raw.frames.map((f) => Buffer.from(f.b64, "base64").toString("utf8")).join("");
}

/** 녹화를 청크 단위 그대로 흘려 넣는다(실제 onData 와 같은 조각남). */
function feedRecording(t: ComposerTracker, id: string, name: string): void {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"),
  ) as { frames: Array<{ b64: string }> };
  for (const f of raw.frames) {
    t.observe(id, Buffer.from(f.b64, "base64").toString("utf8"));
  }
}

describe("실측 녹화에서 컴포저를 읽어 낸다", () => {
  it("클로드 준비 화면 = 빈 컴포저", () => {
    const t = new ComposerTracker();
    feedRecording(t, "s", "claude-composer-after-consent");
    expect(t.state("s")).toBe<ComposerState>("empty");
  });

  it("코덱스 준비 화면 = 빈 컴포저 (자리표시자는 정의상 내용이 없다)", () => {
    // ★이 녹화는 마지막에 컴포저로 `PING-MARBLO-BOOT-PROBE …` 를 **절대좌표로**
    //   칠한다(`\x1b[14;3H…`). 화살표를 다시 안 그리므로 화면만으로는 그 글자가
    //   컴포저인지 트랜스크립트인지 못 가른다 — 그래서 마지막 양성 증거인
    //   자리표시자(빈 컴포저)가 남는다. 이런 하네스에서 초안을 잡아 주는 것은
    //   입력측 증거다(아래 "입력측" describe).
    const t = new ComposerTracker();
    feedRecording(t, "s", "codex-ready-composer");
    expect(t.state("s")).toBe<ComposerState>("empty");
  });

  it("★클로드 bypass 동의 화면 = 확인 다이얼로그 (첫 글자가 선택으로 소비되는 자리)", () => {
    const t = new ComposerTracker();
    feedRecording(t, "s", "claude-first-run-consent");
    expect(t.state("s")).toBe<ComposerState>("awaiting-choice");
    expect(t.verdict("s").refusal).toBe("awaiting-choice");
    expect(t.verdict("s").writable).toBe(false);
  });

  it("★클로드 폴더 신뢰 화면 = 확인 다이얼로그", () => {
    const t = new ComposerTracker();
    feedRecording(t, "s", "claude-folder-trust");
    expect(t.state("s")).toBe<ComposerState>("awaiting-choice");
  });

  it("★공백이 사라진 실제 바이트에도 걸린다 (커서 이동으로 칠한 선택지)", () => {
    // 녹화 안에 이 모양이 실제로 들어 있음을 먼저 못박는다 — fixture 가 바뀌면
    // 이 테스트가 먼저 깨져야 한다.
    const consent = replay("claude-first-run-consent");
    expect(consent).toContain("1.");
    expect(classifyComposerLine("❯1.No,exit")).toBe("dialog");
    expect(classifyComposerLine("Entertoconfirm·Esctocancel")).toBe("dialog");
  });
});

describe("줄 하나의 판정", () => {
  it("빈 프롬프트 화살표", () => {
    expect(classifyComposerLine("❯ ")).toBe("empty");
    expect(classifyComposerLine("›")).toBe("empty");
  });

  it("내용이 든 컴포저", () => {
    expect(classifyComposerLine("❯ 쓰다 만 초안")).toBe("text");
    expect(classifyComposerLine("› hello")).toBe("text");
  });

  it("★트랜스크립트의 지나간 사용자 셀(`> …`)은 컴포저가 아니다", () => {
    // 이걸 컴포저로 읽으면 대화 기록이 있는 모든 세션이 영원히 occupied 가 된다.
    expect(classifyComposerLine("> 아까 제가 보낸 말")).toBeNull();
    // 부트 게이트는 같은 줄을 여전히 `user` 로 본다 — 두 판정은 다른 질문이다.
    expect(classifyTranscriptLine("> 아까 제가 보낸 말")).toBe("user");
  });

  it("[y/n] 계열", () => {
    expect(classifyComposerLine("Continue? [y/n]")).toBe("dialog");
    expect(classifyComposerLine("Overwrite? (yes/no)")).toBe("dialog");
    expect(classifyComposerLine("Do you want to proceed?")).toBe("dialog");
  });

  it("★진행 상태줄(`esc to cancel`)을 다이얼로그로 오인하지 않는다", () => {
    // 제미나이의 busy 상태줄이다. 이걸 다이얼로그로 읽으면 일하는 에이전트에게
    // 아무것도 못 보낸다.
    expect(classifyComposerLine("esc to cancel")).toBeNull();
  });

  it("아무 말도 안 하는 줄은 null (모르면 모른다고 한다)", () => {
    expect(classifyComposerLine("⏺ Bash(ls)")).toBeNull();
    expect(classifyComposerLine("")).toBeNull();
    expect(classifyComposerLine("   ")).toBeNull();
  });

  it("빈 프롬프트 패턴은 부트 게이트와 **같은 정규식**을 공유한다", () => {
    expect(EMPTY_PROMPT_RE.test("❯")).toBe(true);
    expect(classifyTranscriptLine("❯")).toBe("chrome");
  });
});

describe("전면 TUI 함정 — 개행 없는 리페인트", () => {
  it("★커서 이동으로 이어 붙인 한 줄에서 컴포저만 떼어 읽는다", () => {
    // 코덱스 실측 모양: 히스토리 셀 → 절대좌표 이동 → 컴포저 → 또 이동.
    const raw =
      "\x1b[11;1H• 안녕하세요, 무엇을 도와드릴까요?\x1b[14;1H› 쓰다 만 초안\x1b[16;1H  100% context left";
    expect(classifyComposerRaw(raw)).toBe("text");
  });

  it("★CR 덮어쓰기: 마지막 페인트가 이긴다", () => {
    const t = new ComposerTracker();
    t.observe("s", "\r\x1b[2K❯ 초안");
    expect(t.state("s")).toBe("occupied");
    t.observe("s", "\r\x1b[2K❯ ");
    expect(t.state("s")).toBe("empty");
  });

  it("★한 줄 안에 증거가 여럿이면 나중 것이 이긴다", () => {
    // 같은 리페인트 안에서 컴포저를 지우고 다시 그리는 경우.
    expect(classifyComposerRaw("\x1b[14;1H› 초안\x1b[14;1H›")).toBe("empty");
  });
});

describe("입력측 증거 — 화면을 못 읽는 하네스", () => {
  it("친 글자가 있고 CR 이 없으면 occupied (화면이 아무 말 안 해도)", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "쓰다 만 초안");
    expect(t.state("s")).toBe("occupied");
  });

  it("★CR 을 쓰면 풀린다 — 평범한 셸 PTY 가 첫 메시지 뒤로 굳지 않게", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "명령어");
    expect(t.state("s")).toBe("occupied");
    t.noteInput("s", "\r");
    expect(t.state("s")).toBe("indeterminate");
  });

  it("화살표키·Esc·Ctrl-C 는 글자가 아니다", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "\x1b[A"); // ↑
    t.noteInput("s", "\x1b"); // Esc
    t.noteInput("s", "\x03"); // Ctrl-C
    expect(t.state("s")).toBe("indeterminate");
  });

  it("★화면이 입력 이후를 그렸으면 화면을 믿는다 (사람이 쳤다가 지운 경우)", () => {
    let clock = 1_000;
    const t = new ComposerTracker({ now: () => clock });
    t.noteInput("s", "쓰다 만 초안");
    expect(t.state("s")).toBe("occupied");
    clock += 50;
    t.observe("s", "\r\x1b[2K❯ "); // Ctrl-U 로 지운 뒤의 리페인트
    expect(t.state("s")).toBe("empty");
  });

  it("★화면이 입력보다 낡았으면 입력을 믿는다", () => {
    let clock = 1_000;
    const t = new ComposerTracker({ now: () => clock });
    t.observe("s", "\r\x1b[2K❯ ");
    expect(t.state("s")).toBe("empty");
    clock += 50;
    t.noteInput("s", "방금 치기 시작했다");
    expect(t.state("s")).toBe("occupied");
  });
});

describe("모르면 모른다고 한다 (3분기 규율)", () => {
  it("처음 보는 세션은 indeterminate — 그리고 **쓴다**", () => {
    const t = new ComposerTracker();
    expect(t.state("nope")).toBe("indeterminate");
    expect(t.verdict("nope").writable).toBe(true);
  });

  it("컴포저 얘기를 한 적 없는 출력만 흘러도 indeterminate", () => {
    const t = new ComposerTracker();
    t.observe("s", "make: *** [build] Error 1\n");
    expect(t.state("s")).toBe("indeterminate");
  });

  it("쓰지 않는 상태는 둘뿐이고, 둘 다 사유가 있다", () => {
    expect(verdictFor("empty").writable).toBe(true);
    expect(verdictFor("indeterminate").writable).toBe(true);
    for (const s of ["occupied", "awaiting-choice"] as const) {
      const v = verdictFor(s);
      expect(v.writable).toBe(false);
      expect(v.refusal).toBeTruthy();
      expect(v.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("풀림 알림 — 재시도 정책의 트리거", () => {
  it("막힘 → 풀림 전이에서만 발화한다", () => {
    const t = new ComposerTracker();
    const freed: string[] = [];
    t.onFree((id) => freed.push(id));

    t.observe("s", "\r\x1b[2K❯ 초안");
    expect(freed).toEqual([]);
    t.observe("s", "\r\x1b[2K❯ 초안 더"); // 여전히 막힘 — 알리지 않는다
    expect(freed).toEqual([]);
    t.observe("s", "\r\x1b[2K❯ "); // 주인이 제출했다
    expect(freed).toEqual(["s"]);
    t.observe("s", "\r\x1b[2K❯ "); // 계속 비어 있어도 다시 알리지 않는다
    expect(freed).toEqual(["s"]);
  });

  it("다이얼로그가 닫혀도 발화한다", () => {
    const t = new ComposerTracker();
    const freed: string[] = [];
    t.onFree((id) => freed.push(id));
    t.observe("s", "Do you want to proceed?\n");
    expect(t.state("s")).toBe("awaiting-choice");
    t.observe("s", "\r\x1b[2K❯ ");
    expect(freed).toEqual(["s"]);
  });

  it("세션을 잊으면 상태가 사라진다", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "초안");
    expect(t.state("s")).toBe("occupied");
    t.forget("s");
    expect(t.state("s")).toBe("indeterminate");
  });
});

describe("낡은 화면 증거는 지금 화면이 아니다", () => {
  it("★증거 없이 화면 한 판이 지나가면 indeterminate 로 떨어진다", () => {
    // 왜 이 완화가 필요한가: 다이얼로그가 답해져 사라져도 그 자리에 컴포저
    // 증거가 **곧바로** 안 올 수 있다(코덱스는 바뀐 영역만 칠한다). 그때
    // 오래전 관측 하나가 그 세션의 모든 전달을 영원히 막으면, 유실을
    // 고치겠다고 유실을 만드는 것이다. `agent-input-wait` 의 1024자 롤링
    // 창(`dialogBuffer`)과 같은 규율이다.
    const t = new ComposerTracker();
    t.observe("s", "Do you want to proceed?\n");
    expect(t.state("s")).toBe("awaiting-choice");

    // 컴포저 얘기를 전혀 안 하는 출력이 화면 한 판만큼 흐른다.
    t.observe("s", `${"x".repeat(5_000)}\n`);
    expect(t.state("s")).toBe("indeterminate");
    expect(t.verdict("s").writable).toBe(true);
  });

  it("증거가 다시 오면 시한이 되감긴다", () => {
    const t = new ComposerTracker();
    t.observe("s", "\r\x1b[2K❯ 초안");
    t.observe("s", `${"x".repeat(3_000)}\n`);
    expect(t.state("s")).toBe("occupied"); // 아직 시한 안
    t.observe("s", "\r\x1b[2K❯ 초안"); // 리페인트 = 갱신
    t.observe("s", `${"x".repeat(3_000)}\n`);
    expect(t.state("s")).toBe("occupied");
  });

  it("★입력측 증거에는 시한이 없다 (화면에서 온 게 아니라 낡을 수 없다)", () => {
    const t = new ComposerTracker();
    t.noteInput("s", "사람이 치던 초안");
    t.observe("s", `${"x".repeat(9_000)}\n`);
    expect(t.state("s")).toBe("occupied");
  });

  it("시한이 풀리는 것도 '풀림' 으로 알린다 (보류분이 되살아나야 한다)", () => {
    const t = new ComposerTracker();
    const freed: string[] = [];
    t.onFree((id) => freed.push(id));
    t.observe("s", "Do you want to proceed?\n");
    t.observe("s", `${"x".repeat(5_000)}\n`);
    expect(freed).toEqual(["s"]);
  });
});
