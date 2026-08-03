/**
 * FirstMissionShareNudge — 순수 뷰(`FirstMissionShareNudgeView`) 렌더 테스트.
 *
 * 핀하는 계약:
 *   - `mission` 이 없으면 아무것도 그리지 않는다(리스트가 비었거나, 이미
 *     닫았거나, 첫 미션이 아닌 모든 경우가 이 한 갈래로 접힌다 — 컨테이너 책임).
 *   - `mission` 이 있으면 카피·CTA·닫기 버튼이 모두 뜬다.
 *
 * `renderToStaticMarkup` 을 쓰는 이유는 `mission-replay-view.test.ts` 와 같다:
 * 이 컴포넌트가 하는 일(상태 분기 → 문자열 선택 → 마크업)은 DOM 없이 전부
 * 도달 가능하고, 스위트는 node 환경에서 돈다.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";

/**
 * `hooks/useMissionReplay` → `services/missionReplayService` → `lib/firebase` 는
 * 모듈 로드 시점에 `initializeAuth` 를 부른다 — VITE_FIREBASE_* 없이는 import 만
 * 으로 죽는다(`mission-replay-view.test.ts` 와 같은 이유). 여기서 렌더하는 것은
 * 상태를 받아 마크업을 내는 순수 뷰라 실제 배선은 한 번도 호출되지 않는다.
 */
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));
vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));
import { renderToStaticMarkup } from "react-dom/server";

import { FirstMissionShareNudgeView } from "../../src/components/work-history/FirstMissionShareNudge";
import type { TFunction } from "../../src/lib/i18n";
import type { Mission } from "../../src/types/mission";
import { ko } from "../../src/locales/ko";

const T0 = new Date("2026-08-01T09:00:00Z");

/** ko 테이블을 직접 읽는다 — 카피가 아니라 "어떤 상태에 어떤 문구가 붙는가" 를 고정한다. */
const t: TFunction = (key, vars) => {
  const raw = ko[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
};

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    projectId: "proj-1",
    goal: "첫 미션",
    templateId: "feature",
    status: "completed",
    ownerOrchestratorSessionId: "sess-1",
    steps: [],
    currentStepIndex: 0,
    taskIds: ["task-a"],
    contextLog: [],
    launchedAt: T0,
    lastActivityAt: T0,
    completedAt: T0,
    ...overrides,
  };
}

function render(mission: Mission | null) {
  return renderToStaticMarkup(
    createElement(FirstMissionShareNudgeView, {
      mission,
      onOpenReplay: () => {},
      onDismiss: () => {},
      t,
    }),
  );
}

describe("FirstMissionShareNudgeView", () => {
  it("renders nothing when there is no mission to nudge about", () => {
    expect(render(null)).toBe("");
  });

  it("renders the nudge copy, CTA, and dismiss control for a first mission", () => {
    const html = render(makeMission());

    expect(html).toContain(ko["workHistory.firstMissionNudge.message"]);
    expect(html).toContain(ko["workHistory.firstMissionNudge.cta"]);
    expect(html).toContain(ko["workHistory.firstMissionNudge.dismiss"]);
    // 강요하지 않는 톤: 버튼 2개(열기/닫기)만 있고 모달/오버레이가 아니다.
    expect(html).toContain('role="status"');
  });
});
