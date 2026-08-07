/**
 * 미션 GIF (MVP) — 미션 선택 → 미션 서사 GIF.
 *
 * 핀하는 계약:
 *   - `buildMissionOutline` 은 `depends_on` **위상순서**로 A·B·C 를 매기고, PR 은
 *     번호만 뽑고, 머지 순서에는 완료된 태스크의 PR 만 넣는다. 같은 입력이면
 *     같은 순서다(GIF 는 결정적이어야 한다).
 *   - `redactReplay` 가 개요를 통과시키되 **PR URL 은 여전히 안 나간다**. 이게
 *     "제목·번호만 담아 무거운 비식별이 필요 없다"는 이 MVP 의 전제다.
 *   - `"mission"` 템플릿의 장면 순서 = 미션명 → 태스크분해 → 워크트리·오케머지 →
 *     PR 의존성 머지 → 결론. 프레임에 실제로 그 사실들이 그려진다.
 *   - 결론 문구는 **파생**이라 진행 중 미션을 완료로 말하지 않는다.
 *   - 선택 목록(`buildMissionGifOptions`)은 완료 여부가 아니라 **태스크가 붙었나**
 *     로 거른다 — 완료 미션이 0건이어도 고를 게 있어야 한다(이 티켓의 근인).
 *   - 기본 플로우 뷰에는 형식 탭·등급(L1/L2/L3) 선택·비식별 미리보기가 없다.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";

// `lib/firebase` 는 import 만으로 initializeAuth 를 부른다(다른 뷰 테스트와 동일).
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildMissionOutline,
  outlineRef,
  parsePrNumber,
  topoSortTasks,
} from "../../src/lib/replay/missionOutline";
import { buildMissionGifOptions } from "../../src/lib/replay/missionPicker";
import { buildMissionReplay } from "../../src/lib/replay/missionReplay";
import { redactReplay } from "../../src/lib/replay/redactReplay";
import {
  buildReplayStoryboard,
  buildReplayStoryConclusion,
  buildReplayStoryOutline,
  drawReplayStoryboardFrame,
  isReplayStoryTemplate,
  planReplayStoryboardFrames,
  type ReplayStoryFrame,
} from "../../src/lib/replay/export/gifStoryboard";
import { buildReplayMotionRenderPlan } from "../../src/lib/replay/export/gif";
import { MissionGifPanelView } from "../../src/components/work-history/replay/MissionGifPanel";
import type { MissionReplaySources } from "../../src/lib/replay/beats";
import type { TFunction } from "../../src/lib/i18n";
import type { Mission } from "../../src/types/mission";
import type { Task } from "../../src/types/task";
import { ko } from "../../src/locales/ko";

const T0 = new Date("2026-08-01T09:00:00Z");
const NOW = new Date("2026-08-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const t: TFunction = (key, vars) => {
  const raw = ko[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
};

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: "proj-1",
    contextId: "mission-1",
    title: `태스크 ${overrides.id}`,
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-1",
    claimedAt: at(5),
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: at(1),
    updatedAt: at(60),
    ...overrides,
  };
}

/** A → B → C, PR #830/#831/#832 — 티켓 본문의 예시를 그대로 태스크로. */
function missionTasks(): Task[] {
  return [
    makeTask({
      id: "task-c",
      title: "완료 페이지 배선",
      dependsOn: ["task-b"],
      prUrl: "https://github.com/acme/app/pull/832",
      createdAt: at(3),
    }),
    makeTask({
      id: "task-a",
      title: "결제 코드맵 정본화",
      prUrl: "https://github.com/acme/app/pull/830",
      createdAt: at(1),
    }),
    makeTask({
      id: "task-b",
      title: "서버 검증 라우트",
      dependsOn: ["task-a"],
      prUrl: "https://github.com/acme/app/pull/831",
      createdAt: at(2),
    }),
  ];
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "proj-1",
    goal: "결제 에러 UX 정본화",
    templateId: "adhoc",
    status: "completed",
    missionKind: "implicit",
    implicitLabel: "결제 UX",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a", "task-b", "task-c"],
    contextLog: [],
    launchedAt: T0,
    lastActivityAt: at(90),
    completedAt: at(90),
    ...overrides,
  };
}

function makeSources(
  overrides: Partial<MissionReplaySources> = {},
): MissionReplaySources {
  return {
    mission: makeMission(),
    tasks: missionTasks(),
    activitiesByTaskId: {},
    mergeHistory: [],
    auditLogs: [],
    projectAuditEvents: [],
    agents: [],
    ...overrides,
  };
}

function makeRecordingCtx() {
  const texts: string[] = [];
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "left" as "left" | "right" | "center",
    textBaseline: "alphabetic" as const,
    fillRect: vi.fn(),
    fillText: vi.fn((text: string) => {
      texts.push(text);
    }),
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  return { ctx, texts };
}

function drawnTexts(
  storyboard: ReturnType<typeof buildReplayStoryboard>,
  frame: ReplayStoryFrame,
): string[] {
  const { ctx, texts } = makeRecordingCtx();
  drawReplayStoryboardFrame(ctx, storyboard, frame);
  return texts;
}

function allDrawnTexts(
  storyboard: ReturnType<typeof buildReplayStoryboard>,
): string[] {
  const texts: string[] = [];
  for (const frame of planReplayStoryboardFrames(storyboard)) {
    texts.push(...drawnTexts(storyboard, frame));
  }
  return texts;
}

// ---------------------------------------------------------------------------

describe("buildMissionOutline — 작업 분해 + 의존성 머지 순서", () => {
  it("depends_on 위상순서로 A·B·C 를 매긴다(생성순이 아니라)", () => {
    const outline = buildMissionOutline(missionTasks());
    expect(outline.tasks.map((task) => [task.ref, task.title])).toEqual([
      ["A", "결제 코드맵 정본화"],
      ["B", "서버 검증 라우트"],
      ["C", "완료 페이지 배선"],
    ]);
    expect(outline.tasks[2].dependsOn).toEqual(["B"]);
    expect(outline.hasDependencies).toBe(true);
  });

  it("PR 은 번호만 뽑고, 머지 순서는 의존성 순서를 따른다", () => {
    const outline = buildMissionOutline(missionTasks());
    expect(outline.tasks.map((task) => task.prNumber)).toEqual([830, 831, 832]);
    expect(outline.mergeOrder).toEqual([830, 831, 832]);
  });

  it("미완료 태스크의 PR 은 '머지됨' 순서에 들어가지 않는다", () => {
    const tasks = missionTasks().map((task) =>
      task.id === "task-c" ? { ...task, status: "IN_PROGRESS" as const } : task,
    );
    const outline = buildMissionOutline(tasks);
    expect(outline.mergeOrder).toEqual([830, 831]);
    expect(outline.tasks[2].done).toBe(false);
    // 제목·PR번호는 그대로 남는다 — 빠지는 것은 '머지됐다'는 주장뿐이다.
    expect(outline.tasks[2].prNumber).toBe(832);
  });

  it("미션 밖으로 나가는 의존 간선은 순서 근거로 쓰지 않는다", () => {
    const tasks = [
      makeTask({ id: "task-a", dependsOn: ["task-elsewhere"] }),
      makeTask({ id: "task-b", dependsOn: ["task-a"], createdAt: at(2) }),
    ];
    const outline = buildMissionOutline(tasks);
    expect(outline.tasks.map((task) => task.ref)).toEqual(["A", "B"]);
    expect(outline.tasks[0].dependsOn).toEqual([]);
  });

  it("순환 의존이어도 전부 내보낸다(순서만 근사값)", () => {
    const tasks = [
      makeTask({ id: "task-a", dependsOn: ["task-b"] }),
      makeTask({ id: "task-b", dependsOn: ["task-a"], createdAt: at(2) }),
    ];
    const outline = buildMissionOutline(tasks);
    expect(outline.tasks).toHaveLength(2);
    expect(outline.tasks.map((task) => task.title).sort()).toEqual(
      ["태스크 task-a", "태스크 task-b"].sort(),
    );
  });

  it("soft-delete 된 티켓은 서사에 되살리지 않는다", () => {
    const tasks = [
      makeTask({ id: "task-a" }),
      makeTask({ id: "task-x", deleted: true, createdAt: at(2) }),
    ];
    expect(buildMissionOutline(tasks).tasks).toHaveLength(1);
  });

  it("상한을 넘으면 자르되 잘린 건수를 남긴다(조용한 절단 금지)", () => {
    const tasks = Array.from({ length: 5 }, (_, index) =>
      makeTask({ id: `task-${index}`, createdAt: at(index) }),
    );
    const outline = buildMissionOutline(tasks, { maxTasks: 3 });
    expect(outline.tasks).toHaveLength(3);
    expect(outline.truncated).toBe(2);
  });

  it("같은 입력이면 같은 순서다(GIF 결정성)", () => {
    const first = buildMissionOutline(missionTasks());
    const second = buildMissionOutline([...missionTasks()].reverse());
    expect(second.tasks.map((task) => task.ref)).toEqual(
      first.tasks.map((task) => task.ref),
    );
    expect(second.mergeOrder).toEqual(first.mergeOrder);
  });

  it("PR 번호 파서는 GitHub/GitLab 형태만 인정하고 나머지는 추측하지 않는다", () => {
    expect(parsePrNumber("https://github.com/acme/app/pull/843")).toBe(843);
    expect(parsePrNumber("https://gitlab.com/a/b/-/merge_requests/12")).toBe(
      12,
    );
    expect(parsePrNumber("#77")).toBe(77);
    expect(parsePrNumber("https://example.com/acme/app/issues/9")).toBeNull();
    expect(parsePrNumber("")).toBeNull();
    expect(parsePrNumber(undefined)).toBeNull();
  });

  it("ref 는 26건을 넘으면 번호로 떨어진다", () => {
    expect(outlineRef(0)).toBe("A");
    expect(outlineRef(25)).toBe("Z");
    expect(outlineRef(26)).toBe("T27");
  });

  it("위상정렬은 준비된 것들을 생성시각 → id 로 못 박는다", () => {
    const tasks = [
      makeTask({ id: "b", createdAt: at(1) }),
      makeTask({ id: "a", createdAt: at(1) }),
      makeTask({ id: "c", createdAt: at(0) }),
    ];
    expect(topoSortTasks(tasks).map((task) => task.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("buildMissionReplay — 개요가 Replay 에 실린다", () => {
  it("완료 미션의 개요에 제목·PR번호·의존순서가 들어간다", () => {
    const replay = buildMissionReplay(makeSources(), { now: NOW });
    expect(replay?.outline.tasks.map((task) => task.ref)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(replay?.outline.mergeOrder).toEqual([830, 831, 832]);
  });

  it("진행 중 미션은 기본적으로 조립되지 않지만, 익스포트 프리뷰에서는 허용된다", () => {
    const running = makeSources({
      mission: makeMission({ status: "active", completedAt: null }),
    });
    expect(buildMissionReplay(running, { now: NOW })).toBeNull();

    const preview = buildMissionReplay(running, {
      now: NOW,
      includeIncomplete: true,
    });
    expect(preview).not.toBeNull();
    // ★진행 중이라는 사실 자체는 지워지지 않는다.
    expect(preview?.completedAt).toBeNull();
  });
});

describe("redactReplay — 개요는 통과, PR URL 은 여전히 차단", () => {
  const replay = buildMissionReplay(makeSources(), { now: NOW });

  it("L2 에서 제목·PR번호·의존 ref 가 살아남는다", () => {
    const redacted = redactReplay(replay!, { level: "L2" });
    expect(redacted.verified).toBe(true);
    const outline = buildReplayStoryOutline(redacted);
    expect(outline.tasks.map((task) => task.title)).toEqual([
      "결제 코드맵 정본화",
      "서버 검증 라우트",
      "완료 페이지 배선",
    ]);
    expect(outline.mergeOrder).toEqual([830, 831, 832]);
  });

  it("직렬화된 바이트에 PR URL·저장소 좌표가 없다", () => {
    const redacted = redactReplay(replay!, { level: "L2" });
    expect(redacted.serialized).not.toContain("github.com");
    expect(redacted.serialized).not.toContain("/pull/");
    // 번호는 남는다 — 그게 이 MVP 가 공유하기로 한 유일한 PR 사실이다.
    expect(redacted.serialized).toContain("830");
  });

  it("L1(과정만)에서도 개요는 나간다(담긴 게 이미 공개 가능한 사실이라)", () => {
    const redacted = redactReplay(replay!, { level: "L1" });
    expect(buildReplayStoryOutline(redacted).mergeOrder).toEqual([
      830, 831, 832,
    ]);
  });

  it("개요에 새 필드가 생겨도 자동으로 나가지는 않는다(default-deny)", () => {
    const tampered = {
      ...replay!,
      outline: {
        ...replay!.outline,
        tasks: replay!.outline.tasks.map((task) => ({
          ...task,
          // 화이트리스트에 없는 키 — 통과하면 안 된다.
          secretNote: "/Users/someone/private/notes.md",
        })),
      },
    };
    const redacted = redactReplay(tampered, { level: "L2" });
    expect(redacted.serialized).not.toContain("secretNote");
    expect(redacted.serialized).not.toContain("private/notes.md");
  });
});

describe("mission 템플릿 — 티켓이 요구한 서사", () => {
  const replay = buildMissionReplay(makeSources(), { now: NOW });
  const redacted = redactReplay(replay!, { level: "L2" });
  const storyboard = buildReplayStoryboard(redacted, "mission");

  it("장면 순서 = 미션명 → 분해 → 워크트리·머지 → PR → 결론", () => {
    expect(storyboard.scenes.map((scene) => scene.kind)).toEqual([
      "headline",
      "breakdown",
      "worktree",
      "merge",
      "conclusion",
    ]);
  });

  it("스토리보드 템플릿으로 라우팅된다", () => {
    expect(isReplayStoryTemplate("mission")).toBe(true);
    const plan = buildReplayMotionRenderPlan(redacted, { template: "mission" });
    expect(plan.template).toBe("mission");
    expect(plan.frames.length).toBeGreaterThan(0);
  });

  it("프레임에 미션명·태스크 제목·PR 번호·결론이 그려진다", () => {
    const texts = allDrawnTexts(storyboard);
    expect(texts).toContain("결제 에러 UX 정본화");
    expect(texts).toContain("결제 코드맵 정본화");
    expect(texts).toContain("서버 검증 라우트");
    expect(texts).toContain("완료 페이지 배선");
    expect(texts).toContain("#830");
    expect(texts).toContain("#832");
    expect(texts).toContain("의존성 순서대로 실행·머지 완료");
    // 워크트리 → 오케 머지 장면
    expect(texts).toContain("오케 머지");
  });

  it("자유텍스트·코드·경로는 어떤 프레임에도 안 들어간다", () => {
    const leaky = buildMissionReplay(
      makeSources({
        tasks: missionTasks().map((task) => ({
          ...task,
          description: "SECRET_DESCRIPTION",
          comment: "SECRET_COMMENT",
          scope: ["/Users/someone/secret/path.ts"],
        })),
      }),
      { now: NOW },
    );
    const board = buildReplayStoryboard(
      redactReplay(leaky!, { level: "L2" }),
      "mission",
    );
    const blob = allDrawnTexts(board).join("\n");
    expect(blob).not.toContain("SECRET_DESCRIPTION");
    expect(blob).not.toContain("SECRET_COMMENT");
    expect(blob).not.toContain("/Users/");
  });

  it("태스크가 상한까지 찬 미션도 구분선·푸터를 뚫지 않는다", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      makeTask({
        id: `task-${index}`,
        title: `아주 긴 태스크 제목 ${index} — 줄바꿈을 유도하는 문장`,
        dependsOn: index > 0 ? [`task-${index - 1}`] : [],
        prUrl: `https://github.com/acme/app/pull/${900 + index}`,
        createdAt: at(index),
      }),
    );
    const board = buildReplayStoryboard(
      redactReplay(
        buildMissionReplay(makeSources({ tasks: many }), { now: NOW })!,
        { level: "L2" },
      ),
      "mission",
    );

    // 본문(구분선 508 위)에 그려야 할 것과 푸터(552)를 가른다. 푸터 자체는
    // 항상 2줄이 나가므로, 그보다 아래로 새는 텍스트가 없으면 된다.
    for (const frame of planReplayStoryboardFrames(board)) {
      const ys: number[] = [];
      const ctx = {
        fillStyle: "",
        font: "",
        textAlign: "left" as "left" | "right" | "center",
        textBaseline: "alphabetic" as const,
        fillRect: vi.fn(),
        fillText: vi.fn((_text: string, _x: number, y: number) => {
          ys.push(y);
        }),
        measureText: (text: string) => ({ width: text.length * 12 }),
      };
      drawReplayStoryboardFrame(ctx, board, frame);
      expect(Math.max(...ys)).toBeLessThanOrEqual(552);
      // 구분선(508)과 푸터(552) 사이에 낀 텍스트가 없어야 한다.
      expect(ys.filter((y) => y > 508 && y < 552)).toEqual([]);
    }
  });

  it("기존 템플릿(story/cast/stats)의 컷은 건드리지 않는다", () => {
    const story = buildReplayStoryboard(redacted, "story");
    expect(story.scenes.map((scene) => scene.kind)).toEqual([
      "headline",
      "cast",
      "progress",
      "ship",
      "stamp",
    ]);
  });
});

describe("결론 문구 — 파생이라 거짓말할 수 없다", () => {
  const outlineWithDeps = {
    tasks: [],
    mergeOrder: [830, 831],
    hasDependencies: true,
    truncated: 0,
  };
  const ship = (tasksDone: number | null, tasks: number | null) => ({
    prs: 2,
    filesChanged: null,
    linesAdded: null,
    linesDeleted: null,
    tasksDone,
    tasks,
    metrics: [],
    progressLabel: null,
  });

  it("전부 끝났으면 '의존성 순서대로 실행·머지 완료'", () => {
    expect(buildReplayStoryConclusion(outlineWithDeps, ship(3, 3))).toEqual([
      "태스크 3/3 · PR 2건 머지",
      "의존성 순서대로 실행·머지 완료",
    ]);
  });

  it("진행 중이면 완료라고 하지 않는다", () => {
    expect(buildReplayStoryConclusion(outlineWithDeps, ship(1, 3))[1]).toBe(
      "의존성 순서대로 진행 중",
    );
  });

  it("의존 간선이 없으면 '병렬로' 라고 말한다(없는 순서를 지어내지 않는다)", () => {
    expect(
      buildReplayStoryConclusion(
        { ...outlineWithDeps, hasDependencies: false },
        ship(3, 3),
      )[1],
    ).toBe("병렬로 실행·머지 완료");
  });
});

describe("미션 선택 목록 — 완료가 아니라 '태스크가 붙었나'로 거른다", () => {
  const missions = [
    makeMission(),
    makeMission({
      id: "mission-2",
      implicitLabel: "리플레이 MVP",
      status: "active",
      completedAt: null,
      lastActivityAt: at(200),
    }),
    makeMission({ id: "mission-empty", implicitLabel: "빈 미션" }),
  ];
  const tasks = [
    ...missionTasks(),
    makeTask({
      id: "task-live",
      contextId: "mission-2",
      status: "IN_PROGRESS",
    }),
    makeTask({ id: "task-board", contextId: "board" }),
    makeTask({ id: "task-lane", contextId: "lane:quick" }),
  ];

  it("진행 중 미션도 고를 수 있고, 최근 것이 위로 온다", () => {
    const options = buildMissionGifOptions(missions, tasks);
    expect(options.map((option) => option.missionId)).toEqual([
      "mission-2",
      "mission-1",
    ]);
    expect(options[0].completed).toBe(false);
    expect(options[0].label).toBe("리플레이 MVP");
  });

  it("태스크가 0건인 미션은 목록에 넣지 않는다(빈 GIF 방지)", () => {
    const options = buildMissionGifOptions(missions, tasks);
    expect(options.some((option) => option.missionId === "mission-empty")).toBe(
      false,
    );
  });

  it("보드·Quick Lane 티켓은 어느 미션에도 섞이지 않는다", () => {
    const options = buildMissionGifOptions(missions, tasks);
    const mission1 = options.find((o) => o.missionId === "mission-1");
    expect(mission1?.taskCount).toBe(3);
    expect(mission1?.prCount).toBe(3);
  });

  it("표시 이름은 mission_label(implicitLabel) 을 먼저 쓴다", () => {
    const options = buildMissionGifOptions(
      [makeMission({ implicitLabel: undefined, goal: "라벨 없는 미션" })],
      missionTasks(),
    );
    expect(options[0].label).toBe("라벨 없는 미션");
  });
});

describe("MissionGifPanelView — 미션 선택 + GIF 버튼 하나", () => {
  const options = buildMissionGifOptions([makeMission()], missionTasks());
  const outline = buildMissionOutline(missionTasks());

  function render(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(MissionGifPanelView, {
        options,
        selectedId: "mission-1",
        onSelect: () => undefined,
        outline,
        goal: "결제 에러 UX 정본화",
        generating: false,
        canGenerate: true,
        error: null,
        asset: null,
        onGenerate: () => undefined,
        onDownload: () => undefined,
        t,
        ...overrides,
      } as never),
    );
  }

  it("미션을 고르는 라디오 목록과 GIF 생성 버튼을 그린다", () => {
    const markup = render();
    expect(markup).toContain('data-testid="mission-gif-options"');
    expect(markup).toContain('data-testid="mission-gif-option-mission-1"');
    expect(markup).toContain('data-testid="mission-gif-generate"');
    expect(markup).toContain(ko["workHistory.replay.gif.generate"]);
  });

  it("선택된 미션의 태스크 분해·의존·PR 번호를 미리 보여준다", () => {
    const markup = render();
    expect(markup).toContain("결제 코드맵 정본화");
    expect(markup).toContain("#830");
    expect(markup).toContain('data-testid="mission-gif-merge-order"');
  });

  it("형식 탭·등급(L1/L2/L3) 선택·비식별 미리보기가 없다", () => {
    const markup = render();
    for (const gone of ["L1", "L2", "L3", "공유 형식", "검증 통과"]) {
      expect(markup).not.toContain(gone);
    }
  });

  it("고를 미션이 없으면 빈 상태와 만들기 CTA 를 준다", () => {
    const markup = render({
      options: [],
      outline: null,
      canGenerate: false,
      onCreateMission: () => undefined,
    });
    expect(markup).toContain('data-testid="mission-gif-empty"');
    expect(markup).toContain(ko["workHistory.replay.list.empty.cta"]);
  });

  it("생성 실패는 이유를 화면에 남긴다", () => {
    const markup = render({ error: "비식별 검증 실패" });
    expect(markup).toContain('data-testid="mission-gif-error"');
    expect(markup).toContain("비식별 검증 실패");
  });
});
