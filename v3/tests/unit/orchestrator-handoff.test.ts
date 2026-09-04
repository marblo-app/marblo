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
  summarizeHandoff,
} from "../../electron/orchestrator-handoff";
import {
  dedupeAgainstChain,
  detectFollowUpPromises,
} from "../../electron/mcp-server/work-chain-capture";
import type { WorkChainItem } from "../../electron/mcp-server/work-chain-core";

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
    expect(needsOrchestratorAutoProbe({ envOverride: "claude" })).toBe(false);
    expect(
      needsOrchestratorAutoProbe({ explicit: "codex", perProject: "grok" }),
    ).toBe(false);
  });
});

describe("classifyOrchestratorSelectionSource", () => {
  it("tags explicit / user-per-project / global as user", () => {
    expect(classifyOrchestratorSelectionSource({ explicit: "claude" })).toBe(
      "user",
    );
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

// ── 워크체인이 세션 경계를 넘는가 (티켓 itSrsErpvtwUEcI4Deif) ──────────────
//
// 인수인계 스냅샷은 보드(missions/tasks)는 실었는데 오케의 "다음에 할 일"
// (`workChains/{projectId}`)은 통째로 빠져 있었다 — 새 오케는 체인을 모른 채
// 시작했다. 여기서 못 박는 것:
//   ① 체인이 스냅샷에 실린다.
//   ② 실리는 건 **항목**이지 ready/waiting/done 판정이 아니다. 상태는 새 세션이
//      보드에서 다시 파생한다(`deriveWorkChain` 단일 소스).
//   ③ 인수인계 텍스트가 자동 포착 필터를 다시 지나가도 **자기 자신을 항목으로
//      포착하지 않는다**(#1176, 2026-08-24 오포착 12건).

function chainItem(
  over: Partial<WorkChainItem> & { id: string; what: string },
): WorkChainItem {
  return {
    why: "세션이 갈려도 남아야 하는 이유",
    afterTaskIds: [],
    afterItemIds: [],
    taskIds: [],
    doneWhen: "done",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "orchestrator-p1",
    ...over,
  };
}

function taskDoc(
  id: string,
  data: Record<string, unknown>,
): { id: string; data: Record<string, unknown> } {
  return { id, data: { projectId: "project-1", title: id, ...data } };
}

const CAPTURE_SURFACES = [
  "owner_report",
  "answer",
  "activity",
  "dispatch_instruction",
] as const;

describe("handoff snapshot work chain", () => {
  it("체인을 스냅샷에 싣되 보드가 끝냈다고 말하는 항목은 빼고 남은 일만 넘긴다", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [
        taskDoc("t-merged", { status: "DONE" }),
        taskDoc("t-live", { status: "IN_PROGRESS" }),
      ],
      workChain: {
        rev: 12,
        items: [
          chainItem({
            id: "closed-by-board",
            what: "머지한 티켓 둘 마감",
            taskIds: ["t-merged"],
          }),
          chainItem({
            id: "waiting",
            what: "v3.0.36 재컷",
            afterTaskIds: ["t-live"],
          }),
          chainItem({ id: "ready", what: "GitHub App 등록" }),
        ],
      },
    });
    expect(snapshot.workChain?.items.map((i) => i.id)).toEqual([
      "waiting",
      "ready",
    ]);
    expect(snapshot.workChain?.rev).toBe(12);
    expect(summarizeHandoff(snapshot).openWorkChainCount).toBe(2);
  });

  it("암묵 미션 라벨을 함께 싣고, 그 미션 티켓으로 완료를 판정한다 (#1168)", () => {
    const missions = [
      {
        id: "m-open",
        data: {
          projectId: "project-1",
          missionKind: "implicit",
          implicitLabel: "이탈자 메일",
          status: "active",
        },
      },
      {
        id: "m-done",
        data: {
          projectId: "project-1",
          missionKind: "implicit",
          implicitLabel: "온보딩 정리",
          status: "completed",
        },
      },
    ];
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions,
      tasks: [
        taskDoc("t-mail-1", { status: "DONE", contextId: "m-open" }),
        taskDoc("t-mail-2", { status: "REVIEW", contextId: "m-open" }),
        taskDoc("t-onb", { status: "DONE", contextId: "m-done" }),
      ],
      workChain: {
        rev: 3,
        items: [
          chainItem({
            id: "mail",
            what: "이탈 사유 청취 메일 발송",
            missionLabel: "이탈자 메일",
          }),
          chainItem({
            id: "onboarding",
            what: "온보딩 배치 마무리",
            missionLabel: "온보딩 정리",
          }),
        ],
      },
    });
    // 라벨 조인이 살아 있다: 미션 티켓이 전부 DONE 인 항목은 안 실린다.
    expect(snapshot.workChain?.items.map((i) => i.id)).toEqual(["mail"]);
    // ★라벨 자체는 반드시 따라간다 — 없으면 새 세션이 진행률을 파생할 수 없다.
    expect(snapshot.workChain?.items[0].missionLabel).toBe("이탈자 메일");
  });

  it("★암묵 미션은 active mission 으로 세지 않는다 (pfEBF4VEhyM1P1iw7Aem / 진단 #1402)", () => {
    // 실측 사고: 이 프로젝트 미션 24건 중 active 3건이 전부 implicit·steps [] 였다.
    // implicit 은 `wire.ts` 가드로 엔진 픽업에서 빠지므로 운전할 대상은 0건인데,
    // 이 스냅샷만 가드를 안 거쳐 인수인계 프롬프트가 새 오케에게
    // "3 active mission(s)" 라고 알려 줬다 — 폐루프가 도는 것처럼 보이던 이유.
    const missions = [
      {
        id: "27CNOI0pdxvsSjVwuB3x",
        data: {
          projectId: "project-1",
          missionKind: "implicit",
          implicitLabel: "지난 배치",
          status: "active",
          steps: [],
        },
      },
      {
        id: "N2hEH1t7Eh8WdAxQS0KC",
        data: {
          projectId: "project-1",
          missionKind: "implicit",
          implicitLabel: "또 다른 배치",
          status: "active",
          steps: [],
        },
      },
    ];
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions,
      tasks: [],
    });

    expect(snapshot.activeMissions).toEqual([]);
    expect(summarizeHandoff(snapshot).activeMissionCount).toBe(0);
    // 프롬프트도 같은 답을 해야 한다 — 여기가 새 오케가 실제로 읽는 문장이다.
    expect(formatHandoffPrompt(snapshot, "takeover")).toContain(
      "0 active mission(s)",
    );
  });

  it("실행 가능한 미션은 그대로 실린다 — 암묵 미션과 섞여 있어도 (반대 방향)", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [
        {
          id: "label",
          data: {
            projectId: "project-1",
            missionKind: "implicit",
            implicitLabel: "지난 배치",
            status: "active",
          },
        },
        {
          id: "real",
          data: {
            projectId: "project-1",
            goal: "로그인 화면 고치기",
            status: "active",
            currentStepIndex: 1,
          },
        },
      ],
      tasks: [],
    });

    expect(snapshot.activeMissions.map((m) => m.id)).toEqual(["real"]);
    expect(summarizeHandoff(snapshot).activeMissionCount).toBe(1);
  });

  it("체인을 못 읽었으면 필드 자체가 없고, 프롬프트가 그 사실을 말한다", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [],
    });
    expect(snapshot.workChain).toBeUndefined();
    expect(summarizeHandoff(snapshot).openWorkChainCount).toBe(0);
    const prompt = formatHandoffPrompt(snapshot, "wait");
    expect(prompt).toContain("could not be read");
    expect(prompt).toContain("get_work_chain");
  });

  it("프롬프트가 '항목만 실렸다 · 상태는 다시 파생해라 · 완료는 적지 마라' 를 못 박고 잘린 수를 밝힌다", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      chainItem({ id: `i${i}`, what: `남은 일 ${i}` }),
    );
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [],
      workChain: { rev: 1, items },
    });
    const prompt = formatHandoffPrompt(snapshot, "takeover");
    expect(prompt).toContain("stored items ONLY");
    expect(prompt).toContain("get_work_chain to re-derive live state");
    expect(prompt).toContain("Do not record chain completion yourself");
    expect(prompt).toContain("8 of 20 open item(s) were left out");
    expect(prompt).toContain("20 open work chain item(s)");
  });

  it("★인수인계 텍스트가 자동 포착 필터를 다시 지나가도 새 항목을 만들지 않는다", () => {
    // 항목 본문은 오케가 실제로 쓴 문장이라 포착 마커가 그대로 들어 있다 —
    // 자동 포착이 적은 항목이 바로 이런 모양이다.
    const items = [
      chainItem({
        id: "a",
        what: "보안규칙을 한 번 더 배포해야 합니다",
        why: "escalate_to_owner(note) 에서 포착: 미배포면 조용히 안 된다",
        source: "auto",
        sourceTool: "escalate_to_owner",
      }),
      chainItem({
        id: "b",
        what: "후속: v3.0.36 을 다시 컷하겠다",
        why: "재컷 전엔 배포가 막힌다",
        source: "auto",
        sourceTool: "add_activity",
      }),
      chainItem({
        id: "c",
        what: "다음 할 일: GitHub App 등록을 사장님께 요청",
        why: "사장님 대기 항목",
      }),
    ];
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [],
      workChain: { rev: 1, items },
    });
    let totalDetected = 0;
    for (const mode of ["wait", "takeover"] as const) {
      const prompt = formatHandoffPrompt(snapshot, mode);
      for (const surface of CAPTURE_SURFACES) {
        const detected = detectFollowUpPromises(prompt, surface);
        totalDetected += detected.length;
        // 잡히더라도 전부 이미 체인에 있는 항목이라 새로 적히지 않는다.
        expect(dedupeAgainstChain(detected, items)).toEqual([]);
      }
    }
    // ★방어가 두 겹이고, 바깥 겹이 더 세다(티켓 wx9c4NeVtZ1SGcbEISpg).
    //   ① 인수인계 스냅샷은 `JSON.stringify` 로 실린다 = 항목 본문이 전부
    //      큰따옴표 안이다. 인용부 제외가 그걸 통째로 지운다 — 그래서 지금
    //      감지 자체가 0건이다. 직렬화된 데이터는 오케가 지금 하는 말이 아니다.
    //   ② 그래도 뭔가 새면 `dedupeAgainstChain` 이 원문 그대로 잡는다(위 루프).
    //      그게 작동하는 유일한 이유는 `toHandoffItem` 이 `what` 을 자르지 않기
    //      때문이고, 그 규율은 여전히 값을 한다.
    expect(totalDetected).toBe(0);
    // ★①이 "감지기가 원래 이 문장을 못 잡아서" 0건인 게 아님을 못 박는다 —
    // 따옴표를 벗기면 같은 문장이 실제로 걸린다.
    expect(
      detectFollowUpPromises(items[0].what, "owner_report"),
    ).not.toHaveLength(0);
  });

  it("★체인이 비어 있으면 인수인계 문구 자체가 아무것도 포착시키지 않는다", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [],
      workChain: { rev: 0, items: [] },
    });
    for (const mode of ["wait", "takeover"] as const) {
      const prompt = formatHandoffPrompt(snapshot, mode);
      for (const surface of CAPTURE_SURFACES) {
        expect(detectFollowUpPromises(prompt, surface)).toEqual([]);
      }
    }
  });
});
