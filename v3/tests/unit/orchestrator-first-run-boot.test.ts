/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FIRST-RUN BOOT — replayed against REAL PTY frames
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every fixture under tests/fixtures/pty/ is a verbatim recording of what the
 * CLI actually wrote to a pty on a machine with no prior configuration
 * (isolated HOME / CODEX_HOME, node-pty, 2026-08-21). Nothing here is a
 * hand-written approximation of a TUI screen, because hand-written screens are
 * exactly how this bug survived: the code's assumptions read fine and the real
 * bytes disagreed.
 *
 * What the recordings pinned down:
 *   · claude 2.1.238 stops at `2. Yes, I accept` on first run, and NONE of the
 *     readiness markers the orchestrator had were on its composer afterwards.
 *   · codex 0.149.0 paints a SKELETON composer carrying `? for shortcuts` and
 *     `Ask Codex` ~200 ms BEFORE its login menu appears — so "wait longer after
 *     readiness" cannot work, and only re-reading the screen at write time can.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { OrchestratorManager } from "../../electron/orchestrator-manager";
import {
  BYPASS_CONSENT_CONFIRM,
  BYPASS_CONSENT_CONFIRM_DELAY_MS,
  BYPASS_CONSENT_SELECT,
  BYPASS_CONSENT_WINDOW_MS,
  BYPASS_FLAG_MODELS,
  looksLikeFirstRunDialog,
  looksLikeLiveComposer,
  shouldAutoAcceptBypass,
} from "../../electron/agent-input-wait";
import { stripFrameAnsi } from "../../electron/agent-status-reconcile";
import { looksLikeLoginScreen } from "../../electron/harness-manager";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "pty",
);

interface Frame {
  t: number;
  chunk: string;
}

function frames(name: string): Frame[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"),
  ) as { frames: Array<{ t: number; b64: string }> };
  return raw.frames.map((f) => ({
    t: f.t,
    chunk: Buffer.from(f.b64, "base64").toString("utf8"),
  }));
}

/**
 * The orchestrator's readiness markers, copied here so a change to them has to
 * be made deliberately in two places. Kept in sync by the assertions below,
 * which state what each marker must and must not match on real frames.
 */
const READINESS_PATTERNS = [
  /\? for shortcuts/,
  /Type your message/i,
  /Loaded \d+ MCP tool/i,
  /Ask Codex/i,
  /Enter to send/i,
  /Explain this codebase/i,
  /esc to interrupt/i,
  /\/help for commands/i,
  /\u23f5\u23f5/,
];

/**
 * Replay a recording through the orchestrator's two boot buffers: the RAW
 * 4096-char window readiness is tested against, and the ANSI-stripped
 * 1024-char window the dialog gate is tested against.
 */
function replay(name: string): {
  firstReadinessAt: number | null;
  firstGatedReadinessAt: number | null;
  everDialog: boolean;
  finalDialog: boolean;
  finalStripped: string;
  /**
   * First instant at which a readiness marker matched while NEITHER guard was
   * holding — the dialog gate open and the login backstop seeing nothing. This
   * is the only number that has to be null: it is exactly "the boot prompt
   * would have been typed into whatever was on screen".
   */
  unguardedReadyAt: number | null;
} {
  let raw = "";
  let stripped = "";
  let firstReadinessAt: number | null = null;
  let firstGatedReadinessAt: number | null = null;
  let everDialog = false;
  let unguardedReadyAt: number | null = null;
  for (const f of frames(name)) {
    raw = (raw + f.chunk).slice(-4096);
    stripped = (stripped + stripFrameAnsi(f.chunk)).slice(-1024);
    const dialog = looksLikeFirstRunDialog(stripped);
    if (dialog) everDialog = true;
    const ready = READINESS_PATTERNS.some((re) => re.test(raw));
    if (ready && firstReadinessAt === null) firstReadinessAt = f.t;
    if (ready && !dialog && firstGatedReadinessAt === null) {
      firstGatedReadinessAt = f.t;
    }
    // The orchestrator holds the prompt if EITHER guard says so, so the safety
    // property is about the pair, not about the dialog gate alone.
    if (
      ready &&
      !dialog &&
      !looksLikeLoginScreen(raw) &&
      unguardedReadyAt === null
    ) {
      unguardedReadyAt = f.t;
    }
  }
  return {
    firstReadinessAt,
    firstGatedReadinessAt,
    everDialog,
    finalDialog: looksLikeFirstRunDialog(stripped),
    finalStripped: stripped,
    unguardedReadyAt,
  };
}

describe("claude first-run: the bypass-permissions consent screen", () => {
  it("reaches the consent screen and the auto-accept marker fires on it", () => {
    const hits = frames("claude-first-run-consent").filter((f) =>
      shouldAutoAcceptBypass({
        chunk: f.chunk,
        model: "claude",
        spawnedAt: 0,
        now: f.t,
        alreadyAnswered: false,
        composerProvenLive: false,
      }),
    );
    // The consent screen is real, and exactly one recorded frame carries the
    // accept option — the screen is answered once, not once per repaint.
    expect(hits.length).toBe(1);
    expect(hits[0].t).toBeLessThan(BYPASS_CONSENT_WINDOW_MS);
  });

  it("holds the boot prompt while the consent screen is up", () => {
    const r = replay("claude-first-run-consent");
    expect(r.everDialog).toBe(true);
    expect(r.finalDialog).toBe(true);
    // ★The whole P0: nothing may be typed here. Even if a readiness marker had
    // matched, the gate is shut.
    expect(r.firstGatedReadinessAt).toBeNull();
    expect(r.unguardedReadyAt).toBeNull();
  });

  it("releases the boot prompt once the composer replaces the consent screen", () => {
    const r = replay("claude-composer-after-consent");
    // The dismissed dialog is gone from the 1024-char window — the composer's
    // own repaint pushed it out, which is why the gate is a short window and
    // not a boot-long transcript.
    expect(r.finalDialog).toBe(false);
    expect(r.firstGatedReadinessAt).not.toBeNull();
  });

  it("recognises the composer that YOLO mode actually renders", () => {
    // Regression for the marker that was missing entirely: under
    // --dangerously-skip-permissions claude prints its bypass footer where
    // `? for shortcuts` would otherwise be, so every claude orchestrator boot
    // was falling through to the 10s blind timeout.
    expect(
      /\u23f5\u23f5/.test(
        replay("claude-composer-after-consent").finalStripped,
      ),
    ).toBe(true);
    // …and it never appears on the consent screen.
    expect(
      /\u23f5\u23f5/.test(replay("claude-first-run-consent").finalStripped),
    ).toBe(false);
  });

  it("keeps the footer marker readable however the TUI spaces it", () => {
    // The same footer arrives as `bypass permissions on` in one render path and
    // as `bypasspermissionson` in another (cursor-forward escapes instead of
    // spaces). A text marker would have matched one capture and missed the
    // other, which is why readiness keys off the glyph.
    const composer = replay("claude-composer-after-consent").finalStripped;
    expect(/bypass\s*permissions\s*on/i.test(composer)).toBe(true);
  });
});

describe("codex first-run: the skeleton composer that lies", () => {
  it("matches a readiness marker BEFORE the login menu arrives", () => {
    const r = replay("codex-skeleton-then-login");
    // This is the ordering that makes a delay tweak useless: readiness first,
    // dialog second.
    expect(r.firstReadinessAt).not.toBeNull();
    expect(r.firstReadinessAt!).toBeLessThan(200);
    expect(r.everDialog).toBe(true);
  });

  it("never opens the gate — the skeleton is a dialog frame, and the login menu follows", () => {
    const r = replay("codex-skeleton-then-login");
    // Not once in the whole first-run recording is the boot prompt allowed out.
    expect(r.firstGatedReadinessAt).toBeNull();
    expect(r.unguardedReadyAt).toBeNull();
  });

  it("is recognised as a login screen, so the backstop can fire", () => {
    // The patterns were always there; the orchestrator just never let a codex
    // launch observe them.
    const all = frames("codex-skeleton-then-login")
      .map((f) => stripFrameAnsi(f.chunk))
      .join("");
    expect(looksLikeLoginScreen(all)).toBe(true);
  });

  it("opens the gate on the real, initialised composer", () => {
    const r = replay("codex-ready-composer");
    expect(r.finalDialog).toBe(false);
    expect(r.firstGatedReadinessAt).not.toBeNull();
  });
});

describe("the dialog gate does not fire on ordinary conversation", () => {
  it("leaves a live composer alone", () => {
    // The accident this design guards against is a stray keystroke landing in a
    // running conversation. Ordinary agent output must read as "no dialog".
    for (const text of [
      "Running tests... 12 passed",
      "› Ask Codex to do anything   ? for shortcuts",
      "⏵⏵ bypass permissions on (shift+tab to cycle)",
      "Reading electron/agent-input-wait.ts",
    ]) {
      expect(looksLikeFirstRunDialog(text)).toBe(false);
    }
  });
});

describe("the model axis is one axis", () => {
  it("pins the models that get a bypass flag", () => {
    // orchestrator-manager's YOLO_FLAG condition now reads this very set, so
    // the two can no longer drift. This test states what the set is.
    expect([...BYPASS_FLAG_MODELS].sort()).toEqual(["antigravity", "claude"]);
  });

  it("only auto-accepts for models we actually pass the flag to", () => {
    const consent = frames("claude-first-run-consent").find((f) =>
      /yes,\s*i\s*accept/i.test(stripFrameAnsi(f.chunk)),
    )!;
    for (const model of ["gpt", "grok", "gemini", "local", "custom"]) {
      expect(
        shouldAutoAcceptBypass({
          chunk: consent.chunk,
          model,
          spawnedAt: 0,
          now: 1_000,
          alreadyAnswered: false,
          composerProvenLive: false,
        }),
      ).toBe(false);
    }
    for (const model of BYPASS_FLAG_MODELS) {
      expect(
        shouldAutoAcceptBypass({
          chunk: consent.chunk,
          model,
          spawnedAt: 0,
          now: 1_000,
          alreadyAnswered: false,
          composerProvenLive: false,
        }),
      ).toBe(true);
    }
  });

  it("never fires outside the boot window, however real the frame is", () => {
    const consent = frames("claude-first-run-consent").find((f) =>
      /yes,\s*i\s*accept/i.test(stripFrameAnsi(f.chunk)),
    )!;
    expect(
      shouldAutoAcceptBypass({
        chunk: consent.chunk,
        model: "claude",
        spawnedAt: 0,
        now: BYPASS_CONSENT_WINDOW_MS + 1,
        alreadyAnswered: false,
        composerProvenLive: false,
      }),
    ).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ★F-3 — THE MISFIRE INSIDE THE BOOT WINDOW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The suite above pins "never OUTSIDE the 180 s window". That was the whole
 * guard, and it is not enough: the `alreadyAnswered` latch only arms itself by
 * MEETING the consent screen, so a returning user — who never sees it — is
 * armed for the entire window. Live PTY capture (scenario R, 2026-08-21): boot
 * prompt submitted at 1741 ms, the CLI quoted the accept line at 8243 ms, and
 * `2` + `\r` went into the live conversation at 8244 / 8396 ms. Both instants
 * are comfortably INSIDE 180 s, which is why nothing here caught it.
 *
 * These are the cases that box was missing.
 */
describe("the composer footer tells a live conversation from the consent screen", () => {
  it("matches the composer YOLO mode actually renders", () => {
    const composer = frames("claude-composer-after-consent");
    expect(composer.some((f) => looksLikeLiveComposer(f.chunk))).toBe(true);
  });

  it("matches NO first-run screen — that is what makes it usable as the closer", () => {
    // The consent recording walks the whole first-run chain. If the footer
    // glyph appeared anywhere on it, closing the window on the glyph would
    // suppress the auto-accept on a brand-new Mac.
    for (const f of frames("claude-first-run-consent")) {
      expect(looksLikeLiveComposer(f.chunk)).toBe(false);
    }
    for (const f of frames("codex-skeleton-then-login")) {
      expect(looksLikeLiveComposer(f.chunk)).toBe(false);
    }
  });

  it("survives however the TUI spaces the footer", () => {
    // Same reason BYPASS_ACCEPT_MARKER is written with \s*: claude paints this
    // footer with cursor-forward escapes instead of spaces in one render path.
    expect(looksLikeLiveComposer("\u23f5\u23f5 bypass permissions on")).toBe(
      true,
    );
    expect(looksLikeLiveComposer("\u23f5\u23f5bypasspermissionson")).toBe(true);
  });
});

describe("★the consent auto-accept is disarmed by a live composer", () => {
  function consentChunk(): string {
    return frames("claude-first-run-consent").find((f) =>
      /yes,\s*i\s*accept/i.test(stripFrameAnsi(f.chunk)),
    )!.chunk;
  }

  it("fires on the real screen when nothing has proven the composer live", () => {
    // The regression guard for the guard: the new gate must not cost a new Mac
    // its auto-accept.
    expect(
      shouldAutoAcceptBypass({
        chunk: consentChunk(),
        model: "claude",
        spawnedAt: 0,
        now: 1_000,
        alreadyAnswered: false,
        composerProvenLive: false,
      }),
    ).toBe(true);
  });

  it("★never fires once the composer is proven live — INSIDE the boot window", () => {
    expect(
      shouldAutoAcceptBypass({
        chunk: consentChunk(),
        model: "claude",
        spawnedAt: 0,
        // 8243 ms: the exact instant of the live misfire, deep inside 180 s.
        now: 8_243,
        alreadyAnswered: false,
        composerProvenLive: true,
      }),
    ).toBe(false);
  });

  it("stays disarmed for the rest of the window, not just for one frame", () => {
    for (const now of [1_000, 8_243, BYPASS_CONSENT_WINDOW_MS - 1]) {
      expect(
        shouldAutoAcceptBypass({
          chunk: consentChunk(),
          model: "claude",
          spawnedAt: 0,
          now,
          alreadyAnswered: false,
          composerProvenLive: true,
        }),
      ).toBe(false);
    }
  });
});

/**
 * The wiring, not just the predicates. These drive the REAL launch() with a
 * fake PtyManager and feed the REAL recorded consent frame into whatever data
 * listener launch() registered — so a regression that unhooks the listener (the
 * exact state this ticket found the orchestrator in) fails here, not in
 * production on someone's first day.
 */
describe("OrchestratorManager wires the consent auto-accept to its own PTY", () => {
  let root: string;

  function consentFrame(): string {
    return frames("claude-first-run-consent").find((f) =>
      /yes,\s*i\s*accept/i.test(stripFrameAnsi(f.chunk)),
    )!.chunk;
  }

  function makeHarness() {
    const liveSessions = new Set<string>();
    const listeners: Array<(data: string) => void> = [];
    const ptyManager = {
      onDanger: vi.fn(() => vi.fn()),
      create: vi.fn((id: string) => {
        liveSessions.add(id);
        return { id, name: "Orchestrator", shell: "claude" };
      }),
      kill: vi.fn((id: string) => liveSessions.delete(id)),
      hasSession: (id: string) => liveSessions.has(id),
      setBlockDangerousForSession: vi.fn(),
      onData: vi.fn((_id: string, cb: (data: string) => void) => {
        listeners.push(cb);
      }),
      onExit: vi.fn(),
      write: vi.fn(),
      writeAndSubmit: vi.fn(async () => true),
    };
    const configGenerator = {
      getLaunchConfig: vi.fn(
        (agent: { model: string; command: string }, rootPath: string) => ({
          model: agent.model,
          command: agent.command,
          args: [] as string[],
          env: {} as Record<string, string>,
          mcpConfigPath: path.join(rootPath, "__no_such_mcp_config__.json"),
        }),
      ),
      cleanup: vi.fn(),
      hasSavedSession: vi.fn(() => false),
    };
    const manager = new OrchestratorManager(
      ptyManager as never,
      configGenerator as never,
      undefined,
      "board",
    );
    /** Push one PTY chunk through every listener launch() registered. */
    const feed = (chunk: string) => listeners.forEach((cb) => cb(chunk));
    return { manager, ptyManager, feed };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "orch-consent-"));
    // Boot-prompt readiness runs on timers; keep them off the real clock.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("answers the consent screen with SELECT then CONFIRM", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    feed(consentFrame());
    expect(ptyManager.write).toHaveBeenCalledWith(
      expect.any(String),
      BYPASS_CONSENT_SELECT,
    );
    // The confirm is one tick later so the TUI reads two discrete keys.
    expect(ptyManager.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).toHaveBeenCalledWith(
      expect.any(String),
      BYPASS_CONSENT_CONFIRM,
    );
  });

  it("answers ONCE, however many times the dialog repaints", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    const frame = consentFrame();
    for (let i = 0; i < 5; i += 1) feed(frame);
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);

    // ★The accident this design is built against is a stray `2⏎` reaching a
    // live composer. One answer per PTY, never a second.
    expect(ptyManager.write).toHaveBeenCalledTimes(2);
  });

  it("never answers outside the boot window — a quoted string mid-conversation", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    // Same bytes, arriving after the boot window: an agent reading this very
    // file out loud, not a dialog.
    vi.advanceTimersByTime(BYPASS_CONSENT_WINDOW_MS + 1);
    ptyManager.write.mockClear();
    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);

    expect(ptyManager.write).not.toHaveBeenCalled();
  });

  it("never answers for a harness we do not pass the flag to", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "grok",
    });

    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).not.toHaveBeenCalled();
  });

  it("answers for antigravity too — it carries the same flag", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "antigravity",
    });

    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).toHaveBeenCalledTimes(2);
  });

  /**
   * ★The box that was empty. Everything above proves the auto-accept fires and
   * fires once; the only thing pinned about NOT firing was "after 180 s". The
   * accident happened at 8.2 s.
   */
  function composerFrame(): string {
    return frames("claude-composer-after-consent").find((f) =>
      looksLikeLiveComposer(f.chunk),
    )!.chunk;
  }

  it("★never answers a quoted accept line INSIDE the boot window once the composer went live", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    // Scenario R, frame for frame: the CLI comes up at its composer, and then
    // — 8 seconds later, well inside 180 s — an agent quotes this very file.
    feed(composerFrame());
    vi.advanceTimersByTime(8_000);
    ptyManager.write.mockClear();
    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);

    // Not one byte. A `2` here lands in a live conversation.
    expect(ptyManager.write).not.toHaveBeenCalled();
  });

  it("★never answers after the boot prompt was submitted, even with no composer frame", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    // Drive the real readiness path to an actual boot-prompt submission…
    feed("\u23f5\u23f5 bypass permissions on (shift+tab to cycle)");
    vi.advanceTimersByTime(2_000);
    expect(ptyManager.writeAndSubmit).toHaveBeenCalled();

    ptyManager.write.mockClear();
    vi.advanceTimersByTime(6_000);
    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).not.toHaveBeenCalled();
  });

  it("★refuses a single frame carrying BOTH the footer and the accept line", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    // How the misfire actually arrives in the wild: claude repaints the whole
    // screen around the agent's answer, so the quoting frame carries the
    // composer footer too. The proof must be folded in BEFORE the question.
    feed(
      "\u23f5\u23f5 bypass permissions on\r\nassistant: the marker is 2. Yes, I accept\r\n",
    );
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).not.toHaveBeenCalled();
  });

  it("still answers a new Mac: consent first, composer only afterwards", () => {
    const { manager, ptyManager, feed } = makeHarness();
    manager.launch("proj-1", root, 4242, undefined, "new", undefined, {
      modelOverride: "claude",
    });

    // The live ordering (scenario 1c): consent at 379 ms, composer at 529 ms.
    // Nothing has proven the composer live yet, so the screen is answered.
    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).toHaveBeenCalledTimes(2);

    // …and the composer that replaces it disarms the rest of the window.
    ptyManager.write.mockClear();
    feed(composerFrame());
    vi.advanceTimersByTime(5_000);
    feed(consentFrame());
    vi.advanceTimersByTime(BYPASS_CONSENT_CONFIRM_DELAY_MS);
    expect(ptyManager.write).not.toHaveBeenCalled();
  });
});
