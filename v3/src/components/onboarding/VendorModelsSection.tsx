import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useUiStore } from "../../stores/uiStore";
import { useByomOptions } from "../../hooks/useByomOptions";
import { vendorReadyCount } from "../../lib/vendorOnboarding";
import { VendorCard } from "./VendorCard";

/**
 * 시작하기 탭의 **"다른 벤더 모델 붙이기"** 섹션.
 *
 * ── 이 화면이 답하는 질문 ────────────────────────────────────────────────
 * "Claude/Codex 말고 다른 모델도 되나요?" — 된다. 다만 벤더마다 **첫 켤 때 해야 하는
 * 한 가지**가 다르다: 어떤 벤더는 CLI 를 깔고 브라우저로 로그인하고(Grok), 어떤
 * 벤더는 우리 claude 바이너리에 구독키만 얹는다(GLM/MiniMax/Kimi). 이 섹션은 그
 * **한 가지 액션**과 **띄우는 법 한 줄**만 보여준다 — 엔드포인트·1M 컨텍스트·검증
 * 런북 같은 상세는 중복하지 않고 `docs/VENDOR-MODEL-USAGE-GUIDE.md` 로 넘긴다.
 *
 * ── 목록의 출처 ──────────────────────────────────────────────────────────
 * 벤더도 모델도 이 파일에 리터럴이 없다. `models:quickLaneCatalog` IPC(=
 * `electron/model-registry.ts` 파생) + 기존 `cliSetupStore.ROWS` 뿐이고, 분류·상태
 * 판정은 `lib/vendorOnboarding.ts`(순수, 유닛테스트됨)가 한다. 레지스트리에 벤더
 * 행이 늘면 카드가 자동으로 생긴다.
 *
 * ── 재사용 ───────────────────────────────────────────────────────────────
 * 카드 자체는 `VendorCard`(공유), CLI 벤더의 설치/로그인 UI 는 ①②단계와 **같은
 * `CliRowCard`** 다. 목록 파생과 크레덴셜 스냅샷은 `useByomOptions` 한 곳에서
 * 오므로, 이 섹션과 ②단계의 BYOM 대안(ByomStartSection)이 같은 벤더를 두고 다른
 * 말을 할 수 없다 — 한쪽에서 "등록 상태 다시 확인" 을 누르면 양쪽이 함께 갱신된다.
 */
export function VendorModelsSection({
  /** 온보딩 4단계가 끝났나 — 끝났으면 이 섹션을 펴서 "다음 할 것" 으로 보여준다. */
  onboardingComplete,
}: {
  onboardingComplete: boolean;
}) {
  const { t } = useTranslation();
  const openSettingsSection = useUiStore((s) => s.openSettingsSection);
  const { options, status, reloadCatalog, recheckKeys } = useByomOptions();

  const [expanded, setExpanded] = useState(onboardingComplete);
  // 사용자가 직접 접거나 편 뒤에는 온보딩 완료 여부가 그 선택을 덮지 않는다.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned) setExpanded(onboardingComplete);
  }, [onboardingComplete, pinned]);

  // 레지스트리에 추가 벤더가 없으면(=오케 CLI 뿐) 섹션 자체를 그리지 않는다.
  if (status === "ready" && options.length === 0) return null;

  const readyCount = vendorReadyCount(options);

  return (
    <section className="mt-5 rounded-lg border border-[#313244] bg-[#181825]/60">
      <button
        type="button"
        onClick={() => {
          setPinned(true);
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-0.5 text-base">🔌</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[#cdd6f4]">
              {t("onboarding.startHere.vendors.title")}
            </span>
            {options.length > 0 && (
              <span className="rounded bg-[#585b70]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
                {t("onboarding.startHere.vendors.summary", {
                  ready: readyCount,
                  total: options.length,
                })}
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs text-[#7f849c]">
            {t("onboarding.startHere.vendors.subtitle")}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-xs text-[#7f849c]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[#313244] px-4 py-4">
          {status === "error" ? (
            <div className="rounded-md border border-[#f9e2af]/25 bg-[#f9e2af]/5 px-3 py-2 text-xs text-[#a6adc8]">
              <p>{t("onboarding.startHere.vendors.loadFailed")}</p>
              <button
                type="button"
                onClick={reloadCatalog}
                className="mt-1 underline decoration-dotted hover:text-[#cdd6f4]"
              >
                {t("onboarding.startHere.vendors.retry")}
              </button>
            </div>
          ) : options.length === 0 ? (
            <p className="text-xs text-[#7f849c]">
              {t("onboarding.startHere.vendors.loading")}
            </p>
          ) : (
            options.map((card) => (
              <VendorCard
                key={`${card.vendor}:${card.harness}`}
                card={card}
                onOpenKeySettings={() => openSettingsSection("apikeys")}
                onRecheckKeys={recheckKeys}
              />
            ))
          )}

          {/* 상세는 여기서 반복하지 않는다 — 가이드 문서가 단일소스다(#621). */}
          <p className="rounded-md border border-[#89b4fa]/20 bg-[#89b4fa]/5 px-3 py-2 text-xs text-[#a6adc8]">
            {t("onboarding.startHere.vendors.guideLead")}{" "}
            <code className="rounded bg-[#11111b] px-1.5 py-0.5 font-mono text-[11px] text-[#89b4fa]">
              docs/VENDOR-MODEL-USAGE-GUIDE.md
            </code>
          </p>
        </div>
      )}
    </section>
  );
}
