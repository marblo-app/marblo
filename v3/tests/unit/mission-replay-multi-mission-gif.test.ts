/**
 * 미션별 GIF **분별력** — 여러 미션을 골라 각각 GIF 를 만들면 정말 다른 것이
 * 나오는가.
 *
 * `mission-replay-mission-gif.test.ts` 는 미션 **하나**의 계약(위상순서·PR 번호
 * 파싱·비식별·장면 순서)을 핀한다. 이 파일이 답하는 질문은 다르다:
 *
 *   "미션 A 를 골랐는데 미션 B 의 태스크·PR 이 그려지지는 않는가, 그리고 모든
 *    미션이 결국 같은 집계 한 장으로 떨어지지는 않는가."
 *
 * 이 축이 별도로 필요한 이유는 실패 모드가 조용하기 때문이다. 선택이 어디선가
 * 무시되면(미션 필터 누락, 프로젝트 전수 집계로의 폴백, 미션ID 키 캐시 재사용)
 * GIF 는 **여전히 정상적으로 생성된다** — 그냥 세 미션이 똑같이 나올 뿐이다.
 * 단일 미션 테스트는 정의상 그걸 못 잡는다. 그래서 여기서는 서로 다른 태스크
 * 구성·PR 번호·의존 모양을 가진 미션 3건을 놓고 **쌍쌍이 다름**을 본다.
 *
 * 픽스처 3건이 각각 다른 축을 흔든다:
 *   - `mission-payment`  — 완료, 사슬 A→B→C, PR 830·831·832 (전부 머지)
 *   - `mission-replay`   — ★진행 중, 의존 간선 없음, 2건 중 1건만 완료(PR 901)
 *   - `mission-onboarding` — 완료, 다이아몬드 A→(B,C)→D, 생성순과 머지순이 어긋남
 *     (PR 641·642·643·640 — 번호순도 생성순도 아닌 **의존순서**여야 한다)
 *
 * ★인코딩까지 진짜로 돌린다. `renderReplayMotionGif` 의 `createCanvas` 주입구에
 * 최소 소프트웨어 래스터라이저를 넣어 `gifenc` 를 실제로 통과시킨다 — 그래서
 * "그린 내용이 다르면 인코딩 바이트도 다르다"가 텍스트 레벨 추론이 아니라 바이트
 * 로 증명된다. 폰트 렌더링은 흉내내지 않는다(§래스터라이저 주석 참조).
 *
 * ★시계·캐시 금지: 집계 시각은 전부 주입한 상수(`NOW`)다. `Date.now()` 를 쓰는
 * 경로가 섞이면 "같은 입력 → 같은 바이트" 케이스가 먼저 깨진다.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildMissionGifOptions } from "../../src/lib/replay/missionPicker";
import { buildMissionReplay } from "../../src/lib/replay/missionReplay";
import { redactReplay } from "../../src/lib/replay/redactReplay";
import {
  buildReplayStoryboard,
  drawReplayStoryboardFrame,
  planReplayStoryboardFrames,
  type ReplayStoryboard,
  type ReplayStoryFrame,
} from "../../src/lib/replay/export/gifStoryboard";
import {
  REPLAY_MOTION_HEIGHT,
  REPLAY_MOTION_WIDTH,
  renderReplayMotionGif,
  type ReplayMotionCanvasContext,
  type ReplayMotionCanvasLike,
} from "../../src/lib/replay/export/gif";
import type { MissionReplaySources } from "../../src/lib/replay/beats";
import type { Mission } from "../../src/types/mission";
import type { RedactedReplay } from "../../src/types/missionReplay";
import type { Task } from "../../src/types/task";

const T0 = new Date("2026-08-01T09:00:00Z");
const NOW = new Date("2026-08-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

// ---------------------------------------------------------------------------
// 픽스처 — 미션 3건. 태스크 구성·PR 번호·의존 모양이 서로 겹치지 않는다.
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: "proj-1",
    contextId: "mission-payment",
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

function makeMission(overrides: Partial<Mission> & { id: string }): Mission {
  return {
    projectId: "proj-1",
    goal: "미션",
    templateId: "adhoc",
    status: "completed",
    missionKind: "implicit",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: [],
    contextLog: [],
    launchedAt: T0,
    lastActivityAt: at(90),
    completedAt: at(90),
    ...overrides,
  };
}

interface MissionFixture {
  key: string;
  mission: Mission;
  tasks: Task[];
  /** 이 미션에만 있는 제목 — 교차오염 검사의 지문. */
  titles: string[];
  /** 이 미션에만 있는 PR 칩("#830") — 같은 목적. */
  prChips: string[];
}

/** 완료 미션 · 사슬 A→B→C · PR 830·831·832 전부 머지. */
function paymentFixture(): MissionFixture {
  const id = "mission-payment";
  const tasks = [
    makeTask({
      id: "pay-c",
      contextId: id,
      title: "완료 페이지 배선",
      dependsOn: ["pay-b"],
      prUrl: "https://github.com/acme/app/pull/832",
      createdAt: at(3),
    }),
    makeTask({
      id: "pay-a",
      contextId: id,
      title: "결제 코드맵 정본화",
      prUrl: "https://github.com/acme/app/pull/830",
      createdAt: at(1),
    }),
    makeTask({
      id: "pay-b",
      contextId: id,
      title: "서버 검증 라우트",
      dependsOn: ["pay-a"],
      prUrl: "https://github.com/acme/app/pull/831",
      createdAt: at(2),
    }),
  ];
  return {
    key: "payment",
    mission: makeMission({
      id,
      goal: "결제 에러 UX 정본화",
      implicitLabel: "결제 P0 하드닝",
      completedAt: at(90),
      lastActivityAt: at(90),
    }),
    tasks,
    titles: ["결제 코드맵 정본화", "서버 검증 라우트", "완료 페이지 배선"],
    prChips: ["#830", "#831", "#832"],
  };
}

/** ★진행 중 미션 · 의존 간선 없음 · 2건 중 1건만 완료. */
function replayFixture(): MissionFixture {
  const id = "mission-replay";
  const tasks = [
    makeTask({
      id: "rep-a",
      contextId: id,
      title: "리플레이 집계 코어",
      prUrl: "https://github.com/acme/app/pull/901",
      createdAt: at(10),
    }),
    makeTask({
      id: "rep-b",
      contextId: id,
      title: "공유 카드 렌더러",
      status: "IN_PROGRESS",
      prUrl: "https://github.com/acme/app/pull/902",
      createdAt: at(11),
    }),
  ];
  return {
    key: "replay",
    mission: makeMission({
      id,
      goal: "미션 리플레이 MVP",
      implicitLabel: "리플레이 MVP",
      status: "active",
      completedAt: null,
      lastActivityAt: at(200),
    }),
    tasks,
    titles: ["리플레이 집계 코어", "공유 카드 렌더러"],
    prChips: ["#901", "#902"],
  };
}

/**
 * 완료 미션 · 다이아몬드 A→(B,C)→D.
 *
 * ★D 가 **가장 먼저 생성됐지만 마지막에 머지**된다(PR 640). 그래서 이 미션의
 * `mergeOrder` 는 641·642·643·640 — 번호순도 생성순도 아닌 의존순서다. 셋 중
 * 하나라도 순서를 생성시각으로 되돌리면 이 픽스처에서 먼저 깨진다.
 */
function onboardingFixture(): MissionFixture {
  const id = "mission-onboarding";
  const tasks = [
    makeTask({
      id: "onb-d",
      contextId: id,
      title: "런타임 승격 게이트",
      dependsOn: ["onb-b", "onb-c"],
      prUrl: "https://github.com/acme/app/pull/640",
      createdAt: at(1),
    }),
    makeTask({
      id: "onb-a",
      contextId: id,
      title: "온보딩 진입점 정본화",
      prUrl: "https://github.com/acme/app/pull/641",
      createdAt: at(2),
    }),
    makeTask({
      id: "onb-b",
      contextId: id,
      title: "인증 1개로 축약",
      dependsOn: ["onb-a"],
      prUrl: "https://github.com/acme/app/pull/642",
      createdAt: at(3),
    }),
    makeTask({
      id: "onb-c",
      contextId: id,
      title: "풀스크린 오케챗",
      dependsOn: ["onb-a"],
      prUrl: "https://github.com/acme/app/pull/643",
      createdAt: at(4),
    }),
  ];
  return {
    key: "onboarding",
    mission: makeMission({
      id,
      goal: "비기너 온보딩 단일 플로우",
      implicitLabel: "비기너 모드",
      completedAt: at(150),
      lastActivityAt: at(150),
    }),
    tasks,
    titles: [
      "온보딩 진입점 정본화",
      "인증 1개로 축약",
      "풀스크린 오케챗",
      "런타임 승격 게이트",
    ],
    prChips: ["#640", "#641", "#642", "#643"],
  };
}

function fixtures(): MissionFixture[] {
  return [paymentFixture(), replayFixture(), onboardingFixture()];
}

/** 프로젝트 전체 태스크 — 세 미션이 한 보드에 섞여 있는 실제 상황. */
function allTasks(list: readonly MissionFixture[]): Task[] {
  return [
    ...list.flatMap((fixture) => fixture.tasks),
    // 미션에 안 붙은 티켓들 — 어떤 미션에도 섞이면 안 된다.
    makeTask({ id: "board-1", contextId: "board", title: "보드 잡무" }),
    makeTask({ id: "lane-1", contextId: "lane:quick", title: "퀵레인 잡무" }),
  ];
}

/**
 * 미션 하나를 골라 GIF 파이프라인에 넣는 소스.
 *
 * ★`tasks` 에는 **프로젝트 전체**를 넘긴다. 미리 걸러서 넘기면 "선택이 실제로
 * 적용되는가"를 테스트가 대신 해 주는 꼴이 되어 분별력 검증이 무의미해진다.
 */
function sourcesFor(
  fixture: MissionFixture,
  list: readonly MissionFixture[],
): MissionReplaySources {
  return {
    mission: fixture.mission,
    tasks: allTasks(list),
    activitiesByTaskId: {},
    mergeHistory: [],
    auditLogs: [],
    projectAuditEvents: [],
    agents: [],
  };
}

function redactedFor(
  fixture: MissionFixture,
  list: readonly MissionFixture[],
): RedactedReplay {
  const replay = buildMissionReplay(sourcesFor(fixture, list), {
    now: NOW,
    // 진행 중 미션도 로컬 GIF 대상이다(발행 경로는 여전히 완료만).
    includeIncomplete: true,
  });
  expect(replay).not.toBeNull();
  return redactReplay(replay!, { level: "L2" });
}

function storyboardFor(
  fixture: MissionFixture,
  list: readonly MissionFixture[],
): ReplayStoryboard {
  return buildReplayStoryboard(redactedFor(fixture, list), "mission");
}

// ---------------------------------------------------------------------------
// 그리기 채집 — 프레임에 실제로 찍힌 문자열.
// ---------------------------------------------------------------------------

function makeRecordingCtx() {
  const texts: string[] = [];
  const ctx: ReplayMotionCanvasContext = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: () => undefined,
    fillText: (text: string) => {
      texts.push(text);
    },
    measureText: (text: string) => ({ width: text.length * 8 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return { ctx, texts };
}

function allDrawnTexts(storyboard: ReplayStoryboard): string[] {
  const texts: string[] = [];
  for (const frame of planReplayStoryboardFrames(storyboard)) {
    const { ctx, texts: frameTexts } = makeRecordingCtx();
    drawReplayStoryboardFrame(ctx, storyboard, frame);
    texts.push(...frameTexts);
  }
  return texts;
}

/** 프레임플랜의 **내용 의존** 축만 — 장면 길이는 템플릿 상수라 미션과 무관하다. */
function framePlanSignature(storyboard: ReplayStoryboard): string {
  return planReplayStoryboardFrames(storyboard)
    .map(
      (frame: ReplayStoryFrame) =>
        `${frame.scene}:${frame.outlineIndex ?? "-"}:${frame.mergeIndex ?? "-"}`,
    )
    .join("|");
}

/** 미션 서사의 사실 축 — 미션명·태스크·PR·의존순서·결론. */
function outlineSignature(storyboard: ReplayStoryboard): string {
  return JSON.stringify({
    goal: storyboard.model.goal,
    tasks: storyboard.outline.tasks.map((task) => [
      task.ref,
      task.title,
      task.prNumber,
      task.dependsOn,
      task.done,
    ]),
    mergeOrder: storyboard.outline.mergeOrder,
    conclusion: storyboard.conclusion,
  });
}

/** 쌍쌍 비교 — 모든 조합이 서로 달라야 "미션별로 다르다"가 성립한다. */
function pairs<T>(items: readonly T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1)
      out.push([items[i], items[j]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 소프트웨어 래스터라이저 — 진짜 픽셀을 만들어 `gifenc` 로 넘긴다.
//
// ★폰트 렌더링은 하지 않는다. 글자는 (문자열·폰트·정렬·색)에서 파생된 결정적
// 픽셀 패턴으로 찍힌다. 목적은 글꼴 재현이 아니라 **"그린 내용이 다르면 인코딩된
// 바이트도 다르다"를 실제 인코더로 통과시키는 것**이다. 그래서 이 하네스는 두
// 성질만 보장하면 충분하다:
//   (1) 내용 민감 — 한 글자·한 좌표만 달라도 픽셀이 달라진다.
//   (2) 결정적 — 같은 호출 시퀀스면 같은 픽셀. 시계·난수를 안 쓴다.
// 두 성질은 아래 "래스터 하네스 자체 검증" describe 가 직접 핀한다(하네스가
// 글자를 무시하기 시작하면 바이트 비교가 조용히 무의미해지므로).
// ---------------------------------------------------------------------------

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseColor(style: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(style.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const h = hashString(style);
  return [h & 255, (h >>> 8) & 255, (h >>> 16) & 255];
}

interface RasterCanvas extends ReplayMotionCanvasLike {
  pixels(): Uint8ClampedArray;
}

function createRasterCanvas(): RasterCanvas {
  const width = REPLAY_MOTION_WIDTH;
  const height = REPLAY_MOTION_HEIGHT;
  const data = new Uint8ClampedArray(width * height * 4);

  function put(x: number, y: number, rgb: [number, number, number]): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const offset = (py * width + px) * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  }

  const ctx: ReplayMotionCanvasContext = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect(x: number, y: number, w: number, h: number): void {
      const rgb = parseColor(ctx.fillStyle);
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(width, Math.ceil(x + w));
      const y1 = Math.min(height, Math.ceil(y + h));
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) put(px, py, rgb);
      }
    },
    fillText(text: string, x: number, y: number): void {
      const rgb = parseColor(ctx.fillStyle);
      const seed = hashString(`${text}|${ctx.font}|${ctx.textAlign}`);
      const glyphWidth = 7;
      const runWidth = text.length * glyphWidth;
      const startX =
        ctx.textAlign === "right"
          ? x - runWidth
          : ctx.textAlign === "center"
            ? x - runWidth / 2
            : x;
      for (let i = 0; i < text.length; i += 1) {
        const bits = (text.charCodeAt(i) ^ (seed >>> (i % 17))) >>> 0;
        for (let row = 0; row < 12; row += 1) {
          for (let col = 0; col < glyphWidth - 1; col += 1) {
            if (((bits >>> ((row * 6 + col) % 30)) & 1) === 0) continue;
            put(startX + i * glyphWidth + col, y - 12 + row, rgb);
          }
        }
      }
    },
    measureText: (text: string) => ({ width: text.length * 8 }),
    getImageData: () => ({ data }),
  };

  return { getContext: () => ctx, pixels: () => data };
}

/** 인코딩을 몇 프레임으로 줄이되 **모든 장면**은 지나가도록. */
const FAST_TIMING = { fps: 2, durationScale: 0.5 } as const;

async function encodeMissionGif(
  fixture: MissionFixture,
  list: readonly MissionFixture[],
): Promise<Uint8Array> {
  const blob = await renderReplayMotionGif(redactedFor(fixture, list), {
    template: "mission",
    timing: FAST_TIMING,
    createCanvas: createRasterCanvas,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------

describe("미션 선택 목록 — 세 미션이 각각 다른 모양으로 뜬다", () => {
  it("셋 다 목록에 있고, 태스크·완료·PR 수가 미션별로 다르다", () => {
    const list = fixtures();
    const options = buildMissionGifOptions(
      list.map((fixture) => fixture.mission),
      allTasks(list),
    );

    const byId = new Map(options.map((option) => [option.missionId, option]));
    expect([...byId.keys()].sort()).toEqual([
      "mission-onboarding",
      "mission-payment",
      "mission-replay",
    ]);
    expect(byId.get("mission-payment")).toMatchObject({
      label: "결제 P0 하드닝",
      taskCount: 3,
      doneCount: 3,
      prCount: 3,
      completed: true,
    });
    expect(byId.get("mission-replay")).toMatchObject({
      label: "리플레이 MVP",
      taskCount: 2,
      doneCount: 1,
      prCount: 2,
      completed: false,
    });
    expect(byId.get("mission-onboarding")).toMatchObject({
      label: "비기너 모드",
      taskCount: 4,
      doneCount: 4,
      prCount: 4,
      completed: true,
    });
  });

  it("보드·퀵레인 티켓은 어느 미션 수치에도 안 섞인다", () => {
    const list = fixtures();
    const options = buildMissionGifOptions(
      list.map((fixture) => fixture.mission),
      allTasks(list),
    );
    const total = options.reduce((sum, option) => sum + option.taskCount, 0);
    expect(total).toBe(3 + 2 + 4);
  });
});

describe("outline 분별력 — 미션별로 서로 다른 사실이 실린다", () => {
  const list = fixtures();
  const boards = list.map((fixture) => ({
    fixture,
    storyboard: storyboardFor(fixture, list),
  }));

  it("고른 미션의 태스크 제목만 실린다(다른 미션 것은 한 건도 없다)", () => {
    for (const { fixture, storyboard } of boards) {
      const titles = storyboard.outline.tasks.map((task) => task.title);
      expect(titles.sort()).toEqual([...fixture.titles].sort());

      const foreign = list
        .filter((other) => other.key !== fixture.key)
        .flatMap((other) => other.titles);
      for (const title of foreign) expect(titles).not.toContain(title);
    }
  });

  it("고른 미션의 PR 번호만 실린다", () => {
    const numbers = new Map(
      boards.map(({ fixture, storyboard }) => [
        fixture.key,
        storyboard.outline.tasks.map((task) => task.prNumber),
      ]),
    );
    expect(numbers.get("payment")).toEqual([830, 831, 832]);
    expect(numbers.get("replay")).toEqual([901, 902]);
    // ★생성순(640 이 가장 먼저 만들어짐)이 아니라 의존 위상순서.
    expect(numbers.get("onboarding")).toEqual([641, 642, 643, 640]);
  });

  it("머지 순서가 미션별로 다르고, 완료된 PR 만 들어간다", () => {
    const merge = new Map(
      boards.map(({ fixture, storyboard }) => [
        fixture.key,
        storyboard.outline.mergeOrder,
      ]),
    );
    expect(merge.get("payment")).toEqual([830, 831, 832]);
    // 진행 중 태스크(#902)의 PR 은 '머지됨' 순서에 못 들어간다.
    expect(merge.get("replay")).toEqual([901]);
    expect(merge.get("onboarding")).toEqual([641, 642, 643, 640]);
  });

  it("의존 순서(ref 사슬)가 미션별로 다르다", () => {
    const deps = new Map(
      boards.map(({ fixture, storyboard }) => [
        fixture.key,
        storyboard.outline.tasks.map((task) => task.dependsOn),
      ]),
    );
    expect(deps.get("payment")).toEqual([[], ["A"], ["B"]]);
    // 의존 간선이 아예 없는 미션 — "의존성 순서대로"라고 말하면 안 된다.
    expect(deps.get("replay")).toEqual([[], []]);
    expect(deps.get("onboarding")).toEqual([[], ["A"], ["A"], ["B", "C"]]);

    expect(
      boards.map(({ storyboard }) => storyboard.outline.hasDependencies),
    ).toEqual([true, false, true]);
  });

  it("미션명·태스크·PR·의존·결론을 합친 지문이 쌍쌍이 다르다", () => {
    const signatures = boards.map(({ storyboard }) =>
      outlineSignature(storyboard),
    );
    for (const [a, b] of pairs(signatures)) expect(a).not.toBe(b);
  });
});

describe("프레임 플랜·그려지는 텍스트 — 미션별로 다른 GIF 가 된다", () => {
  const list = fixtures();
  const boards = list.map((fixture) => ({
    fixture,
    storyboard: storyboardFor(fixture, list),
  }));

  it("장면 순서는 템플릿 상수라 같지만, 프레임의 내용 축은 미션별로 다르다", () => {
    // 같아야 하는 것 — 미션 컷의 장면 순서.
    for (const { storyboard } of boards) {
      expect(storyboard.scenes.map((scene) => scene.kind)).toEqual([
        "headline",
        "breakdown",
        "worktree",
        "merge",
        "conclusion",
      ]);
    }
    // 달라야 하는 것 — 어느 태스크·어느 PR 이 프레임마다 살아나는가.
    const signatures = boards.map(({ storyboard }) =>
      framePlanSignature(storyboard),
    );
    for (const [a, b] of pairs(signatures)) expect(a).not.toBe(b);
  });

  it("프레임에 그려진 문자열 집합이 쌍쌍이 다르다", () => {
    const blobs = boards.map(({ storyboard }) =>
      allDrawnTexts(storyboard).join("\n"),
    );
    for (const [a, b] of pairs(blobs)) expect(a).not.toBe(b);
  });

  it("고른 미션의 미션명·제목·PR 칩이 그려지고, 다른 미션 것은 안 그려진다", () => {
    for (const { fixture, storyboard } of boards) {
      const texts = allDrawnTexts(storyboard);
      expect(texts).toContain(fixture.mission.goal);
      for (const title of fixture.titles) expect(texts).toContain(title);
      for (const chip of fixture.prChips) expect(texts).toContain(chip);

      for (const other of list) {
        if (other.key === fixture.key) continue;
        for (const title of other.titles) expect(texts).not.toContain(title);
        for (const chip of other.prChips) expect(texts).not.toContain(chip);
        expect(texts).not.toContain(other.mission.goal);
      }
    }
  });

  it("의존 간선이 없는 미션은 '의존성 순서대로'라고 그리지 않는다", () => {
    const byKey = new Map(
      boards.map(({ fixture, storyboard }) => [
        fixture.key,
        allDrawnTexts(storyboard),
      ]),
    );
    expect(byKey.get("payment")).toContain("의존성 순서대로 실행 → 머지");
    expect(byKey.get("replay")).toContain("병렬 실행 → 머지");
    expect(byKey.get("replay")).not.toContain("의존성 순서대로 실행 → 머지");
  });
});

describe("진행 중 미션은 '완료'라고 말하지 않는다", () => {
  const list = fixtures();

  it("완료 미션만 '완료'로 닫고, 진행 중 미션은 진행 중으로 닫는다", () => {
    const conclusions = new Map(
      list.map((fixture) => [
        fixture.key,
        storyboardFor(fixture, list).conclusion,
      ]),
    );
    expect(conclusions.get("payment")).toEqual([
      "태스크 3/3 · PR 3건 머지",
      "의존성 순서대로 실행·머지 완료",
    ]);
    expect(conclusions.get("onboarding")).toEqual([
      "태스크 4/4 · PR 4건 머지",
      "의존성 순서대로 실행·머지 완료",
    ]);
    // ★1/2 만 끝난 미션 — 의존 간선도 없으므로 순서를 지어내지도 않는다.
    expect(conclusions.get("replay")).toEqual([
      "태스크 1/2 · PR 1건 머지",
      "진행 중",
    ]);
  });

  it("진행 중 미션의 어떤 프레임에도 '완료'가 그려지지 않는다", () => {
    const replayFx = list.find((fixture) => fixture.key === "replay")!;
    const texts = allDrawnTexts(storyboardFor(replayFx, list));
    for (const line of texts) expect(line).not.toContain("완료");
    expect(texts).toContain("진행 중");
  });

  it("한 태스크가 끝나면 결론이 따라 움직인다(고정 문구가 아니다)", () => {
    const list2 = fixtures();
    const replayFx = list2.find((fixture) => fixture.key === "replay")!;
    replayFx.tasks[1] = { ...replayFx.tasks[1], status: "DONE" };
    const conclusion = storyboardFor(replayFx, list2).conclusion;
    expect(conclusion[0]).toBe("태스크 2/2 · PR 2건 머지");
    // 미션 문서는 아직 active 지만, 결론은 태스크 사실에서 파생된다.
    expect(conclusion[1]).toBe("병렬로 실행·머지 완료");
  });
});

describe("인코딩된 GIF 바이트 — 미션마다 다르고, 같은 입력이면 똑같다", () => {
  it("세 미션의 GIF 바이트가 쌍쌍이 다르다", async () => {
    const list = fixtures();
    const encoded: Array<[string, Uint8Array]> = [];
    for (const fixture of list) {
      encoded.push([fixture.key, await encodeMissionGif(fixture, list)]);
    }

    for (const [, bytes] of encoded) {
      // GIF89a 헤더 — 진짜 인코더를 통과했다는 최소 증거.
      expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
      expect(bytes.byteLength).toBeGreaterThan(1024);
    }
    for (const [[keyA, a], [keyB, b]] of pairs(encoded)) {
      expect(`${keyA}:${toHex(a).slice(0, 64)}`).not.toBe(
        `${keyB}:${toHex(b).slice(0, 64)}`,
      );
      expect(toHex(a)).not.toBe(toHex(b));
    }
  }, 60_000);

  it("같은 미션을 두 번 인코딩하면 바이트가 동일하다(시계·캐시 개입 없음)", async () => {
    const first = await encodeMissionGif(paymentFixture(), fixtures());
    const second = await encodeMissionGif(paymentFixture(), fixtures());
    expect(toHex(second)).toBe(toHex(first));
  }, 60_000);

  it("픽스처의 제목 한 줄만 바꿔도 바이트가 달라진다(미션ID 캐시 금지)", async () => {
    const list = fixtures();
    const payment = list[0];
    const before = await encodeMissionGif(payment, list);

    const tweaked = fixtures();
    // 같은 미션 id·같은 태스크 수 — 바뀐 것은 제목 한 줄뿐이다.
    tweaked[0].tasks = tweaked[0].tasks.map((task) =>
      task.id === "pay-a" ? { ...task, title: "결제 코드맵 재정본화" } : task,
    );
    const after = await encodeMissionGif(tweaked[0], tweaked);

    expect(toHex(after)).not.toBe(toHex(before));
  }, 60_000);

  /**
   * ★GIF 전체 바이트 비교만으로는 부족하다. 미션명은 어차피 미션마다 다르므로,
   * 태스크 분해가 전부 같은 집계로 무너져도(예: 미션 필터가 빠져 프로젝트 전체
   * 태스크가 들어가도) headline 프레임 하나 때문에 바이트는 달라진다. 그래서
   * **서사를 지고 있는 장면**(분해·머지)의 픽셀만 따로 떼어 본다.
   */
  it("분해·머지 장면의 픽셀이 미션별로 다르다(미션명 차이에 기대지 않는다)", () => {
    const list = fixtures();
    const rendered = list.map((fixture) => {
      const storyboard = storyboardFor(fixture, list);
      const frames = planReplayStoryboardFrames(storyboard);
      const digests: string[] = [];
      for (const scene of ["breakdown", "merge"] as const) {
        // 장면의 마지막 프레임 — 그 장면이 다 드러난 순간.
        const frame = [...frames]
          .reverse()
          .find((candidate) => candidate.scene === scene);
        expect(frame).toBeDefined();
        const canvas = createRasterCanvas();
        drawReplayStoryboardFrame(canvas.getContext("2d")!, storyboard, frame!);
        digests.push(
          `${scene}:${createHash("sha256").update(canvas.pixels()).digest("hex")}`,
        );
      }
      return { key: fixture.key, digests };
    });

    for (const [a, b] of pairs(rendered)) {
      expect(`${a.key}:${a.digests.join()}`).not.toBe(
        `${b.key}:${b.digests.join()}`,
      );
      expect(a.digests).not.toEqual(b.digests);
    }
  });
});

describe("래스터 하네스 자체 검증 — 바이트 비교가 조용히 무의미해지지 않도록", () => {
  it("글자 내용이 다르면 픽셀이 다르다(fillText 를 무시하지 않는다)", () => {
    const a = createRasterCanvas();
    const b = createRasterCanvas();
    for (const canvas of [a, b]) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#101828";
      ctx.fillRect(0, 0, REPLAY_MOTION_WIDTH, REPLAY_MOTION_HEIGHT);
      ctx.fillStyle = "#ffffff";
    }
    a.getContext("2d")!.fillText("결제 코드맵 정본화", 64, 250);
    b.getContext("2d")!.fillText("결제 코드맵 정본황", 64, 250);
    expect(Buffer.from(b.pixels()).equals(Buffer.from(a.pixels()))).toBe(false);
  });

  it("같은 호출 시퀀스면 같은 픽셀이다(난수·시계 없음)", () => {
    const draw = (canvas: RasterCanvas) => {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#101828";
      ctx.fillRect(0, 0, REPLAY_MOTION_WIDTH, REPLAY_MOTION_HEIGHT);
      ctx.fillStyle = "#a78bfa";
      ctx.fillText("#830", 1136, 300);
    };
    const a = createRasterCanvas();
    const b = createRasterCanvas();
    draw(a);
    draw(b);
    expect(Buffer.from(b.pixels()).equals(Buffer.from(a.pixels()))).toBe(true);
  });
});

describe("집계 자체가 미션별로 다르다(같은 프로젝트 집계로 안 떨어진다)", () => {
  const list = fixtures();

  it("stats·generatedAt·직렬화 바이트가 미션별로 다르다", () => {
    const replays = list.map((fixture) =>
      buildMissionReplay(sourcesFor(fixture, list), {
        now: NOW,
        includeIncomplete: true,
      }),
    );

    expect(replays.map((replay) => replay?.stats.tasks)).toEqual([3, 2, 4]);
    expect(replays.map((replay) => replay?.stats.tasksDone)).toEqual([3, 1, 4]);
    // ★`stats.prs` 는 **완료된** 태스크의 PR 만 센다(선택 목록의 `prCount` 는
    // 파싱 가능한 PR URL 전부를 세므로 진행 중 미션에서 둘이 갈린다: 2 vs 1).
    expect(replays.map((replay) => replay?.stats.prs)).toEqual([3, 1, 4]);
    expect(replays.map((replay) => replay?.missionId)).toEqual([
      "mission-payment",
      "mission-replay",
      "mission-onboarding",
    ]);
    // 시각은 주입한 상수 그대로 — 파이프라인 어디에도 `Date.now()` 가 없다.
    for (const replay of replays) {
      expect(replay?.provenance.generatedAt).toEqual(NOW);
    }

    const serialized = list.map(
      (fixture) => redactedFor(fixture, list).serialized,
    );
    for (const [a, b] of pairs(serialized)) expect(a).not.toBe(b);
  });

  it("어느 미션이든 PR URL·저장소 좌표는 여전히 안 나간다", () => {
    for (const fixture of list) {
      const { serialized } = redactedFor(fixture, list);
      expect(serialized).not.toContain("github.com");
      expect(serialized).not.toContain("/pull/");
    }
  });
});
