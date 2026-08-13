import { describe, expect, it } from "vitest";
import {
  PROMOTION_MIN_COMPLETED,
  PROMOTION_MIN_DAYS,
  STALL_THRESHOLD_MS,
  parseBeginnerRecord,
  resolveInitialBeginnerMode,
  serializeBeginnerRecord,
  shouldPromote,
  summarizeBeginnerProgress,
  BEGINNER_COLUMN_LIMIT,
  beginnerBoardColumnFor,
  groupBeginnerBoard,
  beginnerComposerMode,
  shouldRenderOnboardingGuides,
  type BeginnerModeRecord,
  type PriorInstallMarkers,
} from "../../src/lib/beginnerMode";
import type { TaskStatus } from "../../src/types/task";

const FRESH: PriorInstallMarkers = {
  onboardingProgress: false,
  workspaceTab: false,
  workspaceModeFlag: false,
  legacyGateDismissed: false,
  storageUnavailable: false,
};

const RECORD: BeginnerModeRecord = {
  state: "beginner",
  enteredAt: 1_000,
  firstCompletionAt: 0,
  promotionShownAt: 0,
};

describe("resolveInitialBeginnerMode — 누가 비기너가 되는가", () => {
  it("깨끗한 신규 설치만 비기너로 간다", () => {
    expect(resolveInitialBeginnerMode(null, FRESH)).toBe("beginner");
  });

  // ★이 표가 깨지면 기존 유저의 보드가 사라진다. 마커 하나하나가 회귀 가드다.
  const markerKeys = [
    "onboardingProgress",
    "workspaceTab",
    "workspaceModeFlag",
    "legacyGateDismissed",
  ] as const;

  for (const key of markerKeys) {
    it(`${key} 마커가 있으면 기존 설치로 보고 advanced 를 유지한다`, () => {
      expect(resolveInitialBeginnerMode(null, { ...FRESH, [key]: true })).toBe(
        "advanced",
      );
    });
  }

  it("마커가 여러 개여도 advanced (OR 규칙)", () => {
    expect(
      resolveInitialBeginnerMode(null, {
        ...FRESH,
        onboardingProgress: true,
        workspaceTab: true,
      }),
    ).toBe("advanced");
  });

  it("저장소를 못 읽으면(프라이빗 모드) 기존 경험을 유지한다", () => {
    expect(
      resolveInitialBeginnerMode(null, { ...FRESH, storageUnavailable: true }),
    ).toBe("advanced");
  });

  it("저장된 결정이 항상 이긴다 — 마커가 뒤에 생겨도 모드가 흔들리지 않는다", () => {
    expect(
      resolveInitialBeginnerMode(RECORD, {
        ...FRESH,
        onboardingProgress: true,
        workspaceTab: true,
      }),
    ).toBe("beginner");
    expect(
      resolveInitialBeginnerMode({ ...RECORD, state: "advanced" }, FRESH),
    ).toBe("advanced");
  });
});

describe("parseBeginnerRecord", () => {
  it("round-trips", () => {
    expect(parseBeginnerRecord(serializeBeginnerRecord(RECORD))).toEqual(
      RECORD,
    );
  });

  it("없음 / 깨진 JSON / 낯선 state 는 전부 null (→ 호출부가 재판정)", () => {
    expect(parseBeginnerRecord(null)).toBeNull();
    expect(parseBeginnerRecord("")).toBeNull();
    expect(parseBeginnerRecord("{nope")).toBeNull();
    expect(parseBeginnerRecord('{"state":"expert"}')).toBeNull();
    expect(parseBeginnerRecord('"beginner"')).toBeNull();
  });

  it("망가진 타임스탬프는 0 으로 degrade 하되 state 는 살린다", () => {
    expect(
      parseBeginnerRecord(
        '{"state":"beginner","enteredAt":"어제","promotionShownAt":-5}',
      ),
    ).toEqual({
      state: "beginner",
      enteredAt: 0,
      firstCompletionAt: 0,
      promotionShownAt: 0,
    });
  });
});

describe("shouldPromote — 승격 트리거", () => {
  const none = { completedTasks: 0, mergedTasks: 0, elapsedMs: 0 };

  it("아무 신호도 없으면 제안하지 않는다", () => {
    expect(shouldPromote(none, false)).toBeNull();
  });

  it("완료 1~2건으로는 아직 이르다", () => {
    expect(
      shouldPromote(
        { ...none, completedTasks: PROMOTION_MIN_COMPLETED - 1 },
        false,
      ),
    ).toBeNull();
  });

  it("완료 N건이면 제안한다", () => {
    expect(
      shouldPromote(
        { ...none, completedTasks: PROMOTION_MIN_COMPLETED },
        false,
      ),
    ).toBe("completed");
  });

  it("첫 머지가 완료 건수보다 강한 신호다", () => {
    expect(
      shouldPromote({ completedTasks: 0, mergedTasks: 1, elapsedMs: 0 }, false),
    ).toBe("merged");
  });

  it("완료가 없어도 사흘째면 제안한다", () => {
    const threeDays = PROMOTION_MIN_DAYS * 24 * 60 * 60 * 1000;
    expect(
      shouldPromote({ ...none, elapsedMs: threeDays - 1 }, false),
    ).toBeNull();
    expect(shouldPromote({ ...none, elapsedMs: threeDays }, false)).toBe(
      "days",
    );
  });

  it("★한 번 띄웠으면 어떤 신호로도 다시 띄우지 않는다 (조르지 않는다)", () => {
    expect(
      shouldPromote(
        { completedTasks: 99, mergedTasks: 9, elapsedMs: 9e9 },
        true,
      ),
    ).toBeNull();
  });
});

describe("summarizeBeginnerProgress — ★S4 인라인 라이브", () => {
  const base = {
    sentAt: 0,
    now: 100_000,
    totalTasks: 0,
    completedTasks: 0,
    workingAgents: 0,
  };

  it("아무것도 안 보냈고 티켓도 없으면 스트립을 그리지 않는다", () => {
    expect(summarizeBeginnerProgress(base).phase).toBe("idle");
  });

  it("보낸 직후엔 '읽는 중'", () => {
    expect(
      summarizeBeginnerProgress({ ...base, sentAt: 90_000, now: 100_000 })
        .phase,
    ).toBe("thinking");
  });

  it("★90초가 지나도 티켓이 없으면 막힘 안내를 띄운다", () => {
    const view = summarizeBeginnerProgress({
      ...base,
      sentAt: 0 + 1,
      now: 1 + STALL_THRESHOLD_MS,
    });
    expect(view.phase).toBe("stalled");
    expect(view.showStallHelp).toBe(true);
  });

  it("경계 직전은 아직 '읽는 중' (막힘으로 성급히 넘기지 않는다)", () => {
    const view = summarizeBeginnerProgress({
      ...base,
      sentAt: 1,
      now: STALL_THRESHOLD_MS,
    });
    expect(view.phase).toBe("thinking");
    expect(view.showStallHelp).toBe(false);
  });

  it("티켓이 생겼는데 아직 일하는 에이전트가 없으면 '만들었어요'", () => {
    expect(
      summarizeBeginnerProgress({ ...base, sentAt: 1, totalTasks: 3 }).phase,
    ).toBe("planned");
  });

  it("에이전트가 일하면 '일하는 중'", () => {
    expect(
      summarizeBeginnerProgress({
        ...base,
        sentAt: 1,
        totalTasks: 3,
        workingAgents: 2,
      }).phase,
    ).toBe("working");
  });

  it("완료가 있고 일하는 에이전트가 없으면 '끝났어요'", () => {
    expect(
      summarizeBeginnerProgress({
        ...base,
        sentAt: 1,
        totalTasks: 3,
        completedTasks: 1,
      }).phase,
    ).toBe("completed");
  });

  it("★완료 뒤 새 작업이 돌면 '일하는 중'이 이긴다 (현재형이 더 정확하다)", () => {
    expect(
      summarizeBeginnerProgress({
        ...base,
        sentAt: 1,
        totalTasks: 5,
        completedTasks: 2,
        workingAgents: 1,
      }).phase,
    ).toBe("working");
  });

  it("★두 번째 요청은 다시 '읽는 중'으로 내려간다 (단조 증가가 아니다)", () => {
    // 앞선 요청으로 티켓이 생겼다가 전부 정리된 뒤 새 요청을 보낸 상태.
    const view = summarizeBeginnerProgress({
      sentAt: 500,
      now: 1_000,
      totalTasks: 0,
      completedTasks: 0,
      workingAgents: 0,
    });
    expect(view.phase).toBe("thinking");
  });

  it("보낸 적 없어도 티켓이 이미 있으면(재시작 등) 국면을 읽어 준다", () => {
    const view = summarizeBeginnerProgress({
      ...base,
      totalTasks: 4,
      completedTasks: 4,
    });
    expect(view.phase).toBe("completed");
    expect(view.showStallHelp).toBe(false);
  });

  it("카운트는 그대로 통과시킨다", () => {
    const view = summarizeBeginnerProgress({
      sentAt: 1,
      now: 2,
      totalTasks: 7,
      completedTasks: 3,
      workingAgents: 2,
    });
    expect(view).toMatchObject({
      totalTasks: 7,
      completedTasks: 3,
      workingAgents: 2,
    });
  });
});

describe("groupBeginnerBoard — 7상태 → 미니 보드 3컬럼", () => {
  const task = (id: string, status: TaskStatus) => ({ id, status });

  it("TODO 만 '할 일', DONE 만 '완료'", () => {
    const [todo, doing, done] = groupBeginnerBoard([
      task("a", "TODO"),
      task("b", "DONE"),
    ]);
    expect(todo.tasks.map((x) => x.id)).toEqual(["a"]);
    expect(doing.tasks).toEqual([]);
    expect(done.tasks.map((x) => x.id)).toEqual(["b"]);
  });

  it("CLAIMED·IN_PROGRESS·REVIEW 는 전부 '진행 중' 한 칸으로 접힌다", () => {
    const [, doing] = groupBeginnerBoard([
      task("a", "CLAIMED"),
      task("b", "IN_PROGRESS"),
      task("c", "REVIEW"),
    ]);
    expect(doing.tasks.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(doing.total).toBe(3);
  });

  it("★BLOCKED/FAILED 는 감추지 않는다 — '진행 중' 에 남는다", () => {
    // 감추면 막힌 티켓이 화면에서 사라진다 = 이 화면이 고치려는 바로 그 dead-end.
    const [todo, doing, done] = groupBeginnerBoard([
      task("a", "BLOCKED"),
      task("b", "FAILED"),
    ]);
    expect(beginnerBoardColumnFor("BLOCKED")).toBe("doing");
    expect(beginnerBoardColumnFor("FAILED")).toBe("doing");
    expect(doing.total).toBe(2);
    expect(todo.total + done.total).toBe(0);
  });

  it("컬럼 순서는 항상 할 일 → 진행 중 → 완료", () => {
    expect(groupBeginnerBoard([]).map((c) => c.column)).toEqual([
      "todo",
      "doing",
      "done",
    ]);
  });

  it("★배지 개수는 자르기 전 진짜 개수, 그린 카드만 상한을 받는다", () => {
    const many = Array.from({ length: BEGINNER_COLUMN_LIMIT + 3 }, (_, i) =>
      task(`t${i}`, "TODO"),
    );
    const [todo] = groupBeginnerBoard(many);
    expect(todo.total).toBe(BEGINNER_COLUMN_LIMIT + 3);
    expect(todo.tasks).toHaveLength(BEGINNER_COLUMN_LIMIT);
    expect(todo.hiddenCount).toBe(3);
  });

  it("상한 이하이면 숨긴 게 없다", () => {
    const [todo] = groupBeginnerBoard([task("a", "TODO")]);
    expect(todo.hiddenCount).toBe(0);
  });

  it("재사용하는 KanbanColumn 에 넘길 대표 상태를 함께 준다", () => {
    expect(groupBeginnerBoard([]).map((c) => c.status)).toEqual([
      "TODO",
      "IN_PROGRESS",
      "DONE",
    ]);
  });
});

/**
 * ★대화 표면은 하나 — 상단 컴포저 vs 아래 오케 대화창(실 PTY).
 *
 * #879 가 상단을 "지속 대화창" 으로 만들면서 입력칸이 둘이 됐고, 재시연에서
 * 사장님이 곧바로 "어디에 쓰냐" 를 물으셨다. 이 규칙이 그 답이다. 화면에서
 * 눈으로 확인하려면 오케 PTY 가 붙은 실행이 필요해서, 규칙 자체를 여기서 못박는다.
 */
describe("상단 컴포저 노출 규칙", () => {
  const base = { sentCount: 0, totalTasks: 0, draft: "" };

  it("첫 마디 전에는 안내를 펼친 채 보인다 — 그때는 여기가 유일한 대화창이다", () => {
    expect(beginnerComposerMode(base)).toBe("intro");
  });

  it("첫 화면에서 타이핑 중이어도 여전히 첫 화면이다", () => {
    expect(beginnerComposerMode({ ...base, draft: "가이드 정리해 줘" })).toBe(
      "intro",
    );
  });

  it("★오케가 첫 마디를 받으면 접힌다 (아래 대화창이 이어받는다)", () => {
    expect(beginnerComposerMode({ ...base, sentCount: 1 })).toBe("hidden");
  });

  it("★재시작해도 되살아나지 않는다 — 티켓이 있으면 이미 대화가 있었다는 뜻", () => {
    // sentCount 는 세션 상태라 재시작하면 0 이다. 그것만 보면 하던 일 위에
    // "무엇을 만들까요?" 가 다시 덮인다.
    expect(beginnerComposerMode({ ...base, totalTasks: 3 })).toBe("hidden");
  });

  it("★티켓 상세가 문장을 채워 주면 다시 나타난다 — 단 첫 화면의 얼굴은 아니다", () => {
    expect(
      beginnerComposerMode({
        sentCount: 4,
        totalTasks: 9,
        draft: "가이드 초안 어떻게 돼가?",
      }),
    ).toBe("followUp");
    // 재시작 직후(세션 sentCount=0)에도 안내문·예시 칩이 다시 깔리면 안 된다.
    expect(
      beginnerComposerMode({
        sentCount: 0,
        totalTasks: 9,
        draft: "가이드 초안 어떻게 돼가?",
      }),
    ).toBe("followUp");
  });

  it("공백뿐인 문장은 프리필이 아니다", () => {
    expect(
      beginnerComposerMode({ sentCount: 1, totalTasks: 1, draft: "   " }),
    ).toBe("hidden");
  });

  it("전달에 실패해 sentCount 가 안 오른 국면에서는 계속 보인다", () => {
    // 실패는 오케가 받은 적이 없다는 뜻이라, 유저가 곧바로 다시 눌러야 한다.
    expect(beginnerComposerMode(base)).toBe("intro");
  });
});

/**
 * ★온보딩 안내 모달의 배타 — 티켓 E3ywX1ftbVr5f1TrFsgp 의 순서 결함.
 *
 * 데모("▶ 데모 보기")는 연결 **전** 화면에서 열고, M1 온램프 안내는 연결이
 * **없어서** 뜬다 — 전제가 정확히 겹쳐서, 가드가 없으면 우연히가 아니라 **항상**
 * 대본 위에 "계정을 연결하세요" 가 덮인다.
 */
describe("온보딩 안내 모달을 지금 그려도 되는가", () => {
  it("아무것도 안 떠 있으면 그린다", () => {
    expect(
      shouldRenderOnboardingGuides({ oneClickOpen: false, demoPlaying: false }),
    ).toBe(true);
  });

  it("원클릭 연결 모달 위에는 그리지 않는다(종전 계약 유지)", () => {
    expect(
      shouldRenderOnboardingGuides({ oneClickOpen: true, demoPlaying: false }),
    ).toBe(false);
  });

  it("★데모 재생 위에도 그리지 않는다 — 설명이 끝까지 가야 한다", () => {
    expect(
      shouldRenderOnboardingGuides({ oneClickOpen: false, demoPlaying: true }),
    ).toBe(false);
  });

  it("데모를 닫으면 안내는 다시 자기 판정대로 뜬다(억제일 뿐 소거가 아니다)", () => {
    expect(
      shouldRenderOnboardingGuides({ oneClickOpen: false, demoPlaying: false }),
    ).toBe(true);
  });
});
