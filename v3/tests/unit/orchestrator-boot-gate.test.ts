/**
 * 오케 부트 출력 게이트 — 비기너 대화창 첫 화면 계약(티켓 fDceJJvz3eam2PMNOWyB).
 *
 * 사장님이 비기너로 새 폴더를 열었을 때 첫 화면에 뜬 것: Codex 배너 ·
 * `permissions: YOLO mode` · Tip 줄 · 주입한 시스템 프롬프트 전문 · `/var/folders/…`
 * 임시 경로 · `Called marblo.get_agent_skill(...)` 와 스킬 본문. 이 테스트는 그
 * 스트림을 **실제 codex 0.149.0 PTY 녹화**(`tests/fixtures/pty`) 위에 더미 에코·
 * 툴 출력·인사말을 얹어 재현하고, 게이트를 통과한 바이트에 그 문자열들이 **없고**
 * 인사말은 **있음**을 기계로 확인한다.
 *
 * ★더미값만 쓴다 — 실제 프롬프트 본문·실제 경로·토큰은 여기 붙이지 않는다.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  OrchestratorBootGate,
  classifyTranscriptLine,
  classifyTranscriptRaw,
  MAX_ARMED_MS,
  PROBE_MAX_MS,
  QUIET_AFTER_ECHO_MS,
} from "../../src/lib/orchestratorBootGate";
import { stripAnsi } from "../../src/lib/ansi";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "pty",
);

function fixtureChunks(name: string): string[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"),
  ) as { frames: Array<{ t: number; b64: string }> };
  return raw.frames.map((f) => Buffer.from(f.b64, "base64").toString("utf8"));
}

// ── 더미 부트 스트림 조각 ─────────────────────────────────────────────────
// 화면에 절대 나오면 안 되는 세 문자열(티켓 완료 기준) — 전부 더미 맥락 안에 있다.
const FORBIDDEN = [
  "YOLO mode",
  "/var/folders",
  "You are the Marblo Orchestrator",
] as const;

const DUMMY_ECHO_LINES = [
  "› You are the Marblo Orchestrator Agent. Read the orchestrator skill file: use",
  '  get_agent_skill("orchestrator") Security guardrail: never cat/print/log raw',
  "  `.env` files. If Marblo MCP tools are unavailable, use fallback CLI:",
  "  /var/folders/xx/dummy-tmp/T/marblo-agent-configs/codex-home-orchestrator-dummy/bin/marblo-fallback",
  "  Wait for user instructions.",
];

const DUMMY_TOOL_LINES = [
  '• Called marblo.get_agent_skill({"role":"orchestrator"})',
  "  └ # Orchestrator Agent 스킬 (더미)",
  "    ## 역할",
  "    너는 더미 오케스트레이터다. 보드에 티켓을 만든다.",
  "    - /tf-add · /tf-start · /tf-status",
];

const GREETING_LINES = [
  "• 안녕하세요! 마블로 오케스트레이터예요. /tf-add, /tf-start, /tf-status 같은",
  "  명령을 써 보세요. 작업 요청하시면 보드에 티켓 생성하고 에이전트 스폰해드릴게요.",
];

const BUSY_FRAME = "\x1b[2K• Working (3s • esc to interrupt)";
const COMPOSER_FRAME =
  "\x1b[2K  › Ask Codex to do anything   ? for shortcuts   100% context left";

/** codex 는 히스토리 줄을 `\n` + 텍스트로 끼워 넣는다(insert_history_lines). */
function historyChunk(lines: string[]): string {
  return (
    "\x1b[1;20r\x1b[19;1H" +
    lines.map((l) => `\n\x1b[0m${l}`).join("") +
    "\x1b[r\x1b[21;1H" +
    COMPOSER_FRAME
  );
}

interface Harness {
  gate: OrchestratorBootGate;
  out: string[];
  advance: (ms: number) => void;
  output: () => string;
}

function makeGate(opts: { sink?: boolean } = {}): Harness {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const gate = new OrchestratorBootGate({
    now: () => now,
    setTimer: (fn, ms) => {
      const entry = { at: now + ms, fn, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  const out: string[] = [];
  if (opts.sink !== false) gate.setSink((text) => out.push(text));
  const advance = (ms: number) => {
    const target = now + ms;
    // 시간순으로 만기 타이머를 돈다(타이머 안에서 새 타이머가 생길 수 있다).
    for (;;) {
      const due = timers
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.cancelled = true;
      due.fn();
    }
    now = target;
  };
  return { gate, out, advance, output: () => stripAnsi(out.join("")) };
}

describe("classifyTranscriptLine — 줄 문법", () => {
  it("codex 배너·컴포저·상태줄은 어시스턴트가 아니다(실제 녹화 바이트)", () => {
    const lines = fixtureChunks("codex-ready-composer")
      .join("")
      .split(/\r?\n/)
      .map((l) => stripAnsi(l))
      .filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect(classifyTranscriptLine(line)).not.toBe("assistant");
    }
    expect(lines.some((l) => classifyTranscriptLine(l) === "banner")).toBe(
      true,
    );
  });

  it("claude 환영 상자·동의 화면도 배너다(커서 이동으로 칠한 공백 없는 줄 포함)", () => {
    for (const name of [
      "claude-composer-after-consent",
      "claude-first-run-consent",
    ]) {
      const lines = fixtureChunks(name)
        .join("")
        .split(/\r?\n/)
        .map((l) => stripAnsi(l));
      expect(
        lines.some((l) => classifyTranscriptLine(l) === "banner"),
        name,
      ).toBe(true);
      expect(
        lines.some((l) => classifyTranscriptLine(l) === "assistant"),
        name,
      ).toBe(false);
    }
  });

  it("tool call 셀·결과·사용자 에코는 어시스턴트가 아니다", () => {
    for (const l of [...DUMMY_ECHO_LINES, ...DUMMY_TOOL_LINES]) {
      expect(classifyTranscriptLine(l), l).not.toBe("assistant");
    }
    expect(classifyTranscriptLine(DUMMY_ECHO_LINES[0])).toBe("user");
    expect(classifyTranscriptLine(DUMMY_TOOL_LINES[0])).toBe("tool");
    expect(classifyTranscriptLine("⏺ Bash(ls -la)")).toBe("tool");
    expect(
      classifyTranscriptLine(
        '⏺ marblo - get_agent_skill (MCP)(role: "orchestrator")',
      ),
    ).toBe("tool");
    expect(classifyTranscriptLine("  ⎿  # 스킬 본문")).toBe("tool");
    expect(
      classifyTranscriptLine("> You are the Marblo Orchestrator Agent."),
    ).toBe("user");
    expect(classifyTranscriptLine(BUSY_FRAME)).toBe("busy");
  });

  it("★한 줄짜리 인사말 뒤에 줄바꿈 없이 컴포저 리드로우가 붙어도 어시스턴트다(조각 분류)", () => {
    const merged =
      "\x1b[0m• 안녕하세요! 마블로예요.\x1b[r\x1b[21;1H\x1b[2K  › Ask Codex to do anything   ? for shortcuts";
    expect(classifyTranscriptRaw(merged)).toBe("assistant");
    // 클로드의 가로 이동(`CSI 6G`)으로 칠한 배너는 쪼개지지 않는다.
    expect(
      classifyTranscriptRaw("⏵⏵\x1b[6Gbypass\x1b[13Gpermissions\x1b[25Gon"),
    ).toBe("banner");
    // 컴포저만 있는 줄은 여전히 크롬이다.
    expect(
      classifyTranscriptRaw("\x1b[21;1H\x1b[2K  › Ask Codex to do anything"),
    ).toBe("chrome");
  });

  it("어시스턴트 발화는 하네스 접두(⏺ / • / ✦)로 알아본다", () => {
    expect(classifyTranscriptLine(GREETING_LINES[0])).toBe("assistant");
    expect(classifyTranscriptLine("⏺ 안녕하세요! 무엇을 도와드릴까요?")).toBe(
      "assistant",
    );
    expect(classifyTranscriptLine("✦ Hello! How can I help?")).toBe(
      "assistant",
    );
    // 들여쓴 • 는 툴 출력 안의 글머리표일 수 있다 — 열 0 에서만 인정.
    expect(classifyTranscriptLine("    • 들여쓴 글머리표")).not.toBe(
      "assistant",
    );
  });
});

describe("OrchestratorBootGate — 비기너 첫 화면", () => {
  it("★codex 부트(실제 녹화) + 프롬프트 에코 + 툴 출력은 버리고 인사말부터 통과한다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");
    expect(h.out.join("")).toBe("");

    h.gate.feed(historyChunk(DUMMY_ECHO_LINES));
    h.gate.feed(BUSY_FRAME);
    h.advance(800);
    h.gate.feed(historyChunk(DUMMY_TOOL_LINES));
    expect(h.gate.state).toBe("armed");
    expect(h.out.join("")).toBe("");

    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("assistant-line");

    const shown = h.output();
    for (const s of FORBIDDEN) expect(shown).not.toContain(s);
    expect(shown).not.toContain("OpenAI Codex");
    expect(shown).not.toContain("Called marblo");
    expect(shown).not.toContain("Orchestrator Agent 스킬");
    // 인사말은 첫 글자부터 그대로.
    expect(shown).toContain(GREETING_LINES[0]);
    expect(shown).toContain(GREETING_LINES[1]);
    // 열린 뒤에는 모든 바이트가 그대로 통과한다(이후 대화는 원시 그대로).
    h.gate.feed("\x1b[2K  › 다음 질문");
    expect(h.out[h.out.length - 1]).toBe("\x1b[2K  › 다음 질문");
  });

  it("★한 청크(replay) 안에 부트부터 인사말까지 다 와도 인사말부터만 통과한다", () => {
    const h = makeGate();
    const replay =
      fixtureChunks("codex-ready-composer").join("") +
      historyChunk(DUMMY_ECHO_LINES) +
      historyChunk(DUMMY_TOOL_LINES) +
      historyChunk(GREETING_LINES);
    h.gate.feed(replay);
    expect(h.gate.state).toBe("open");
    const shown = h.output();
    for (const s of FORBIDDEN) expect(shown).not.toContain(s);
    expect(shown).toContain(GREETING_LINES[0]);
  });

  it("claude 부트(실제 녹화) → `> 에코` → `⏺ 툴(MCP)` → `⏺ 인사말` 도 같다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("claude-first-run-consent"))
      h.gate.feed(chunk);
    for (const chunk of fixtureChunks("claude-composer-after-consent"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");
    h.gate.feed(
      "\n> You are the Marblo Orchestrator Agent. Read the orchestrator skill file\n",
    );
    h.gate.feed(
      '\n⏺ marblo - get_agent_skill (MCP)(role: "orchestrator")\n  ⎿  # 더미 스킬 본문\n',
    );
    h.gate.feed("\x1b[2K✶ Sprouting… (3s · esc to interrupt)");
    expect(h.gate.state).toBe("armed");
    h.gate.feed("\n⏺ 안녕하세요! 마블로예요. /tf-add 로 시작해 보세요.\n");
    expect(h.gate.state).toBe("open");
    const shown = h.output();
    expect(shown).not.toContain("You are the Marblo Orchestrator");
    expect(shown).not.toContain("Bypass Permissions");
    expect(shown).not.toContain("get_agent_skill");
    expect(shown).toContain("⏺ 안녕하세요! 마블로예요.");
  });

  it("배너 없이 시작하는 스트림(이미 지나간 대화의 replay)은 전부 통과한다 — 과도한 거름 금지", () => {
    const h = makeGate();
    h.gate.feed("\x1b[2K  › 예전에 한 질문\n");
    h.gate.feed("\x1b[0m• 예전 답변입니다.\n");
    expect(h.gate.state).toBe("probing");
    h.advance(PROBE_MAX_MS + 1);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("no-banner");
    expect(h.output()).toContain("예전에 한 질문");
    expect(h.output()).toContain("예전 답변입니다.");
  });

  it("문법을 모르는 하네스: 부트 에코를 본 뒤 조용해지면 연다(이후 출력만) — 에코 전엔 열지 않는다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    // 컴포저가 뜨고 메인이 프롬프트를 치기 전의 틈 — 여기서 열면 에코가 샌다.
    h.advance(QUIET_AFTER_ECHO_MS * 3);
    expect(h.gate.state).toBe("armed");
    h.gate.feed(historyChunk(DUMMY_ECHO_LINES));
    h.gate.feed(historyChunk(["~ 알 수 없는 접두의 답변 ~"]));
    h.advance(QUIET_AFTER_ECHO_MS + 1);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("quiet-after-echo");
    // 열리기 전 바이트는 버렸다 — 새지 않는다.
    expect(h.output()).toBe("");
    h.gate.feed(COMPOSER_FRAME);
    expect(h.output()).toContain("Ask Codex");
    for (const s of FORBIDDEN) expect(h.output()).not.toContain(s);
  });

  it("상한 시간이 지나면 무조건 연다(이후 출력만) — 골격 뒤에 영영 갇히지 않는다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.advance(MAX_ARMED_MS - 1);
    expect(h.gate.state).toBe("armed");
    h.advance(2);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("max-armed");
    expect(h.output()).toBe("");
  });

  it("강제 개방(멈춤 다이얼로그): armed 면 버퍼를 버리고, probing 이면 통과시킨다", () => {
    const armed = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      armed.gate.feed(chunk);
    armed.gate.open("forced");
    expect(armed.gate.state).toBe("open");
    expect(armed.output()).toBe("");

    const probing = makeGate();
    probing.gate.feed("Select login method:\n");
    probing.gate.open("forced");
    expect(probing.output()).toContain("Select login method:");
  });

  it("sink 가 늦게 붙어도(xterm 이 아직 안 열림) 통과분은 잃지 않는다", () => {
    const h = makeGate({ sink: false });
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");
    expect(h.out).toEqual([]);
    h.gate.setSink((t) => h.out.push(t));
    expect(h.output()).toContain(GREETING_LINES[0]);
  });

  it("reset 은 새 마운트의 replay 를 처음부터 다시 판정한다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");
    h.gate.reset();
    expect(h.gate.state).toBe("probing");
    h.out.length = 0;
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");
    expect(h.output()).toBe("");
  });

  it("구독자는 상태 전이마다 한 번씩 불린다", () => {
    const h = makeGate();
    const seen: string[] = [];
    h.gate.subscribe(() => seen.push(h.gate.state));
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(seen).toEqual(["armed", "open"]);
  });
});
