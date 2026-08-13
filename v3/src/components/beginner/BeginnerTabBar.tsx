/**
 * 심플 모드의 **경량 탭바** — 대화(기본) + 큐레이트 7탭(가이드·코드·에이전트·
 * 워크트리·사용량·하네스·설정).
 *
 * 엑스퍼트 탭바(`WorkTabs`)와 같은 역할이지만 일부러 다르게 생겼다. 그쪽은 13개가
 * 가로로 꽉 찬 작업 도구고, 이쪽은 여덟 칸짜리 **세그먼트**다: 개수가 적다는 사실이
 * 한눈에 보여야 심플 모드의 약속("고를 게 적다")이 화면에서 읽힌다. 그래서
 * 배지가 없고, 폭은 내용만큼만 먹는다.
 *
 * ★대화 칸은 나머지와 시각적으로 한 단 위다(활성일 때 파랑, 비활성이어도 다른
 * 칸보다 밝다). 보조 진입들이 대화와 같은 무게로 서면 "탭이 여덟 개인 앱" 이
 * 되는데, 이 화면은 **대화 화면 + 가끔 들르는 곳 일곱**이다.
 *
 * ★가로 스크롤은 넷에서 일곱으로 늘 때 들어왔다. 다섯 칸일 땐 어떤 창에서도
 * 다 들어왔지만, 여덟 칸은 좁은 창(≈600px 이하)에서 넘친다 — 그때 `overflow`
 * 가 없으면 flex 가 마지막 칸부터 잘라 버린다. 설정·하네스가 창 폭 때문에
 * 사라지는 건 이 티켓이 없애려던 바로 그 증상이라, 넘치면 잘리는 대신 스크롤
 * 한다(칸은 `shrink-0` — 글자가 찌그러지느니 스크롤이 낫다).
 *
 * 색·높이는 상단바와 같은 토큰을 쓴다(`beginnerUi`). 헤더 바로 아래 붙는 줄이라
 * 팔레트가 어긋나면 두 개의 헤더처럼 보인다.
 */
import { useTranslation } from "../../lib/i18n";
import {
  BEGINNER_CHAT_TAB,
  BEGINNER_TABS,
  BEGINNER_TAB_LABEL_KEY,
  type BeginnerTabId,
} from "../../lib/beginnerTabs";

export function BeginnerTabBar({
  active,
  onSelect,
}: {
  active: BeginnerTabId;
  onSelect: (tab: BeginnerTabId) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="tablist"
      aria-label={t("beginner.tabs.label")}
      data-testid="beginner-tabbar"
      className="flex h-9 flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-[#313244] bg-[#181825] px-4"
    >
      {BEGINNER_TABS.map((tab) => {
        const isActive = tab === active;
        const isChat = tab === BEGINNER_CHAT_TAB;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`beginner-tab-${tab}`}
            onClick={() => onSelect(tab)}
            className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-xs transition-colors ${
              isActive
                ? "bg-[#89b4fa]/15 font-medium text-[#89b4fa]"
                : isChat
                  ? "text-[#a6adc8] hover:bg-[#313244]/60 hover:text-[#cdd6f4]"
                  : "text-[#6c7086] hover:bg-[#313244]/60 hover:text-[#cdd6f4]"
            }`}
          >
            {t(BEGINNER_TAB_LABEL_KEY[tab])}
          </button>
        );
      })}
    </div>
  );
}
