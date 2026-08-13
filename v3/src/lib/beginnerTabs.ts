/**
 * 심플(비기너) 모드의 **큐레이트 탭** 목록 — "무엇을 노출하는가" 를 한 곳에.
 *
 * 심플 셸은 오케 대화창 하나로 시작했는데, 그 대가로 도움말·비용·코드보기·설정
 * 처럼 모드와 무관하게 필요한 것들에 **닿을 길이 없었다**. 종전의 유일한 출구는
 * 상단바 "설정" 버튼이었고, 그것은 설정 화면을 여는 게 아니라 **어드밴스드로
 * 승격시킨 뒤** 그쪽 탭을 여는 것이었다(BeginnerShell 의 옛 주석: "막다른 버튼을
 * 만들지 않는다"). 설정 한 번 보려던 사람이 13탭짜리 화면에 떨어진다.
 *
 * 그래서 그 점프 패턴을 **일반화**한다: 승격 없이, 심플 셸 안에서, 엑스퍼트의
 * 그 탭 컴포넌트를 **그대로** 띄운다(GuideTab·CodeTab·UsagePage·SettingsPage —
 * 재구현 0). 심플 모드의 약속은 "기능이 없다" 가 아니라 "고를 게 적다" 이므로,
 * 없앨 것은 화면이 아니라 **탭의 수**다.
 *
 * ★ 큐레이트 = 일곱이다. 프로덕션 엑스퍼트 탭은 13개이고 나머지 6개
 * (startHere·board·lanes·project·history·store)는 심플에 노출하지 않는다 —
 * 보드·시작하기는 심플 셸이 인라인 미니 뷰(라이브 스트립·연결 게이트)로 이미
 * 답하고 있고, 레인·팀·기록·스토어는 승격의 이유 그 자체다.
 *
 * ★ 넷에서 일곱으로 는 이유(사장님 콜드 테스트). 처음 고른 기준은 "모드와
 * 무관하게 필요한가"(도움말·비용·내 코드·설정)였는데, 실제로 심플만 쓰면 **못
 * 하는 일**이 셋 남았다:
 *   ① 에이전트 관리 — 인라인 에이전트 패널은 "누가 뭐하나" 를 보여줄 뿐이라,
 *      잘못 뜬 에이전트를 **지울** 곳이 없었다(그건 `agents` 탭의 대시보드다).
 *   ② ★연결 — GitHub·텔레그램·슬랙 연결 UI 가 통째로 `harness` 탭 안에 있다.
 *      심플에서 그 탭이 없다는 건 심플 유저에게 연결의 **진입점이 없다**는 뜻
 *      이었고, 이 셋 중 가장 아픈 자리다(연결은 첫날 하는 일이다).
 *   ③ git — 워크트리·머지 상태를 볼 곳이 `worktrees` 탭뿐이었다.
 * 셋 다 "승격해야만 닿는다" 였는데, 승격은 13탭짜리 화면으로 떨어지는 일이라
 * 답이 될 수 없다(이 파일 위쪽 설정 버튼 이야기와 같은 실패). 심플의 약속은
 * "기능이 없다" 가 아니라 "고를 게 적다" 이므로, 닿을 수 없는 것보다 탭 셋이 는
 * 쪽이 맞다.
 *
 * ★ 바 순서는 엑스퍼트(`RIGHT_TABS`)의 상대 순서를 그대로 따른다 —
 * guide → code → agents → worktrees → usage → harness → settings. 두 셸을 오가는
 * 사람에게 같은 것이 같은 순서로 보여야 하고, 승격은 "탭이 늘어나는" 일이지
 * "재배치되는" 일이 아니어야 한다. 그래서 신규 셋은 기존 넷 **뒤에 붙이지 않고**
 * 엑스퍼트가 세운 자리에 끼워 넣는다.
 * `tests/unit/beginnerTabs.test.ts` 가 이 순서와 위 6탭 비노출을 못박는다.
 */
import type { t } from "./i18n";
import { visibleRightTabs, type RightTabId } from "./splitWorkspaceLayout";

/**
 * 기본 화면 — 오케 대화창(+라이브 스트립·에이전트 패널). 엑스퍼트 탭 id 가
 * **아니다**: 심플 셸에만 있는 워크스페이스 그 자체라서, 재사용할 컴포넌트가
 * 없다. 채팅-퍼스트를 타입으로 못박는 자리이기도 하다.
 */
export const BEGINNER_CHAT_TAB = "chat";

/** 엑스퍼트에서 그대로 빌려오는 일곱. 전부 `RightTabId` 여야 한다(재구현 금지). */
export const BEGINNER_CURATED_TABS = [
  "guide",
  "code",
  "agents",
  "worktrees",
  "usage",
  "harness",
  "settings",
] as const satisfies readonly RightTabId[];

export type BeginnerCuratedTabId = (typeof BEGINNER_CURATED_TABS)[number];
export type BeginnerTabId = typeof BEGINNER_CHAT_TAB | BeginnerCuratedTabId;

/** 탭바에 그리는 순서. 대화가 **항상 처음이자 기본**이다. */
export const BEGINNER_TABS = [
  BEGINNER_CHAT_TAB,
  ...BEGINNER_CURATED_TABS,
] as const satisfies readonly BeginnerTabId[];

/**
 * 라벨. 일곱은 엑스퍼트 탭바와 **같은 키**를 읽는다 — 같은 화면을 부르는 이름이
 * 셸마다 다르면 그건 두 개의 기능처럼 읽힌다(번역도 두 벌이 된다).
 */
export const BEGINNER_TAB_LABEL_KEY = {
  chat: "beginner.tab.chat",
  guide: "workspace.tab.guide",
  code: "workspace.tab.code",
  agents: "workspace.tab.agents",
  worktrees: "workspace.tab.worktrees",
  usage: "workspace.tab.usage",
  harness: "workspace.tab.harness",
  settings: "workspace.tab.settings",
} as const satisfies Record<BeginnerTabId, Parameters<typeof t>[0]>;

export function isBeginnerTab(v: unknown): v is BeginnerTabId {
  return (
    typeof v === "string" && (BEGINNER_TABS as readonly string[]).includes(v)
  );
}

/**
 * 심플에 **노출하지 않는** 엑스퍼트 탭들 — 큐레이트의 여집합.
 *
 * 계산해서 돌려주는 이유는 하나다: 엑스퍼트에 탭이 하나 늘 때 심플이 조용히
 * 따라 늘지 않게 하려는 것이다. 새 탭은 자동으로 이 목록(=비노출)에 들어가고,
 * 심플에 넣고 싶으면 `BEGINNER_CURATED_TABS` 를 **명시적으로** 고쳐야 한다.
 */
export function beginnerHiddenExpertTabs(devFeatures: string[]): RightTabId[] {
  const curated = new Set<string>(BEGINNER_CURATED_TABS);
  return visibleRightTabs(devFeatures).filter((tab) => !curated.has(tab));
}
