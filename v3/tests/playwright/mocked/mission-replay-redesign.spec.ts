import { test, expect } from "../helpers/fixtures";

test.use({ marbloOptions: { mock: true } });

/**
 * Seed DONE tasks into taskStore. WorkHistoryTab's Firestore subscribe may
 * briefly overwrite with [] — callers re-seed until the aggregate showcase
 * appears (same pattern as other store-injected mocked specs).
 */
async function seedAggregateTasks(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(() => {
    type TestWindow = Window & {
      __marbloTest?: {
        stores: {
          task: {
            setState: (patch: Record<string, unknown>) => void;
          };
        };
      };
    };
    const hatch = (window as TestWindow).__marbloTest;
    if (!hatch) throw new Error("__marbloTest hatch is unavailable");
    const now = Date.now();
    const taskBase = {
      projectId: "mock-replay-project",
      contextId: null,
      description: "",
      status: "DONE",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      scope: [],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
      // Relative to "now" so the default 30d filter always includes them
      // regardless of wall-clock when the suite runs.
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
      claimedAt: new Date(now - 90 * 60 * 1000),
      updatedAt: new Date(now - 30 * 60 * 1000),
    };
    hatch.stores.task.setState({
      loading: false,
      tasks: [
        {
          ...taskBase,
          id: "ticket-hero",
          title: "집계 공유 진입 배선",
          role: "frontend",
          claimedBy: "agent-frontend",
        },
        {
          ...taskBase,
          id: "ticket-cast",
          title: "ReplayCast 시각 스트립",
          role: "frontend",
          claimedBy: "agent-ui",
          updatedAt: new Date(now - 10 * 60 * 1000),
        },
      ],
    });
  });
}

const REPLAY_DASHBOARD_FLAG_KEY = "marblo.replayDashboard.enabled";

/**
 * 리플레이 대시보드는 **기본 OFF(파킹)** 다 — daily UX 에서 뺐다. 아래 GIF 스펙은
 * 파킹된 표면이 나중에 되살아날 때를 위해 남아 있으므로, 플래그를 명시적으로 켜고
 * 리로드해서 돌린다(`lib/replayDashboardFlag`). 플래그는 렌더 시점에 읽히지만
 * 컴포넌트가 마운트 때 한 번 고정하므로, 시드만으론 부족하고 리로드가 필요하다.
 *
 * ★OFF 쪽도 "안 켠다" 가 아니라 **명시적으로 지운다**: 이 스위트는 격리 userData
 * 를 쓰지 않아 localStorage 가 실행 간에 남는다. 앞 테스트가 켜 둔 값이 뒤 테스트
 * (와 개발자 실프로필)로 새는 걸 막아야 기본값 가드가 진짜 가드가 된다.
 */
async function setReplayDashboardFlag(
  page: import("@playwright/test").Page,
  enabled: boolean,
): Promise<void> {
  await page.addInitScript(
    ([key, on]) => {
      if (on) localStorage.setItem(key as string, "1");
      else localStorage.removeItem(key as string);
    },
    [REPLAY_DASHBOARD_FLAG_KEY, enabled] as const,
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

// 파킹 플래그를 테스트 밖으로 흘리지 않는다(공유 프로필 위생).
test.afterEach(async ({ marblo }) => {
  try {
    await marblo.page.evaluate(
      (key) => localStorage.removeItem(key),
      REPLAY_DASHBOARD_FLAG_KEY,
    );
  } catch {
    /* 앱이 이미 닫혔거나 죽었으면 정리할 것도 없다 */
  }
});

async function openHistoryTab(
  page: import("@playwright/test").Page,
): Promise<void> {
  const workspaceHistoryTab = page.getByRole("tab", { name: "완료 이력" });
  if ((await workspaceHistoryTab.count()) > 0) {
    await workspaceHistoryTab.scrollIntoViewIfNeeded();
    await workspaceHistoryTab.click();
  } else {
    await page
      .getByRole("button", { name: /History|완료/ })
      .first()
      .click({ timeout: 5_000 });
  }
}

async function seedProject(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(() => {
    type TestWindow = Window & {
      __marbloTest?: {
        stores: {
          project: {
            setState: (patch: Record<string, unknown>) => void;
          };
          task: {
            setState: (patch: Record<string, unknown>) => void;
          };
        };
      };
    };
    const hatch = (window as TestWindow).__marbloTest;
    if (!hatch) throw new Error("__marbloTest hatch is unavailable");

    const project = {
      id: "mock-replay-project",
      name: "Replay Mock Project",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      enabledModels: ["claude", "gpt"],
      createdAt: new Date("2026-08-01T09:00:00Z"),
      updatedAt: new Date("2026-08-01T12:00:00Z"),
    };
    hatch.stores.project.setState({
      currentProject: project,
      projects: [project],
      projectsHydrated: true,
      loading: false,
    });
  });
}

test("@mocked Work History aggregate replay renders and generates a mission GIF", async ({
  marblo,
}) => {
  const { page } = marblo;

  // 파킹된 표면이라 플래그를 켠 뒤(→ 리로드) 스토어를 주입한다. 순서 주의:
  // 리로드는 주입한 스토어를 날린다.
  await setReplayDashboardFlag(page, true);
  await seedProject(page);
  await openHistoryTab(page);

  // Subscribe may clear injected tasks — re-seed until aggregate UI mounts.
  await expect(async () => {
    await seedAggregateTasks(page);
    await expect(page.getByTestId("work-history-replay-showcase")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  await expect(page.getByTestId("replay-accomplishment-hero")).toContainText(
    /2개 작업|2 tasks|2/,
  );
  await expect(
    page.getByRole("heading", { name: /에이전트별 기여|Cast/ }),
  ).toBeVisible();
  // 타임라인(raw ReplayTimeline)은 집계 쇼케이스에서 제거됨 — 완료 내역과 중복.
  await expect(page.getByText("티켓 ticket-hero")).toHaveCount(0);

  // ★기본 공유 경로는 미션 GIF 하나다 — 형식 탭(카드/링크)과 3단계 마법사는
  // 기본 화면에서 빠졌다(코드는 남아 있다).
  await expect(page.getByText("공유 형식")).toHaveCount(0);
  await expect(page.getByLabel("Mission Replay 공유 마법사")).toHaveCount(0);

  await page.screenshot({
    path: "test-results/mission-replay-redesign.png",
    fullPage: false,
  });

  // 집계 쇼케이스의 단일 진입점 → 미션 선택 화면.
  await page.getByTestId("work-history-open-mission-gif").click();
  await expect(page.getByTestId("mission-gif-panel")).toBeVisible();

  // missions 컬렉션이 비어 있어도 고를 게 하나는 있다(완료 작업 집계 fallback).
  const options = page.getByTestId("mission-gif-options");
  await expect(options).toBeVisible();
  await expect(options.getByRole("radio").first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // 선택된 미션의 태스크 분해 미리보기.
  await expect(page.getByTestId("mission-gif-preview")).toContainText(
    /집계 공유 진입 배선|ReplayCast/,
  );
  // 등급(L1/L2/L3) 선택·비식별 미리보기는 이 플로우에 없다.
  await expect(page.getByText("검증 통과")).toHaveCount(0);

  // ★생성물 실제 검증: 버튼 클릭 → GIF 생성 → 다운로드 버튼(blob URL 연결).
  const generateBtn = page.getByTestId("mission-gif-generate");
  await expect(generateBtn).toBeEnabled({ timeout: 10_000 });
  await generateBtn.click();
  const downloadBtn = page.getByTestId("mission-gif-download");
  await expect(downloadBtn).toBeVisible({ timeout: 30_000 });
  await expect(downloadBtn).toBeEnabled();
  // 파일명은 gif.ts buildReplayMotionFileName("mission") 규약.
  await expect(downloadBtn).toContainText(/\.gif/i);
  await expect(page.getByTestId("mission-gif-error")).toHaveCount(0);

  // Cast: auto-loop 금지 — reveal-once 또는 hover-pan 만.
  const castTrack = page.locator("[data-cast-motion]");
  if ((await castTrack.count()) > 0) {
    const motion = await castTrack.first().getAttribute("data-cast-motion");
    expect(motion === "reveal-once" || motion === "hover-pan").toBeTruthy();
  }
});

/**
 * ★기본 상태(플래그 미설정)의 계약 — 위 스펙의 반대편.
 *
 * 사장님 결정: 미션 리플레이 대시보드·PPT 식 GIF 는 daily UX 로 안 쓴다. 그래서
 * 아무 것도 안 켠 유저의 History 탭은 **평탄화 전 단순 완료내역**이어야 한다:
 * 집계 쇼케이스도, 태스크/미션 축 토글도, GIF 진입 버튼도 없다. 코드는 남아
 * 있으므로(파킹) 이 가드가 없으면 진입점이 조용히 되살아나도 아무도 모른다.
 */
test("@mocked 기본(플래그 OFF) History 는 리플레이 위젯 없이 단순 완료내역만 그린다", async ({
  marblo,
}) => {
  const { page } = marblo;

  await setReplayDashboardFlag(page, false);
  await seedProject(page);
  await openHistoryTab(page);

  // 리스트가 실제로 그려진 상태에서 단언한다 — 빈 화면에서 "없다" 는 공짜다.
  await expect(async () => {
    await seedAggregateTasks(page);
    await expect(page.getByText("집계 공유 진입 배선")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  // 리플레이 표면 전부 미노출: 집계 쇼케이스·GIF 진입점·축 토글.
  await expect(page.getByTestId("work-history-replay-showcase")).toHaveCount(0);
  await expect(page.getByTestId("work-history-open-mission-gif")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("mission-gif-panel")).toHaveCount(0);
  // 축 토글은 두 버튼이 항상 같이 뜬다 — "미션 Replay" 하나만 봐도 충분하고,
  // "태스크" 는 다른 화면 텍스트와 부딪힐 수 있어 일부러 안 건다.
  await expect(
    page.getByRole("button", { name: "미션 Replay", exact: true }),
  ).toHaveCount(0);

  // 평탄화 전 모양 — 완료내역 리스트가 그대로 남아 있다.
  await expect(page.getByText("ReplayCast 시각 스트립")).toBeVisible();

  await page.screenshot({
    path: "test-results/work-history-simple-default.png",
    fullPage: false,
  });
});
