import { describe, expect, it } from "vitest";
import {
  buildOrchestratorHandoffSnapshot,
  classifyOrchestratorSelectionSource,
  formatHandoffPrompt,
  needsOrchestratorAutoProbe,
  resolveEffectiveOrchestratorModelSetting,
  resolveRestartResumeSessionId,
  resolveSwitchHandoffResumeSessionId,
  sanitizeHandoffValue,
} from "../../electron/orchestrator-handoff";

describe("orchestrator handoff snapshot", () => {
  it("redacts sensitive values and limits mission timeline", () => {
    const contextLog = Array.from({ length: 20 }, (_, i) => ({
      ts: new Date(2026, 0, i + 1),
      type: i === 19 ? "agent.stuck" : "supervisor.note",
      payload: {
        message: `event-${i}`,
        apiKey: "sk-1234567890abcdef",
        nested: { token: "secret-token-value" },
      },
    }));

    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old", claudeSessionId: "claude-old" },
      targetModel: "gpt",
      resumeSessionId: "new",
      missions: [
        {
          id: "mission-1",
          data: {
            projectId: "project-1",
            goal: "Ship feature",
            status: "waiting_for_human",
            currentStepIndex: 0,
            steps: [
              {
                index: 0,
                type: "gstack",
                status: "running",
                args: "use token abc.defghijklmnopqrstuvwxyz",
                liveOutput: "tail with sk-1234567890abcdef",
              },
            ],
            taskIds: ["task-1"],
            contextLog,
            lastActivityAt: new Date(2026, 0, 21),
          },
        },
      ],
      tasks: [],
      now: 123,
    });

    const mission = snapshot.activeMissions[0];
    expect(mission.recentTimeline).toHaveLength(12);
    expect(mission.unresolvedDecisions.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("sk-1234567890abcdef");
    expect(JSON.stringify(snapshot)).toContain("[redacted]");
  });

  it("captures in-flight, blocked, and review board work", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: null },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [
        {
          id: "task-1",
          data: {
            title: "Implement",
            status: "IN_PROGRESS",
            role: "frontend",
            claimedBy: "agent-1",
            updatedAt: new Date(2026, 0, 2),
          },
        },
        {
          id: "task-2",
          data: {
            title: "Blocked",
            status: "BLOCKED",
            role: "backend",
            comment: "needs token sk-1234567890abcdef",
          },
        },
        {
          id: "task-3",
          data: {
            title: "Review",
            status: "REVIEW",
            role: "test",
            prUrl: "https://example.test/pr/1",
          },
        },
      ],
      now: 123,
    });

    expect(snapshot.board.inFlightTasks).toHaveLength(1);
    expect(snapshot.board.blockedTasks).toEqual([
      {
        id: "task-2",
        title: "Blocked",
        comment: "needs token [redacted]",
      },
    ]);
    expect(snapshot.board.reviewTasks).toHaveLength(1);
  });

  it("formats wait and takeover prompts with source-of-truth guardrails", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [],
      now: 123,
    });

    expect(formatHandoffPrompt(snapshot, "wait")).toContain(
      "wait for the user",
    );
    expect(formatHandoffPrompt(snapshot, "takeover")).toContain(
      "continue only the next safe action",
    );
    expect(formatHandoffPrompt(snapshot, "wait")).toContain(
      "Firestore missions/* and tasks/* are the source of truth",
    );
  });

  it("redacts by sensitive key names", () => {
    expect(
      sanitizeHandoffValue({
        accessToken: "plain-token",
        nested: { password: "pw" },
      }),
    ).toEqual({
      accessToken: "[redacted]",
      nested: { password: "[redacted]" },
    });
  });

  it("falls back to a new Codex switch session when no saved session exists", () => {
    const resumeSessionId = resolveSwitchHandoffResumeSessionId({
      resume: "previous",
      targetModel: "gpt",
      hasSavedIsolatedHomeSession: () => false,
      resolvePreviousNonGptSession: () => {
        throw new Error("non-gpt resolver should not run for Codex");
      },
    });

    expect(resumeSessionId).toBe("new");
  });

  it("uses Codex latest only when the isolated orchestrator home has a saved session", () => {
    const resumeSessionId = resolveSwitchHandoffResumeSessionId({
      resume: "previous",
      targetModel: "gpt",
      hasSavedIsolatedHomeSession: () => true,
      resolvePreviousNonGptSession: () => null,
    });

    expect(resumeSessionId).toBe("latest");
  });

  it("keeps non-Codex switch resume resolution on the orchestrator labels", () => {
    const resumeSessionId = resolveSwitchHandoffResumeSessionId({
      resume: "previous",
      targetModel: "claude",
      hasSavedIsolatedHomeSession: () => {
        throw new Error("Codex saved-session check should not run for Claude");
      },
      resolvePreviousNonGptSession: () => "claude-session-1",
    });

    expect(resumeSessionId).toBe("claude-session-1");
  });
});

describe("resolveRestartResumeSessionId", () => {
  // Regression: the restart path (stop→start, cold boot, wake-reconnect) used
  // to call resolveOrchestratorResumeId unconditionally — a Claude-only
  // resolver that scans ~/.claude/projects. On a project that had ever run a
  // Claude orchestrator it handed the stored CLAUDE uuid to a Codex launch,
  // producing `codex resume <claude-uuid>`. Verified against codex-cli
  // 0.144.5: that exits 1 immediately with
  //   "ERROR: No saved session found with ID <uuid>"
  // i.e. the orchestrator died on every restart. Codex sessions live in the
  // isolated CODEX_HOME, never in ~/.claude — so the Claude resolver must
  // never run for Codex.
  it("never hands a Claude session id to a Codex restart", () => {
    const resumeSessionId = resolveRestartResumeSessionId({
      targetModel: "gpt",
      hasSavedIsolatedHomeSession: () => true,
      resolvePreviousNonGptSession: () =>
        "62676abb-3e4e-4089-9f94-9429a683175a",
    });

    // Must be the Codex-native sentinel, NOT the Claude uuid.
    expect(resumeSessionId).toBe("latest");
  });

  it("returns null for Codex when the isolated home has no saved session", () => {
    // `codex resume --last` on an empty home boots a fresh session fine, but
    // null lets the caller distinguish "nothing to resume" and skip resuming.
    const resumeSessionId = resolveRestartResumeSessionId({
      targetModel: "gpt",
      hasSavedIsolatedHomeSession: () => false,
      resolvePreviousNonGptSession: () => {
        throw new Error("non-gpt resolver should not run for Codex");
      },
    });

    expect(resumeSessionId).toBeNull();
  });

  it("keeps Claude restart resolution on the orchestrator session store", () => {
    const resumeSessionId = resolveRestartResumeSessionId({
      targetModel: "claude",
      hasSavedIsolatedHomeSession: () => {
        throw new Error("Codex saved-session check should not run for Claude");
      },
      resolvePreviousNonGptSession: () => "claude-session-1",
    });

    expect(resumeSessionId).toBe("claude-session-1");
  });

  it("returns null for Claude when no prior session exists", () => {
    const resumeSessionId = resolveRestartResumeSessionId({
      targetModel: "claude",
      hasSavedIsolatedHomeSession: () => false,
      resolvePreviousNonGptSession: () => null,
    });

    expect(resumeSessionId).toBeNull();
  });
});

describe("resolveEffectiveOrchestratorModelSetting", () => {
  // 라이브 사고 (2026-07-18, 0zV1apB3CvIiabHlYHxQ): 전역 orchestratorModel 이
  // 마지막으로 만진 프로젝트의 값으로 덮여, 앱 재시작 시 claude 대화를 가진
  // 프로젝트가 codex 로 부팅돼 fresh 세션이 떴다("껐다 켜면 연결 안 됨").
  // 프로젝트별 **사용자** 저장 모델이 전역보다 우선해야 재시작 연속성이 지켜진다.
  it("prefers the user per-project model over the global setting on restart", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "claude",
        perProjectSource: "user",
        globalSetting: "codex",
      }),
    ).toBe("claude");
  });

  it("lets an explicit launch request (panel Start) override the per-project memory", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        explicit: "codex",
        perProject: "claude",
        perProjectSource: "user",
        globalSetting: "claude",
      }),
    ).toBe("codex");
  });

  it("boot env override wins everything (dev escape hatch)", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        envOverride: "antigravity",
        explicit: "codex",
        perProject: "claude",
        perProjectSource: "user",
        globalSetting: "codex",
      }),
    ).toBe("antigravity");
  });

  it("falls back global → claude when nothing else is known", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({ globalSetting: "codex" }),
    ).toBe("codex");
    expect(resolveEffectiveOrchestratorModelSetting({})).toBe("claude");
  });

  it("autoFallback (auth priority) only when global is unset", () => {
    // 사용자 명시 설정이 있으면 자동선택을 이긴다.
    expect(
      resolveEffectiveOrchestratorModelSetting({
        globalSetting: "grok",
        autoFallback: "claude",
      }),
    ).toBe("grok");
    // 미설정이면 연결·인증 프로브 결과(Claude>Codex>Grok)를 쓴다.
    expect(
      resolveEffectiveOrchestratorModelSetting({
        autoFallback: "codex",
      }),
    ).toBe("codex");
  });

  // 티켓 R5vxXmsp: 자동으로 박힌 그록이 클로드 복원 후에도 이기는 갭.
  it("auto-saved Grok promotes to Claude when preferred harness is Claude", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "grok",
        perProjectSource: "auto",
        autoFallback: "claude",
      }),
    ).toBe("claude");
  });

  it("legacy per-project without source meta is treated as auto (re-eval)", () => {
    // source 플래그 도입 전 저장값 — 거의 항상 launch 성공 에코(자동 경로).
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "grok",
        // perProjectSource omitted
        autoFallback: "claude",
      }),
    ).toBe("claude");
  });

  it("user-explicit Grok is respected even when Claude is preferred", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "grok",
        perProjectSource: "user",
        autoFallback: "claude",
      }),
    ).toBe("grok");
  });

  it("auto-saved Grok stays Grok when Grok is still the only preferred harness", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "grok",
        perProjectSource: "auto",
        autoFallback: "grok",
      }),
    ).toBe("grok");
  });

  it("auto per-project keeps stored compound when preferred harness matches", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "claude:claude-sonnet-4-6",
        perProjectSource: "auto",
        autoFallback: "claude",
      }),
    ).toBe("claude:claude-sonnet-4-6");
  });

  it("auto per-project without probe result keeps stored value", () => {
    expect(
      resolveEffectiveOrchestratorModelSetting({
        perProject: "grok",
        perProjectSource: "auto",
      }),
    ).toBe("grok");
  });
});

describe("needsOrchestratorAutoProbe", () => {
  it("probes when nothing is set", () => {
    expect(needsOrchestratorAutoProbe({})).toBe(true);
  });

  it("does not probe for user per-project", () => {
    expect(
      needsOrchestratorAutoProbe({
        perProject: "grok",
        perProjectSource: "user",
      }),
    ).toBe(false);
  });

  it("probes for auto / legacy per-project (re-eval path)", () => {
    expect(
      needsOrchestratorAutoProbe({
        perProject: "grok",
        perProjectSource: "auto",
      }),
    ).toBe(true);
    expect(
      needsOrchestratorAutoProbe({
        perProject: "grok",
      }),
    ).toBe(true);
  });

  it("does not probe when global is set and no auto per-project", () => {
    expect(
      needsOrchestratorAutoProbe({
        globalSetting: "codex",
      }),
    ).toBe(false);
  });

  it("still probes auto per-project even if global is set", () => {
    // auto per-project outranks global; re-eval must still run.
    expect(
      needsOrchestratorAutoProbe({
        perProject: "grok",
        perProjectSource: "auto",
        globalSetting: "codex",
      }),
    ).toBe(true);
  });

  it("does not probe when env or this-launch explicit is set", () => {
    expect(
      needsOrchestratorAutoProbe({ envOverride: "claude" }),
    ).toBe(false);
    expect(
      needsOrchestratorAutoProbe({ explicit: "codex", perProject: "grok" }),
    ).toBe(false);
  });
});

describe("classifyOrchestratorSelectionSource", () => {
  it("tags explicit / user-per-project / global as user", () => {
    expect(
      classifyOrchestratorSelectionSource({ explicit: "claude" }),
    ).toBe("user");
    expect(
      classifyOrchestratorSelectionSource({
        perProject: "grok",
        perProjectSource: "user",
      }),
    ).toBe("user");
    expect(
      classifyOrchestratorSelectionSource({ globalSetting: "codex" }),
    ).toBe("user");
  });

  it("tags auto re-eval and first auto pick as auto", () => {
    expect(
      classifyOrchestratorSelectionSource({
        perProject: "grok",
        perProjectSource: "auto",
        autoFallback: "claude",
      }),
    ).toBe("auto");
    expect(
      classifyOrchestratorSelectionSource({ autoFallback: "claude" }),
    ).toBe("auto");
    expect(classifyOrchestratorSelectionSource({})).toBe("auto");
  });
});
