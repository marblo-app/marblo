/**
 * 심플 모드 큐레이트 탭 목록의 계약 — "무엇을 노출하고, 무엇을 노출하지 않는가".
 *
 * 이 목록은 제품 결정 그 자체다(사장님 결정 = 큐레이트 서브셋). 그런데 목록이
 * 그냥 배열이라, 엑스퍼트에 탭이 하나 늘거나 누가 "이것도 있으면 편하지" 로 한
 * 줄 더 넣으면 **아무 데서도 안 걸린다** — 심플 모드는 조용히 다시 13탭이 된다.
 * 그래서 개수·순서·여집합을 여기서 못박는다.
 */
import { describe, expect, it } from "vitest";
import {
  BEGINNER_CHAT_TAB,
  BEGINNER_CURATED_TABS,
  BEGINNER_TABS,
  BEGINNER_TAB_LABEL_KEY,
  beginnerHiddenExpertTabs,
  beginnerTabForJump,
  isBeginnerTab,
} from "../../src/lib/beginnerTabs";
import {
  RIGHT_TABS,
  visibleRightTabs,
} from "../../src/lib/splitWorkspaceLayout";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

describe("심플 큐레이트 탭 — 노출 목록", () => {
  it("★큐레이트는 여덟이다 — 시작하기·가이드·코드·에이전트·워크트리·사용량·하네스·설정", () => {
    expect([...BEGINNER_CURATED_TABS]).toEqual([
      "startHere",
      "guide",
      "code",
      "agents",
      "worktrees",
      "usage",
      "harness",
      "settings",
    ]);
  });

  it("★연결·에이전트관리·git 이 심플에서 닿는다 (사장님 콜드 테스트의 셋)", () => {
    // 이 셋이 빠지면 심플 유저는 GitHub/텔레그램/슬랙을 **연결할 수 없고**,
    // 잘못 뜬 에이전트를 지울 수 없고, 워크트리를 볼 수 없다. 승격 말고는 길이
    // 없던 자리라, 한 줄 지우면 조용히 그 상태로 돌아간다.
    for (const tab of ["harness", "agents", "worktrees"]) {
      expect(BEGINNER_CURATED_TABS as readonly string[]).toContain(tab);
    }
  });

  it("★대화가 항상 처음이자 기본이다 (채팅-퍼스트)", () => {
    expect(BEGINNER_TABS[0]).toBe(BEGINNER_CHAT_TAB);
    expect(BEGINNER_TABS).toHaveLength(BEGINNER_CURATED_TABS.length + 1);
  });

  it("바 순서는 엑스퍼트의 상대 순서를 따른다 — 승격은 재배치가 아니다", () => {
    const expertOrder = RIGHT_TABS.filter((tab) =>
      (BEGINNER_CURATED_TABS as readonly string[]).includes(tab),
    );
    expect(expertOrder).toEqual([...BEGINNER_CURATED_TABS]);
  });

  it("큐레이트는 전부 실재하는 엑스퍼트 탭이다 (재구현 금지)", () => {
    for (const tab of BEGINNER_CURATED_TABS) {
      expect(RIGHT_TABS).toContain(tab);
    }
  });

  it("★엑스퍼트 나머지 5탭은 심플에 노출되지 않는다", () => {
    // 프로덕션 기준(dev 전용 missions/flows/deploy 는 애초에 안 뜬다).
    const hidden = beginnerHiddenExpertTabs([]);
    expect(hidden).toEqual([
      "board",
      "lanes",
      "project",
      "history",
      "store",
    ]);
    expect(visibleRightTabs([])).toHaveLength(
      hidden.length + BEGINNER_CURATED_TABS.length,
    );
  });

  it("dev 전용 탭이 켜져도 심플에는 안 샌다", () => {
    const hidden = beginnerHiddenExpertTabs(["missions", "flows", "deploy"]);
    for (const devTab of ["missions", "flows", "deploy"]) {
      expect(hidden).toContain(devTab);
      expect(BEGINNER_CURATED_TABS as readonly string[]).not.toContain(devTab);
    }
  });

  it("isBeginnerTab 은 엑스퍼트 전용 id 를 거른다", () => {
    expect(isBeginnerTab("chat")).toBe(true);
    expect(isBeginnerTab("settings")).toBe(true);
    expect(isBeginnerTab("harness")).toBe(true);
    expect(isBeginnerTab("board")).toBe(false);
    expect(isBeginnerTab("lanes")).toBe(false);
    expect(isBeginnerTab(undefined)).toBe(false);
  });
});

describe("심플 셸의 탭 간 점프 소비", () => {
  it("★코드 점프는 코드 탭으로 받는다 — 미니 보드의 '바뀐 코드 보기' 가 여기로 온다", () => {
    // viewWorktree 는 파일 트리·에이전트 포커스·diff 를 다 바꿔 놓고 마지막에
    // requestJump({type:"code"}) 를 남긴다. 심플 셸이 이걸 안 받으면 화면만
    // 대화 탭에 그대로 서 있다(눌렀는데 아무 일도 안 일어나는 그 자리).
    expect(beginnerTabForJump({ type: "code" })).toBe("code");
  });

  it("★심플에 없는 목적지는 null 이지 '비슷한 탭' 이 아니다", () => {
    // 코드 탭으로 대충 받아 주면 유저는 방금 있던 화면에 그대로 서 있으면서
    // "눌렀더니 아무것도 안 바뀐다" 를 겪는다 — 조용한 오배송이 진짜 no-op 보다
    // 나쁘다. 이 목적지들은 심플에 그 탭이 생길 때 함께 열린다.
    expect(beginnerTabForJump({ type: "worktrees" })).toBeNull();
    expect(beginnerTabForJump({ type: "task", id: "t1" })).toBeNull();
    expect(beginnerTabForJump({ type: "agent", id: "a1" })).toBeNull();
    expect(beginnerTabForJump(null)).toBeNull();
  });

  it("돌려주는 값은 언제나 실재하는 심플 탭이다", () => {
    const target = beginnerTabForJump({ type: "code" });
    expect(target && isBeginnerTab(target)).toBe(true);
  });
});

describe("심플 큐레이트 탭 — 라벨", () => {
  it("모든 탭에 ko/en 라벨이 실재한다", () => {
    for (const tab of BEGINNER_TABS) {
      const key = BEGINNER_TAB_LABEL_KEY[tab];
      expect(ko[key], `ko: ${key}`).toBeTruthy();
      expect(en[key], `en: ${key}`).toBeTruthy();
    }
  });

  it("★일곱은 엑스퍼트 탭바와 **같은** 키를 읽는다 — 이름이 셸마다 다르면 안 된다", () => {
    for (const tab of BEGINNER_CURATED_TABS) {
      expect(BEGINNER_TAB_LABEL_KEY[tab]).toBe(`workspace.tab.${tab}`);
    }
  });
});
