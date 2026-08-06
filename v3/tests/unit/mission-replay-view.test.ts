/**
 * Mission Replay — 인앱 뷰(Phase 1) 렌더 테스트.
 *
 * 핀하는 계약:
 *   - 실데이터 1건으로 헤드라인·통계·타임라인·최종결과·캐스트가 전부 렌더된다
 *     (설계 §4 Phase 1 완료 기준).
 *   - 순수 뷰에는 공유 경로가 없다. 컨테이너가 명시적으로 `onShare`를 주입할
 *     때만 별도 레닭션 마법사의 진입점이 나타난다.
 *   - `denied`(권한 없음)와 `empty`(기록 0건)가 **다른 화면**으로 그려진다. 이게
 *     P1-1/P1-2 가 타입·구독 계층에서 지켜 온 구분의 마지막 구간이다(설계 C2/R4).
 *   - 못 읽은 소스에서 나온 수치는 `0` 이 아니라 `—` 다("사람 개입 0회"라는 거짓말 금지).
 *
 * renderToStaticMarkup 을 쓰는 이유는 `notebookRawFallback.test.ts` 와 같다: 이 뷰가
 * 하는 일(상태 분기 → 문자열 선택 → 마크업)은 DOM 없이 전부 도달 가능하고, 스위트는
 * node 환경에서 돈다.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";

/**
 * `lib/firebase` 는 모듈 로드 시점에 `initializeAuth` 를 부른다 — VITE_FIREBASE_*
 * 없이는 import 만으로 죽는다(`mission-replay-service.test.ts` 와 같은 이유).
 * 여기서 그리는 것은 **상태를 받아 마크업을 내는 순수 뷰**라 실제 배선은 한 번도
 * 호출되지 않는다.
 */
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));
import { renderToStaticMarkup } from "react-dom/server";

import { MissionReplayDetailView } from "../../src/components/work-history/replay/MissionReplayDetail";
import { MissionReplayListView } from "../../src/components/work-history/replay/MissionReplayList";
import { buildMissionReplay } from "../../src/lib/replay/missionReplay";
import type { MissionReplaySources } from "../../src/lib/replay/beats";
import type {
  MissionReplayState,
  ReplayMissionsState,
  ReplaySourceErrors,
} from "../../src/services/missionReplayService";
import type { TFunction } from "../../src/lib/i18n";
import type { Activity } from "../../src/types/activity";
import type { Agent } from "../../src/types/agent";
import type { Mission } from "../../src/types/mission";
import type { Task } from "../../src/types/task";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

const T0 = new Date("2026-08-01T09:00:00Z");
const NOW = new Date("2026-08-01T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/**
 * 번역 함수 — 훅(`useTranslation`)이 아니라 ko 테이블을 직접 읽는다.
 *
 * 로케일 스토어를 건드리지 않으려는 것도 있지만, 진짜 이유는 **문구가 바뀌어도
 * 테스트가 안 깨지게** 하기 위해서다. 아래 단언들은 리터럴이 아니라 `ko[...]` 를
 * 비교하므로, 이 테스트가 지키는 것은 카피가 아니라 **어떤 상태에 어떤 문구가
 * 붙는가** 다. 자리표시자 치환은 런타임 `format` 과 같은 규칙을 쓴다.
 */
const t: TFunction = (key, vars) => {
  const raw = ko[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
};

/**
 * 단언용 문구 — 번역 문자열을 **React 가 마크업에 쓰는 형태**로 맞춘다.
 *
 * 렌더 결과는 HTML 이라 따옴표가 `&#x27;` 로 escape 된다. 이걸 안 맞추면 문구에
 * 따옴표가 들어간 순간(예: "'기록 없음'이 아닙니다") 단언이 조용히 실패하고,
 * 원인이 렌더 버그처럼 보인다.
 */
function msg(key: Parameters<TFunction>[0], vars?: Parameters<TFunction>[1]) {
  return t(key, vars)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "proj-1",
    goal: "Mission Replay 인앱 뷰",
    templateId: "feature",
    status: "completed",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a"],
    contextLog: [
      {
        ts: at(2),
        type: "step.started",
        payload: { stepIndex: 0, agentId: "agent-x" },
      },
      {
        ts: at(60),
        type: "step.completed",
        payload: { stepIndex: 0 },
      },
    ],
    launchedAt: T0,
    lastActivityAt: at(90),
    completedAt: at(90),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-a",
    projectId: "proj-1",
    contextId: "mission-1",
    title: "Replay 뷰 구현",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-x",
    claimedAt: at(5),
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: at(1),
    updatedAt: at(80),
    ...overrides,
  };
}

const REPORT = [
  "✅ 완료 보고",
  "- 문제: 완료 미션을 볼 방법이 없었다",
  "- 접근: 파생 뷰 조립",
  "- 검증: vitest 통과 + tsc green",
  "- PR: https://github.com/melocream/marblo/pull/999",
].join("\n");

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    taskId: "task-a",
    agentId: "agent-x",
    message: REPORT,
    createdAt: at(75),
    ...overrides,
  } as Activity;
}

function makeReplay(
  sources: Partial<MissionReplaySources> = {},
  options?: Parameters<typeof buildMissionReplay>[1],
) {
  const replay = buildMissionReplay(
    {
      mission: makeMission(),
      tasks: [makeTask()],
      agents: [
        {
          id: "agent-x",
          projectId: "proj-1",
          name: "frontend-1",
          role: "frontend",
          model: "claude",
          spawnedModel: "claude-opus-5",
          detectedModelId: "claude-opus-5",
          status: "idle",
        } as Agent,
      ],
      activitiesByTaskId: { "task-a": [makeActivity()] },
      mergeHistory: [
        {
          id: "m1",
          projectId: "proj-1",
          taskId: "task-a",
          repoRoot: "/repo",
          branch: "feat",
          baseRef: "main",
          headSha: "abc1234",
          mode: "auto",
          mergedAt: at(85),
          filesChanged: 7,
          linesAdded: 210,
          linesDeleted: 14,
        },
      ],
      ...sources,
    },
    { now: NOW, ...options },
  );
  if (!replay) throw new Error("fixture must be replayable");
  return replay;
}

function renderDetail(state: MissionReplayState, onShare?: () => void): string {
  return renderToStaticMarkup(
    createElement(MissionReplayDetailView, {
      state,
      onBack: () => {},
      onReload: () => {},
      onShare,
      t,
    }),
  );
}

function renderReady(
  replay: ReturnType<typeof makeReplay>,
  sourceErrors: ReplaySourceErrors = {},
): string {
  return renderDetail({ status: "ready", replay, sourceErrors });
}

function renderList(
  state: ReplayMissionsState,
  fallbackMissions: Mission[] = [],
): string {
  return renderToStaticMarkup(
    createElement(MissionReplayListView, {
      state,
      fallbackMissions,
      onSelect: () => {},
      onReload: () => {},
      onCreateMission: () => {},
      t,
    }),
  );
}

/** 최종 결과 표에서 라벨에 붙은 값 하나를 뽑는다. */
function outcomeValue(markup: string, label: string): string | null {
  const pattern = new RegExp(`${label}</dt><dd[^>]*>([^<]*)</dd>`);
  return markup.match(pattern)?.[1] ?? null;
}

/** 마크업에서 클릭 가능한 표면(버튼 라벨 + 링크 href)만 뽑는다. */
function clickableSurfaces(markup: string): string[] {
  const labels = [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(
    (m) => m[1].replace(/<[^>]+>/g, " "),
  );
  const hrefs = [...markup.matchAll(/<a[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  return [...labels, ...hrefs];
}

describe("Replay 상세 — 실데이터 렌더", () => {
  it("헤드라인·통계·타임라인·최종결과·캐스트가 전부 나온다", () => {
    const markup = renderReady(makeReplay());

    // 헤드라인
    expect(markup).toContain("Mission Replay 인앱 뷰");
    expect(markup).toContain("feature");
    expect(markup).toContain(msg("workHistory.replay.provenance.title"));
    // 소요시간 1시간 30분
    expect(markup).toContain("1시간");
    expect(markup).toContain("30분");

    // 통계 — 완료/전체, 파일 수, 라인
    expect(markup).toContain("1/1");
    expect(markup).toContain(">7<");
    expect(markup).toContain("+210/-14");

    // 타임라인 — 오케 비트와 태스크 비트가 실제로 그려진다
    expect(markup).toContain("step.started");
    expect(markup).toContain("step.completed");
    expect(markup).toContain("Replay 뷰 구현");
    expect(markup).toContain(msg("workHistory.replay.timeline.title"));

    // 최종 결과 — PR 링크
    expect(markup).toContain("https://github.com/melocream/marblo/pull/999");

    // 캐스트 — 익명 별칭 + 관측 모델
    expect(markup).toContain("agent-1 · claude");
    expect(markup).toContain("claude-opus-5");
  });

  it("성과 히어로·공유 형식 바·계층 타임라인을 렌더한다", () => {
    const markup = renderDetail(
      { status: "ready", replay: makeReplay(), sourceErrors: {} },
      () => {},
    );

    expect(markup).toContain('data-testid="replay-accomplishment-hero"');
    expect(markup).toContain(
      msg("workHistory.replay.hero.title", { count: 1 }),
    );
    expect(markup).toContain(msg("workHistory.replay.shareBar.title"));
    expect(markup).toContain(msg("workHistory.replay.shareBar.card"));
    expect(markup).toContain(msg("workHistory.replay.shareBar.gif"));
    expect(markup).toContain(msg("workHistory.replay.shareBar.link"));
    expect(markup).toContain(
      msg("workHistory.replay.timeline.ticketBeats", { count: 4 }),
    );
  });

  it("사람 식별자(uid)나 git 좌표(headSha·repoRoot)는 화면에 안 나온다", () => {
    const markup = renderReady(makeReplay());
    expect(markup).not.toContain("abc1234");
    expect(markup).not.toContain("/repo");
    // 원 agentId 대신 별칭만 쓴다.
    expect(markup).not.toContain(">agent-x<");
  });
});

describe("순수 뷰의 공유 경계", () => {
  it("공유·공개·익스포트·remix 버튼이 하나도 없다", () => {
    const surfaces = clickableSurfaces(renderReady(makeReplay()));
    for (const surface of surfaces) {
      expect(
        /공유|내보내|퍼블리|공개하|remix|export|publish|share|clipboard/i.test(
          surface,
        ),
        `클릭 표면에 공개 경로가 생겼다: ${surface}`,
      ).toBe(false);
    }
  });

  it("링크는 이미 공개된 PR URL 뿐이다(새 발행 경로 없음)", () => {
    const markup = renderReady(makeReplay());
    const hrefs = [...markup.matchAll(/<a[^>]*href="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs).toEqual(["https://github.com/melocream/marblo/pull/999"]);
  });
});

describe("공유 마법사 진입점", () => {
  it("컨테이너가 onShare를 주입한 완료 미션에만 공유하기 버튼을 렌더한다", () => {
    expect(renderDetail({ status: "loading" }, () => {})).not.toContain(
      "공유하기",
    );
    expect(
      renderDetail(
        { status: "ready", replay: makeReplay(), sourceErrors: {} },
        () => {},
      ),
    ).toContain("공유하기");
  });
});

describe("권한저하 — denied 는 empty 가 아니다", () => {
  it("사람 레인이 denied 면 개입 수치가 0 이 아니라 '—' 이고 사유가 표시된다", () => {
    const replay = makeReplay(
      {},
      { sourceAccess: { projectAuditLog: "denied" } },
    );
    const markup = renderReady(replay);

    expect(markup).toContain(msg("workHistory.replay.provenance.denied"));
    expect(markup).toContain(msg("workHistory.replay.provenance.deniedNote"));
    // 사람 레인이 통째로 비었다는 사실을 타임라인에서도 말한다.
    expect(markup).toContain("권한이 없어 읽지 못했습니다");
    // ★수치는 0 이 아니라 "—" 여야 한다 — "사람 개입 0회"는 거짓말이다.
    expect(
      outcomeValue(markup, msg("workHistory.replay.outcome.interventions")),
    ).toBe("—");

    // 대조군: 권한이 정상이면 같은 칸이 실제 수치(0건)로 그려진다.
    const ok = renderReady(makeReplay());
    expect(
      outcomeValue(ok, msg("workHistory.replay.outcome.interventions")),
    ).toBe("0");
  });

  it("소스 로드 실패(권한 아님)는 '불러오지 못함'으로 따로 표기된다", () => {
    const markup = renderReady(makeReplay(), {
      merge_history: "network error",
    });
    expect(markup).toContain(msg("workHistory.replay.provenance.failed"));
    expect(markup).toContain(msg("workHistory.replay.provenance.errorNote"));
  });

  it("권한이 정상이면 denied 문구는 안 나온다", () => {
    const markup = renderReady(makeReplay());
    expect(markup).not.toContain(
      msg("workHistory.replay.provenance.deniedNote"),
    );
    expect(markup).not.toContain(
      msg("workHistory.replay.provenance.errorNote"),
    );
  });
});

describe("Replay 상세 — 비/로딩/불가 상태", () => {
  it("로딩은 스피너 문구를 그리고 터지지 않는다", () => {
    expect(renderDetail({ status: "loading" })).toContain(
      msg("workHistory.replay.loading"),
    );
  });

  it("not-found / not-completed / denied 가 서로 다른 문구다", () => {
    const notFound = renderDetail({
      status: "unavailable",
      reason: "not-found",
    });
    const notCompleted = renderDetail({
      status: "unavailable",
      reason: "not-completed",
    });
    const denied = renderDetail({ status: "unavailable", reason: "denied" });

    expect(notFound).toContain(msg("workHistory.replay.unavailable.notFound"));
    expect(notCompleted).toContain(
      msg("workHistory.replay.unavailable.notCompleted"),
    );
    expect(denied).toContain(msg("workHistory.replay.unavailable.denied"));
    expect(new Set([notFound, notCompleted, denied]).size).toBe(3);
  });

  it("에러는 원인 메시지를 같이 보여준다", () => {
    const markup = renderDetail({ status: "error", message: "boom" });
    expect(markup).toContain("boom");
  });

  it("비트가 하나도 없는 미션도 렌더된다(빈 타임라인)", () => {
    const replay = makeReplay({
      mission: makeMission({ contextLog: [] }),
      tasks: [],
      activitiesByTaskId: {},
      mergeHistory: [],
    });
    const markup = renderReady(replay);
    expect(markup).toContain(msg("workHistory.replay.timeline.empty"));
    expect(markup).toContain(msg("workHistory.replay.cast.empty"));
    expect(markup).toContain(msg("workHistory.replay.outcome.noPrs"));
  });
});

describe("Replay 목록", () => {
  it("로딩 / 권한없음 / 빈목록이 서로 다른 화면이다", () => {
    const loading = renderList({ status: "loading" });
    const denied = renderList({ status: "denied" });
    const empty = renderList({ status: "ready", missions: [] });

    expect(loading).toContain(msg("workHistory.replay.list.loading"));
    expect(denied).toContain(msg("workHistory.replay.list.denied"));
    expect(empty).toContain(msg("workHistory.replay.list.empty.title"));
    // ★"권한 없음"과 "완료 미션 0건"이 같은 문구로 접히면 안 된다.
    expect(denied).not.toContain(msg("workHistory.replay.list.empty.title"));
    expect(empty).not.toContain(msg("workHistory.replay.list.denied"));
  });

  it("에러는 원인 메시지 + 재시도 버튼을 준다", () => {
    const markup = renderList({ status: "error", message: "quota exceeded" });
    expect(markup).toContain("quota exceeded");
    expect(markup).toContain(msg("workHistory.replay.list.retry"));
  });

  it("완료 미션 카드에 goal·템플릿·소요시간이 나온다", () => {
    const markup = renderList({
      status: "ready",
      missions: [makeMission()],
    });
    expect(markup).toContain("Mission Replay 인앱 뷰");
    expect(markup).toContain("feature");
    expect(markup).toContain("1시간");
    expect(markup).toContain(
      msg("workHistory.replay.list.count", { count: 1 }),
    );
  });

  it("missions 가 비어도 완료 작업 fallback 이 있으면 경량 Replay 카드를 보여준다", () => {
    const markup = renderList({ status: "ready", missions: [] }, [
      makeMission({
        id: "__work_history_done_summary__",
        goal: "완료 작업 요약 1건",
        templateId: "adhoc",
        missionKind: "implicit",
      }),
    ]);
    expect(markup).toContain(msg("workHistory.replay.list.lightweight.title"));
    expect(markup).toContain("완료 작업 요약 1건");
    expect(markup).toContain(msg("workHistory.replay.list.empty.cta"));
    expect(markup).not.toContain(msg("workHistory.replay.list.empty.title"));
  });

  it("빈 상태는 첫 미션 생성 CTA 와 방법을 같이 보여준다", () => {
    const markup = renderList({ status: "ready", missions: [] });
    expect(markup).toContain(msg("workHistory.replay.list.empty.title"));
    expect(markup).toContain(msg("workHistory.replay.list.empty.createHint"));
    expect(markup).toContain(msg("workHistory.replay.list.empty.cta"));
  });

  it("목록에도 공유·익스포트 표면이 없다", () => {
    const surfaces = clickableSurfaces(
      renderList({ status: "ready", missions: [makeMission()] }),
    );
    for (const surface of surfaces) {
      expect(
        /공유|내보내|remix|export|publish|share/i.test(surface),
        surface,
      ).toBe(false);
    }
  });
});

describe("Replay locale contract", () => {
  it("en copy exposes sharing and no longer says there is no export path", () => {
    expect(en["workHistory.replay.hero.title"]).toBe(
      "Your AI team completed {count} tasks.",
    );
    expect(en["workHistory.replay.privateNotice"]).toContain("Sharing runs");
    expect(en["workHistory.replay.privateNotice"]).not.toMatch(
      /no share or export path/i,
    );
    expect(en["workHistory.replay.shareBar.card"]).toBe("Card");
    expect(en["workHistory.replay.list.empty.hint"]).toContain(
      "Start with a goal",
    );
  });
});
