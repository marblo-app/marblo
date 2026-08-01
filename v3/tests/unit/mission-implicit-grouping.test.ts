/**
 * 암묵적 미션 그룹핑 — ad-hoc 보드 배치가 Replay 로 잡히는가 (P1-4).
 *
 * 설계: `docs/MISSION-REPLAY-DESIGN.md` §2.1.
 *
 * 핀하는 계약:
 *   1. 라벨 → 묶음: 같은 라벨의 **열린** 암묵적 미션에만 합류한다. 끝난 묶음에
 *      뒤늦은 티켓이 섞이면 이미 본 Replay 가 조용히 바뀐다.
 *   2. 입양 규칙: **보드 티켓만** 라벨을 받는다. Quick Lane·명시적 미션 소속은
 *      절대 덮지 않는다(레인 격리/미션 소속 회귀 금지).
 *   3. 마감 규칙: 배치가 전부 종단이고 DONE 이 1건 이상일 때만 completed.
 *      그래야 Replay 대상(`status === "completed"`)이 된다.
 *   4. ★파이프라인 재사용: 암묵적 미션이 **기존 집계 코어(P1-1)에 무수정으로**
 *      잡힌다 — 새 그룹핑 경로를 만들지 않았다는 것의 실행 가능한 증거.
 *   5. 명시적 미션 회귀 없음.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * `lib/firebase` 는 모듈 로드 시점에 `initializeAuth` 를 부른다 — VITE_FIREBASE_*
 * 없이는 import 만으로 죽는다(`mission-replay-service.test.ts` 와 같은 이유).
 * 여기서는 순수 게이트(`selectReplayableMissions`)만 부르므로 Firestore 배선은
 * 한 번도 실행되지 않는다.
 */
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));
import {
  buildImplicitMissionDoc,
  canAdoptContextId,
  IMPLICIT_MISSION_KIND,
  IMPLICIT_MISSION_TEMPLATE_ID,
  implicitAdoptionError,
  implicitAdoptionPatch,
  isImplicitMissionDoc,
  isImplicitMissionComplete,
  MISSION_LABEL_MAX_LENGTH,
  missionLabelKey,
  normalizeMissionGoal,
  normalizeMissionLabel,
  selectJoinableImplicitMission,
  shouldCloseImplicitMission,
  type ImplicitMissionCandidate,
} from "../../electron/mcp-server/implicit-mission";
import {
  buildMissionReplay,
  isReplayableMission,
} from "../../src/lib/replay/missionReplay";
import { isImplicitMission } from "../../src/types/mission";
import type { Mission } from "../../src/types/mission";
import type { Task } from "../../src/types/task";

const { selectReplayableMissions } =
  await import("../../src/services/missionReplayService");

const T0 = new Date("2026-08-01T09:00:00Z");
const NOW = new Date("2026-08-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

// ── 1. 라벨 정규화 ──────────────────────────────────────────────

describe("normalizeMissionLabel", () => {
  it("앞뒤 공백·연속 공백을 정리한다 — 오케가 매번 똑같이 칠 거라고 가정하지 않는다", () => {
    expect(normalizeMissionLabel("  replay   배선 ")).toBe("replay 배선");
  });

  it("빈 라벨은 null — 라벨 없음과 같은 뜻이라 미션을 만들지 않는다", () => {
    expect(normalizeMissionLabel("")).toBeNull();
    expect(normalizeMissionLabel("   ")).toBeNull();
    expect(normalizeMissionLabel(undefined)).toBeNull();
    expect(normalizeMissionLabel(null)).toBeNull();
  });

  it("상한을 넘으면 잘라 쓴다(거부하지 않는다 — 라벨은 사람이 읽는 이름)", () => {
    const long = "가".repeat(MISSION_LABEL_MAX_LENGTH + 20);
    expect(normalizeMissionLabel(long)).toHaveLength(MISSION_LABEL_MAX_LENGTH);
  });

  it("대소문자는 보존하되 매칭 키는 무시한다", () => {
    expect(normalizeMissionLabel("Replay Wiring")).toBe("Replay Wiring");
    expect(missionLabelKey("Replay Wiring")).toBe(
      missionLabelKey("replay wiring"),
    );
  });
});

describe("normalizeMissionGoal", () => {
  it("goal 이 비면 라벨을 goal 로 쓴다 — Replay 헤드라인이 비지 않게", () => {
    expect(normalizeMissionGoal(undefined, "replay 배선")).toBe("replay 배선");
    expect(normalizeMissionGoal("  ", "replay 배선")).toBe("replay 배선");
  });

  it("주어진 goal 은 공백만 정리해 그대로 쓴다", () => {
    expect(normalizeMissionGoal("  ad-hoc  작업도 Replay 로 ", "l")).toBe(
      "ad-hoc 작업도 Replay 로",
    );
  });
});

// ── 2. 합류 판정 ────────────────────────────────────────────────

function candidate(
  overrides: Partial<ImplicitMissionCandidate> = {},
): ImplicitMissionCandidate {
  return {
    id: "m-open",
    status: "active",
    missionKind: IMPLICIT_MISSION_KIND,
    implicitLabel: "replay 배선",
    projectId: "proj-1",
    lastActivityMs: 1_000,
    ...overrides,
  };
}

describe("selectJoinableImplicitMission", () => {
  it("같은 라벨의 열린 묶음에 합류한다", () => {
    const picked = selectJoinableImplicitMission(
      [candidate()],
      "replay 배선",
      "proj-1",
    );
    expect(picked?.id).toBe("m-open");
  });

  it("★끝난 묶음에는 합류하지 않는다 — 발행된 Replay 에 뒤늦은 티켓이 섞이면 안 된다", () => {
    const closed = [
      candidate({ id: "m-done", status: "completed" }),
      candidate({ id: "m-gone", status: "abandoned" }),
    ];
    expect(
      selectJoinableImplicitMission(closed, "replay 배선", "proj-1"),
    ).toBeNull();
  });

  it("명시적 미션은 라벨이 같아도 합류 대상이 아니다", () => {
    const explicit = candidate({ id: "m-explicit", missionKind: undefined });
    expect(
      selectJoinableImplicitMission([explicit], "replay 배선", "proj-1"),
    ).toBeNull();
  });

  it("다른 프로젝트의 묶음에는 합류하지 않는다", () => {
    expect(
      selectJoinableImplicitMission([candidate()], "replay 배선", "proj-2"),
    ).toBeNull();
  });

  it("라벨이 다르면 새 묶음(null) — 경계는 오케가 선언한 라벨이다", () => {
    expect(
      selectJoinableImplicitMission([candidate()], "다른 일", "proj-1"),
    ).toBeNull();
  });

  it("후보가 여럿이면 가장 최근 활동 — 경합으로 둘이 생겨도 순서가 결정적이다", () => {
    const picked = selectJoinableImplicitMission(
      [
        candidate({ id: "old", lastActivityMs: 10 }),
        candidate({ id: "new", lastActivityMs: 999 }),
      ],
      "replay 배선",
      "proj-1",
    );
    expect(picked?.id).toBe("new");
  });
});

// ── 3. 미션 문서 ────────────────────────────────────────────────

describe("buildImplicitMissionDoc", () => {
  const doc = buildImplicitMissionDoc({
    projectId: "proj-1",
    label: "  replay  배선 ",
    goal: "ad-hoc 보드 작업도 Replay 로 잡히게",
    ownerOrchestratorSessionId: "orchestrator-proj-1",
    now: T0,
  });

  it("암묵적 마커와 라벨을 싣는다 — 엔진 제외 판정의 유일한 근거", () => {
    expect(doc.missionKind).toBe(IMPLICIT_MISSION_KIND);
    expect(doc.implicitLabel).toBe("replay 배선");
    expect(isImplicitMissionDoc(doc as { missionKind?: string })).toBe(true);
    expect(isImplicitMission(doc as { missionKind?: string })).toBe(true);
  });

  it("실행 계획이 없다 — 라벨이지 자동화 미션이 아니다", () => {
    expect(doc.steps).toEqual([]);
    expect(doc.contextLog).toEqual([]);
    expect(doc.templateId).toBe(IMPLICIT_MISSION_TEMPLATE_ID);
  });

  it("active 로 시작하고 completedAt 은 비어 있다", () => {
    expect(doc.status).toBe("active");
    expect(doc.completedAt).toBeNull();
    expect(doc.launchedAt).toBe(T0);
  });

  it("오케 세션 id 는 귀속 표기로만 실린다(그룹핑 키가 아니다)", () => {
    expect(doc.ownerOrchestratorSessionId).toBe("orchestrator-proj-1");
    // 세션 id 가 그룹핑 키였다면 라벨 없이도 묶였어야 한다 — 아니어야 정상.
    expect(doc.implicitLabel).not.toBe("orchestrator-proj-1");
  });
});

// ── 4. 입양 규칙 ────────────────────────────────────────────────

describe("입양 규칙 — 보드 티켓만 라벨을 받는다", () => {
  it("보드 티켓(contextId='board' 또는 미설정)은 입양된다", () => {
    expect(canAdoptContextId("board")).toBe(true);
    expect(canAdoptContextId(undefined)).toBe(true);
    expect(canAdoptContextId("")).toBe(true);
    expect(
      implicitAdoptionError("t1", { contextId: "board" }, "m1"),
    ).toBeNull();
  });

  it("★Quick Lane 티켓은 거부한다 — 레인 격리는 회귀시키면 안 되는 기존 동작", () => {
    expect(canAdoptContextId("lane:abc")).toBe(false);
    const err = implicitAdoptionError("t1", { contextId: "lane:abc" }, "m1");
    expect(err).toContain("lane:abc");
  });

  it("★명시적 미션 소속 티켓은 거부한다", () => {
    const err = implicitAdoptionError(
      "t1",
      { contextId: "mission-x", missionId: "mission-x" },
      "m1",
    );
    expect(err).toContain("mission-x");
  });

  it("이미 그 묶음이면 멱등 — 같은 라벨로 두 번 dispatch 해도 에러가 아니다", () => {
    const task = { contextId: "m1", missionId: "m1" };
    expect(implicitAdoptionError("t1", task, "m1")).toBeNull();
    expect(implicitAdoptionPatch(task, "m1")).toEqual({});
  });

  it("입양 패치는 contextId(1급 조인키)와 missionId 를 함께 세운다", () => {
    expect(implicitAdoptionPatch({ contextId: "board" }, "m1")).toEqual({
      contextId: "m1",
      missionId: "m1",
    });
  });
});

// ── 5. 마감 규칙 ────────────────────────────────────────────────

describe("isImplicitMissionComplete", () => {
  it("진행 중인 티켓이 하나라도 있으면 아직이다", () => {
    for (const status of [
      "TODO",
      "CLAIMED",
      "IN_PROGRESS",
      "REVIEW",
      "BLOCKED",
    ]) {
      expect(isImplicitMissionComplete([{ status: "DONE" }, { status }])).toBe(
        false,
      );
    }
  });

  it("전부 종단이고 DONE 이 1건 이상이면 끝났다", () => {
    expect(
      isImplicitMissionComplete([{ status: "DONE" }, { status: "FAILED" }]),
    ).toBe(true);
  });

  it("전부 FAILED 인 묶음은 완료가 아니다 — 설계 Q1(실패도 콘텐츠) 미결", () => {
    expect(isImplicitMissionComplete([{ status: "FAILED" }])).toBe(false);
  });

  it("티켓이 0건이면 완료가 아니다 — 빈 Replay 를 만들지 않는다", () => {
    expect(isImplicitMissionComplete([])).toBe(false);
  });
});

describe("shouldCloseImplicitMission", () => {
  const doneTasks = [{ status: "DONE" }];

  it("암묵적 미션만 닫는다 — 명시적 미션의 마감은 엔진 소관", () => {
    expect(shouldCloseImplicitMission({ status: "active" }, doneTasks)).toBe(
      false,
    );
    expect(
      shouldCloseImplicitMission(
        { status: "active", missionKind: IMPLICIT_MISSION_KIND },
        doneTasks,
      ),
    ).toBe(true);
  });

  it("이미 completed 면 멱등 — 재확인이 completedAt 을 뒤로 밀지 않는다", () => {
    expect(
      shouldCloseImplicitMission(
        { status: "completed", missionKind: IMPLICIT_MISSION_KIND },
        doneTasks,
      ),
    ).toBe(false);
  });
});

// ── 6. ★기존 Replay 파이프라인이 그대로 잡는가 ─────────────────

function implicitMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "implicit-1",
    projectId: "proj-1",
    goal: "ad-hoc 보드 작업도 Replay 로 잡히게",
    templateId: "adhoc",
    status: "completed",
    missionKind: "implicit",
    implicitLabel: "replay 배선",
    ownerOrchestratorSessionId: "orchestrator-proj-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a", "task-b"],
    contextLog: [],
    launchedAt: T0,
    lastActivityAt: at(90),
    completedAt: at(90),
    ...overrides,
  };
}

function explicitMission(overrides: Partial<Mission> = {}): Mission {
  return {
    ...implicitMission(),
    id: "explicit-1",
    templateId: "feature",
    missionKind: undefined,
    implicitLabel: undefined,
    goal: "명시적 미션",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-a",
    projectId: "proj-1",
    contextId: "implicit-1",
    title: "라벨 배선",
    description: "",
    status: "DONE",
    role: "backend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-x",
    claimedAt: at(5),
    scope: ["v3/electron/mcp-server/implicit-mission.ts"],
    comment: "",
    prUrl: "https://github.com/melocream/marblo/pull/901",
    hasPmFeedback: false,
    createdAt: at(1),
    updatedAt: at(80),
    ...overrides,
  };
}

describe("★암묵적 미션이 기존 집계 코어에 무수정으로 잡힌다", () => {
  it("완료된 암묵적 미션은 Replay 대상이다", () => {
    expect(isReplayableMission(implicitMission())).toBe(true);
  });

  it("아직 안 끝난 암묵적 미션은 Replay 가 아니다(마감 전에 미리 뜨지 않는다)", () => {
    expect(isReplayableMission(implicitMission({ status: "active" }))).toBe(
      false,
    );
    expect(
      buildMissionReplay(
        { mission: implicitMission({ status: "active" }), tasks: [makeTask()] },
        { now: NOW },
      ),
    ).toBeNull();
  });

  it("contextId 조인만으로 소속 티켓·통계·PR 이 채워진다 — 새 조인키 없음", () => {
    const replay = buildMissionReplay(
      {
        mission: implicitMission(),
        tasks: [
          makeTask(),
          makeTask({ id: "task-b", title: "마감 훅", updatedAt: at(85) }),
          // 남의 보드 티켓 — 라벨이 없으므로 묶이지 않는다.
          makeTask({ id: "task-z", contextId: "board", title: "무관한 일" }),
        ],
      },
      { now: NOW },
    );

    expect(replay).not.toBeNull();
    expect(replay!.missionId).toBe("implicit-1");
    expect(replay!.goal).toBe("ad-hoc 보드 작업도 Replay 로 잡히게");
    expect(replay!.templateId).toBe("adhoc");
    expect(replay!.stats.tasks).toBe(2);
    expect(replay!.stats.tasksDone).toBe(2);
    expect(replay!.prUrls).toEqual([
      "https://github.com/melocream/marblo/pull/901",
    ]);
    // 라벨이 없는 보드 티켓은 어떤 수치에도 섞이지 않는다.
    expect(replay!.beats.some((b) => b.taskId === "task-z")).toBe(false);
  });

  it("steps·contextLog 가 비어도 타임라인이 만들어진다(서사는 티켓에서 나온다)", () => {
    const replay = buildMissionReplay(
      { mission: implicitMission(), tasks: [makeTask()] },
      { now: NOW },
    );
    expect(replay!.beats.length).toBeGreaterThan(0);
    expect(replay!.beats.every((b) => b.source !== "mission.contextLog")).toBe(
      true,
    );
  });

  it("리스트 게이트가 암묵적·명시적 미션을 모두 잡는다(회귀 없음)", () => {
    const listed = selectReplayableMissions([
      implicitMission(),
      explicitMission(),
      implicitMission({ id: "still-running", status: "active" }),
    ]);
    expect(listed.map((m) => m.id)).toEqual(
      expect.arrayContaining(["implicit-1", "explicit-1"]),
    );
    expect(listed.map((m) => m.id)).not.toContain("still-running");
  });
});

describe("명시적 미션 회귀 없음", () => {
  it("명시적 미션은 여전히 templateId 를 그대로 싣고 암묵으로 분류되지 않는다", () => {
    const mission = explicitMission();
    expect(isImplicitMission(mission)).toBe(false);
    const replay = buildMissionReplay(
      { mission, tasks: [makeTask({ contextId: "explicit-1" })] },
      { now: NOW },
    );
    expect(replay!.templateId).toBe("feature");
    expect(replay!.stats.tasks).toBe(1);
  });

  it("암묵적 마커가 없는 미션은 마감 훅이 손대지 않는다", () => {
    expect(
      shouldCloseImplicitMission({ status: "active" }, [{ status: "DONE" }]),
    ).toBe(false);
  });
});
