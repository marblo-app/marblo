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
  SILENT_OPEN_MS,
  SILENT_OPEN_BOOTED_MS,
  POST_BOOT_GRACE_MS,
  parsePtySpawnedAt,
  forgetPtyBootSeen,
  hasPtyBootSeen,
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

function makeGate(
  opts: {
    sink?: boolean;
    sessionId?: string;
    /** PTY 가 이만큼 전에 떴다고 본다 — 닫힌 상태 예산의 기준점(스폰 나이). */
    ptyAgeMs?: number;
  } = {},
): Harness {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  const gate = new OrchestratorBootGate({
    sessionId: opts.sessionId,
    ptySpawnedAt: opts.ptyAgeMs === undefined ? null : now - opts.ptyAgeMs,
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

  // ── 침묵 안전망(티켓 vnJWQrrfdLoXPR13rx1B) ────────────────────────────────
  // 종전 안전망 3개(probeMaxChars/probeMaxMs/maxArmedMs)는 **전부 출력이 온 뒤에야**
  // 무장됐다. 0바이트면 타이머가 하나도 안 돌아 probing 에 영원히 갇혔고, 화면엔
  // 로딩 골격이 영구히 남았다. 아래가 그 구멍의 계약이다.

  it("★출력이 한 바이트도 안 와도 probing 에 영원히 갇히지 않는다", () => {
    const h = makeGate();
    h.advance(SILENT_OPEN_MS - 1);
    expect(h.gate.state).toBe("probing");
    h.advance(2);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("silent");
    // 온 게 없으니 샐 것도 없다.
    expect(h.output()).toBe("");
  });

  it("★이미 부트를 지난 세션(같은 sid)으로 리마운트되면 0바이트여도 곧 풀린다", () => {
    const sessionId = "orch-sess-1-1700000000000";
    forgetPtyBootSeen(sessionId);

    // 1차 마운트: 부트를 걸러내고 인사말에서 열렸다 = 이 sid 는 부트를 지났다.
    const first = makeGate({ sessionId });
    for (const chunk of fixtureChunks("codex-ready-composer"))
      first.gate.feed(chunk);
    first.gate.feed(historyChunk(GREETING_LINES));
    expect(first.gate.state).toBe("open");
    expect(hasPtyBootSeen(sessionId)).toBe(true);

    // 2차 마운트(모드 전환): replay 가 0바이트다.
    const second = makeGate({ sessionId });
    second.advance(SILENT_OPEN_BOOTED_MS - 1);
    expect(second.gate.state).toBe("probing");
    second.advance(2);
    expect(second.gate.state).toBe("open");
    expect(second.gate.openReason).toBe("silent");
    expect(second.output()).toBe("");
  });

  it("★처음 보는 세션은 짧은 침묵으로 열리지 않는다 — 느린 스폰의 배너가 새면 안 된다", () => {
    const sessionId = "orch-sess-2-1700000000000";
    forgetPtyBootSeen(sessionId);
    const h = makeGate({ sessionId });
    // 부트를 본 적 없는 sid 는 짧은 한도로 열지 않는다.
    h.advance(SILENT_OPEN_BOOTED_MS * 4);
    expect(h.gate.state).toBe("probing");
    // 느리게 뜬 CLI 의 배너가 이제야 온다 — 종전대로 무장하고 거른다.
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("assistant-line");
    for (const s of FORBIDDEN) expect(h.output()).not.toContain(s);
    expect(h.output()).toContain(GREETING_LINES[0]);
  });

  it("★침묵 한도 전에 바이트가 오면 종전 경로가 그대로 소유한다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");
    // 침묵 한도를 넘겨도 armed 는 maxArmedMs 가 소유한다 — "silent" 로 열리지 않는다.
    h.advance(SILENT_OPEN_MS + 1);
    expect(h.gate.openReason).toBe("max-armed");
  });

  it("★reset(새 마운트)도 침묵 안전망을 다시 무장한다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");
    h.gate.reset();
    expect(h.gate.state).toBe("probing");
    h.advance(SILENT_OPEN_MS + 1);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("silent");
  });

  it("강제 개방·침묵 개방은 '부트를 지났다' 로 기록하지 않는다 — 부트를 본 적이 없다", () => {
    const forced = "orch-sess-3-1700000000000";
    const silent = "orch-sess-4-1700000000000";
    forgetPtyBootSeen(forced);
    forgetPtyBootSeen(silent);

    const f = makeGate({ sessionId: forced });
    f.gate.open("forced");
    expect(hasPtyBootSeen(forced)).toBe(false);

    const s = makeGate({ sessionId: silent });
    s.advance(SILENT_OPEN_MS + 1);
    expect(s.gate.openReason).toBe("silent");
    expect(hasPtyBootSeen(silent)).toBe(false);
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

// ── 부트 예산은 PTY 스폰 시각부터(티켓 04mJqRvSi0QDCboyxzKF) ────────────────
// 종전엔 `maxArmedMs` 가 **이 마운트가 배너를 본 순간**부터 돌았다. 그래서 몇
// 분째 일하고 있는 오케로 화면이 다시 뜨면(마블로 → 비기너 전환) 재생 링의
// 지나간 배너를 지금 일어나는 부팅으로 오인해 60초를 처음부터 다시 셌다.
// 아래가 그 구멍의 계약이다. ★문은 그대로다 — 갓 뜬 PTY 의 예산은 종전과 같다.
describe("OrchestratorBootGate — 닫힌 상태의 예산은 PTY 스폰부터 잰다", () => {
  it("sid 에서 스폰 시각을 읽는다 — 형식은 orch-<sess>-<Date.now()>", () => {
    expect(parsePtySpawnedAt("orch-orchestrator-proj-1700000000000")).toBe(
      1_700_000_000_000,
    );
    // 프로젝트 id 가 숫자로 끝나도 마지막 13자리 이상 그룹만 시각이다.
    expect(parsePtySpawnedAt("orch-orchestrator-proj-42-1700000000000")).toBe(
      1_700_000_000_000,
    );
    // 못 읽는 형식은 null — 그 경우 예산은 종전대로 마운트 기준이다.
    expect(parsePtySpawnedAt("orch-bootgate-nope")).toBeNull();
    expect(parsePtySpawnedAt("orch-sess-12345")).toBeNull();
    expect(parsePtySpawnedAt(null)).toBeNull();
  });

  it("★몇 분째 일하고 있는 오케로 리마운트하면 armed 가 60초를 다시 세지 않는다", () => {
    // 재생 링에 부트가 가득하고 어시스턴트 발화는 아직 없다 = 사장님 화면.
    const h = makeGate({ ptyAgeMs: 5 * 60_000 });
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");

    // 유예 안에는 아직 닫혀 있다 — 링 직후 도착하는 라이브 인사말을 받는 창.
    h.advance(POST_BOOT_GRACE_MS - 1);
    expect(h.gate.state).toBe("armed");
    h.advance(2);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("max-armed");
    // 버린 채로 연다 — 지나간 부트는 여전히 안 보여준다.
    expect(h.output()).toBe("");
    for (const s of FORBIDDEN) expect(h.output()).not.toContain(s);
  });

  it("★유예 안에 인사말이 오면 그 줄부터 통과한다 — 리마운트라고 인사말을 잃지 않는다", () => {
    const h = makeGate({ ptyAgeMs: 5 * 60_000 });
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.advance(POST_BOOT_GRACE_MS - 500);
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("assistant-line");
    expect(h.output()).toContain(GREETING_LINES[0]);
    for (const s of FORBIDDEN) expect(h.output()).not.toContain(s);
  });

  it("★갓 뜬 PTY(진짜 부팅 중)의 문은 그대로다 — 예산을 깎지 않는다", () => {
    const h = makeGate({ ptyAgeMs: 1_000 });
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    expect(h.gate.state).toBe("armed");
    // 유예(2.5초)를 훌쩍 넘겨도 닫혀 있다 — 부팅은 아직 안 끝났다.
    h.advance(POST_BOOT_GRACE_MS * 4);
    expect(h.gate.state).toBe("armed");
    // 종전 상한까지는 종전대로 기다린다(스폰 나이 1초만 깎인다).
    h.advance(MAX_ARMED_MS - 1_000 - POST_BOOT_GRACE_MS * 4 - 1);
    expect(h.gate.state).toBe("armed");
    h.advance(2);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("max-armed");
    expect(h.output()).toBe("");
  });

  it("★오래 산 PTY 가 0바이트여도 침묵 시한이 60초를 다 쓰지 않는다", () => {
    const h = makeGate({ ptyAgeMs: 5 * 60_000 });
    h.advance(POST_BOOT_GRACE_MS - 1);
    expect(h.gate.state).toBe("probing");
    h.advance(2);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("silent");
    expect(h.output()).toBe("");
  });

  it("스폰 시각을 모르면 종전 그대로 — 이 규칙은 시한을 만들지도 늘리지도 않는다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.advance(MAX_ARMED_MS - 1);
    expect(h.gate.state).toBe("armed");
    h.advance(2);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("max-armed");
  });
});

// ── 리마운트가 반복되면 어떤 마감도 안 터진다 (티켓 04mJqRvSi0QDCboyxzKF) ──
// 사장님 실화면의 모순: "골격 + 준비하고 있어요 + 계속 시도 중" 이 **끝까지** 남는다.
// 게이트의 마감은 셋 다 있는데(침묵/probeMaxMs/maxArmedMs) 어느 것도 안 터진 것처럼
// 보인다. 그 모순의 답이 여기 있다 — 마감을 **마운트 기준**으로 재면 리마운트가
// 마감보다 잦을 때 타이머가 매번 처음부터 다시 감긴다. 그러면 마감이 "있는데도"
// 영원히 도달하지 않는다.
//
// ★사장님은 vite dev 서버로 돌리신다. 오늘처럼 에이전트들이 계속 머지하면 Vite 가
//   전체 페이지 리로드를 걸고, 그때마다 렌더러가 통째로 다시 뜬다(=리마운트).
//   `bootSeenSids` 도 그때 비므로 #1159 의 sid 레지스트리로는 못 막는다.
//   PTY 스폰 기준 예산은 리로드에 영향받지 않는다 — 그게 이 규칙을 고른 이유다.
describe("OrchestratorBootGate — 리마운트가 잦아도 마감은 도달한다", () => {
  /** 한 PTY 를 여러 번 마운트한다. 매번 새 게이트 + 재생 링(배너)이 다시 온다. */
  function remountCycles(opts: {
    /** 스폰 기준 예산을 쓰는가(수정 후) — false 면 종전(마운트 기준) 재현. */
    spawnBudget: boolean;
    /** 리마운트 간격. */
    everyMs: number;
    /** 몇 번까지 볼 것인가. */
    cycles: number;
  }): { openedAtCycle: number | null; openedAfterMs: number } {
    // 하나의 가상 시계를 모든 마운트가 공유한다 — PTY 는 계속 살아 있다.
    let now = 2_000_000_000_000;
    const spawnedAt = now;
    let timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
    const setTimer = (fn: () => void, ms: number) => {
      const entry = { at: now + ms, fn, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const advance = (ms: number) => {
      const target = now + ms;
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

    for (let cycle = 1; cycle <= opts.cycles; cycle++) {
      // 이전 마운트의 게이트는 언마운트에서 dispose 된다 — 타이머도 같이 죽는다.
      timers = [];
      const gate = new OrchestratorBootGate({
        now: () => now,
        setTimer,
        // 수정 후에만 스폰 시각을 안다. null 이면 종전 동작(마운트 기준).
        ptySpawnedAt: opts.spawnBudget ? spawnedAt : null,
      });
      // 재생 링이 **지나간 배너**를 다시 준다 → armed.
      for (const chunk of fixtureChunks("codex-ready-composer"))
        gate.feed(chunk);
      // 오케는 일하는 중이라 상태줄만 다시 그린다 — 어시스턴트 줄도, 조용함도 없다.
      const step = 250;
      for (let waited = 0; waited < opts.everyMs; waited += step) {
        gate.feed(BUSY_FRAME);
        advance(step);
        if (gate.state === "open") {
          return { openedAtCycle: cycle, openedAfterMs: now - spawnedAt };
        }
      }
      gate.dispose();
    }
    return { openedAtCycle: null, openedAfterMs: now - spawnedAt };
  }

  it("★종전(마운트 기준): 30초마다 리마운트되면 60초 상한에 영원히 도달하지 않는다", () => {
    const r = remountCycles({
      spawnBudget: false,
      everyMs: 30_000,
      cycles: 20,
    });
    // 10분을 돌려도 한 번도 안 열린다 = 사장님이 보시는 "끝까지 골격".
    expect(r.openedAtCycle).toBeNull();
    expect(r.openedAfterMs).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("★수정 후(스폰 기준): 같은 리마운트 주기에서도 예산이 소진돼 열린다", () => {
    const r = remountCycles({ spawnBudget: true, everyMs: 30_000, cycles: 20 });
    expect(r.openedAtCycle).not.toBeNull();
    // 예산(60초)이 스폰부터 소진되므로 세 번째 마운트에서 유예만 남는다.
    expect(r.openedAtCycle!).toBeLessThanOrEqual(3);
    expect(r.openedAfterMs).toBeLessThan(MAX_ARMED_MS + POST_BOOT_GRACE_MS * 2);
  });

  it("★리마운트가 더 잦아도(5초) 스폰 기준 예산은 결국 도달한다 — 종전은 못 한다", () => {
    const legacy = remountCycles({
      spawnBudget: false,
      everyMs: 5_000,
      cycles: 60,
    });
    expect(legacy.openedAtCycle).toBeNull();

    const fixed = remountCycles({
      spawnBudget: true,
      everyMs: 5_000,
      cycles: 60,
    });
    expect(fixed.openedAtCycle).not.toBeNull();
  });
});

// ── dispose 된 게이트는 바이트를 영구히 버린다 ─────────────────────────────
// 오케가 짚은 가설 (b) 의 **결과**를 못으로 박아 둔다: 화면이 읽는 게이트와 먹이를
// 받는 게이트가 갈라지면, 먹이 받던 쪽이 dispose 되는 순간 그 뒤의 모든 바이트가
// 사라지고 되살리는 길은 `reset()` 뿐이다. `TerminalView` 의 init 이펙트만
// `reset()` 을 부르고 그 deps 는 `[sessionId]` 다 — 즉 sid 가 안 바뀌면 복구가 없다.
describe("OrchestratorBootGate — dispose 뒤의 계약", () => {
  it("dispose 된 게이트에 먹인 바이트는 조용히 사라진다", () => {
    const h = makeGate();
    for (const chunk of fixtureChunks("codex-ready-composer"))
      h.gate.feed(chunk);
    h.gate.feed(historyChunk(GREETING_LINES));
    expect(h.gate.state).toBe("open");

    h.gate.dispose();
    h.gate.feed("dispose 뒤에 온 줄\n");
    expect(h.output()).not.toContain("dispose 뒤에 온 줄");
    // 상태도 안 움직인다 — 시한도 없다(타이머는 dispose 가 전부 껐다).
    h.advance(MAX_ARMED_MS * 2);
    expect(h.gate.state).toBe("open");
  });

  it("reset() 만이 dispose 된 게이트를 되살린다 — 그리고 다시 닫아 시한을 건다", () => {
    const h = makeGate();
    h.gate.dispose();
    h.gate.reset();
    expect(h.gate.state).toBe("probing");
    h.gate.setSink((text) => h.out.push(text));
    h.advance(SILENT_OPEN_MS + 1);
    expect(h.gate.state).toBe("open");
    expect(h.gate.openReason).toBe("silent");
  });
});
