import { useMemo } from "react";
import { useTranslation } from "../../lib/i18n";
import { useUiStore } from "../../stores/uiStore";
import { useByomOptions } from "../../hooks/useByomOptions";
import {
  envSwapVendorCards,
  vendorReadyCount,
} from "../../lib/vendorOnboarding";
import { VendorCard } from "../onboarding/VendorCard";

/**
 * 하네스 탭의 **"env-swap 벤더"** 섹션.
 *
 * ── 무엇이 안 보였나 ─────────────────────────────────────────────────────
 * 하네스 탭 카탈로그(`harness-manager`)는 **설치형 패키지**만 담는다 — CLI 바이너리·
 * 스킬·MCP. 그래서 GLM(zai)·MiniMax·Kimi 처럼 "우리 `claude` 바이너리를 그대로 쓰고
 * env 만 갈아끼우는" 벤더는 그 카탈로그에 행 자체가 없었고, 하네스 탭에서는 아예
 * 존재하지 않는 벤더로 보였다(설정 › API Keys 에만 있었다).
 *
 * ── ★설치가 아니라 키 등록이다 ───────────────────────────────────────────
 * 이 벤더들을 패키지 카탈로그에 끼워 넣어 "설치" 버튼을 달면 오분류다 — 설치할
 * 바이너리가 없다. 그래서 섹션을 따로 세우고, 액션도 설치가 아니라 **키 등록**
 * (설정 › API Keys 딥링크, #624)으로만 그린다. 상태 배지도 installed/not-installed 가
 * 아니라 `vendorEnvReadiness` 파생인 ready/키필요다.
 *
 * ── 목록의 출처(★하드코딩 금지) ──────────────────────────────────────────
 * 이 파일에 벤더 id·모델 id 리터럴이 하나도 없다. 목록은 `useByomOptions`
 * (= `models:quickLaneCatalog` IPC = `electron/model-registry.ts` 파생) → 분류·상태는
 * `lib/vendorOnboarding`(순수, 유닛테스트됨)가 하고, 여기서는 env-swap 갈래만 고른다.
 * 레지스트리에 `envProfile` 행이 늘면 카드가 저절로 생긴다.
 *
 * ── 재사용 ───────────────────────────────────────────────────────────────
 * 카드 자체는 시작하기 탭·②단계 BYOM 대안과 **같은 `VendorCard`**(#632)이되, 이
 * 섹션만 `density="compact"` 로 넘긴다. 이 섹션은 env-swap 벤더만 담고 바깥
 * `HarnessSetupSection` 이 "claude 하네스에 API 키만 얹어 쓰는 벤더" 라고 이미
 * 한 번 말했지만, 온보딩 쪽 두 섹션은 목록에 자체 CLI 벤더(Grok)가 섞여 있어 그
 * 문장을 카드가 직접 말해야 한다 — 같은 카드지만 필요한 밀도가 다르다. 상태
 * 판정도 같은 store(`vendorSecretsStore`)에서 오므로, 한 화면에서 "등록 상태 다시
 * 확인" 을 누르면 다른 화면도 같이 갱신된다 — 같은 벤더를 두고 두 탭이 다른 말을 할
 * 수 없다. 자체 CLI 로 붙는 Grok(cli-grok)은 여기 안 나온다: 그쪽은 설치·로그인이
 * 실제로 필요해서 기존 패키지 카탈로그 행이 맞다(분류는 이름이 아니라
 * `requiredEnvKeys` 유무가 정한다).
 */
interface EnvSwapVendorSectionProps {
  showSectionChrome?: boolean;
}

export function EnvSwapVendorSection({
  showSectionChrome = true,
}: EnvSwapVendorSectionProps = {}) {
  const { t } = useTranslation();
  const openSettingsSection = useUiStore((s) => s.openSettingsSection);
  const { options, status, reloadCatalog, recheckKeys } = useByomOptions();

  const cards = useMemo(() => envSwapVendorCards(options), [options]);
  const readyCount = vendorReadyCount(cards);

  return (
    // 위 패널들과 같은 구분선 규격. 배경은 덮지 않는다 — 카드가 `#181825` 라서
    // 같은 색을 깔면 카드 경계가 사라진다(패키지 격자도 같은 이유로 안 깐다).
    <section
      className={
        showSectionChrome ? "border-b border-[#313244] px-4 py-3" : "px-4"
      }
    >
      {showSectionChrome && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-base">🔑</span>
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              {t("harness.store.envSwap.title")}
            </h3>
            {cards.length > 0 && (
              <span className="rounded bg-[#585b70]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
                {t("harness.store.envSwap.summary", {
                  ready: readyCount,
                  total: cards.length,
                })}
              </span>
            )}
          </div>
          {/* 제목 바로 아래 한 줄이 이 섹션 머리의 전부다 — chrome 을 바깥
              `StoreSectionHeader` 가 그리는 경우와 **같은 키**를 쓴다(두 경로가
              서로 다른 말을 하면 같은 섹션이 화면마다 달라진다). */}
          <p className="mb-3 text-xs text-[#7f849c]">
            {t("harness.store.section.envSwapDesc")}
          </p>
        </>
      )}
      {!showSectionChrome && cards.length > 0 && (
        <div className="mb-3">
          <span className="rounded bg-[#585b70]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
            {t("harness.store.envSwap.summary", {
              ready: readyCount,
              total: cards.length,
            })}
          </span>
        </div>
      )}

      {status === "error" ? (
        <div className="rounded-md border border-[#f9e2af]/25 bg-[#f9e2af]/5 px-3 py-2 text-xs text-[#a6adc8]">
          <p>{t("harness.store.envSwap.loadFailed")}</p>
          <button
            type="button"
            onClick={reloadCatalog}
            className="mt-1 underline decoration-dotted hover:text-[#cdd6f4]"
          >
            {t("harness.store.envSwap.retry")}
          </button>
        </div>
      ) : cards.length === 0 ? (
        <p className="text-xs text-[#7f849c]">
          {status === "ready"
            ? t("harness.store.envSwap.empty")
            : t("harness.store.envSwap.loading")}
        </p>
      ) : (
        <>
          {/* ★"띄우는 법" 라벨은 더 이상 여기 서지 않는다. #1066 에서 카드마다
              반복되던 이 문장을 섹션으로 한 번만 올렸는데, 그러고 나니 섹션 머리가
              제목·설명·라벨 세 줄이 됐다. 라벨이 하던 일(= 아래 스니펫을 어디에
              쓰는지 말해 주기)은 문장 하나면 되므로 `envSwapDesc` 꼬리로 합쳤다
              ("…모델을 명시해서 오케에게 요청해보세요"). ★온보딩 카드가 쓰는
              `onboarding.startHere.vendors.dispatchLabel` 원문은 건드리지 않는다 —
              시작하기 탭·②단계 BYOM 은 목록에 자체 CLI 벤더가 섞여 있어 그 라벨을
              카드가 직접 말해야 하고, 여기서 문구를 갈면 거기까지 같이 바뀐다. */}
          <div className="grid gap-3 md:grid-cols-2">
            {cards.map((card) => (
              <VendorCard
                key={`${card.vendor}:${card.harness}`}
                card={card}
                onOpenKeySettings={() => openSettingsSection("apikeys")}
                onRecheckKeys={recheckKeys}
                density="compact"
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
