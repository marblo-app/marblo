/**
 * 심플 모드의 **경량 탭바** — 대화(기본) + 큐레이트 4탭(가이드·코드·사용량·설정).
 *
 * 엑스퍼트 탭바(`WorkTabs`)와 같은 역할이지만 일부러 다르게 생겼다. 그쪽은 13개가
 * 가로로 꽉 찬 작업 도구고, 이쪽은 다섯 칸짜리 **세그먼트**다: 개수가 적다는 사실이
 * 한눈에 보여야 심플 모드의 약속("고를 게 적다")이 화면에서 읽힌다. 그래서
 * 스크롤도 배지도 없고, 폭은 내용만큼만 먹는다.
 *
 * ★대화 칸은 나머지 넷과 시각적으로 한 단 위다(활성일 때 파랑, 비활성이어도 다른
 * 넷보다 밝다). 보조 진입 넷이 대화와 같은 무게로 서면 "탭이 다섯 개인 앱" 이
 * 되는데, 이 화면은 **대화 화면 + 가끔 들르는 곳 넷**이다.
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
      className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-[#313244] bg-[#181825] px-4"
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
            className={`inline-flex h-6 items-center rounded-md px-2.5 text-xs transition-colors ${
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
