import { useTranslation } from "../../lib/i18n";
import { RegistryStoreSection } from "../harness/RegistryStoreSection";

/**
 * 워크스페이스 최상위 **스토어** 탭 — 공개 레지스트리(marblo-app/marblo)에서
 * 가져온 자산 카탈로그.
 *
 * 이 화면은 Harness 탭 안의 한 섹션이었다. 성격이 달랐던 게 문제다: Harness 는
 * 이 앱을 쓰려면 **반드시** 해야 하는 연결(CLI 로그인·env-swap 벤더 키)이고,
 * 스토어는 **골라 담는** 카탈로그다. 필수 셋업 아래로 스크롤해야 나오는 카탈로그는
 * 아무도 안 열어봐서, 탭으로 꺼내 Harness 바로 앞에 세웠다.
 *
 * 타입 필터를 주지 않는다 = 레지스트리의 전 타입(현재 skill·mcp-server)을 다
 * 노출한다. 섹션이 타입별로 스스로 묶어 보여준다.
 *
 * ★ 설치 게이트는 여기서 만들지 않는다 — `RegistryStoreSection` 이 tier 와 설치
 * 계약(`item.install`)으로 판정한다. community 는 목록·공시만이고 설치 버튼이
 * 붙지 않는다(§6.3). 이 탭은 그 판정을 우회하는 어떤 prop 도 주지 않는다.
 */
export function StoreTab() {
  const { t } = useTranslation();

  return (
    <div className="h-full w-full bg-[#181825] p-4">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-[#313244] bg-[#1e1e2e]">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#313244] px-4 py-3">
          <span className="text-base">🛍️</span>
          <h2 className="text-sm font-semibold text-[#cdd6f4]">
            {t("store.tab.title")}
          </h2>
          <span className="text-xs text-[#6c7086]">
            {t("store.tab.subtitle")}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <RegistryStoreSection />
        </div>
      </div>
    </div>
  );
}
