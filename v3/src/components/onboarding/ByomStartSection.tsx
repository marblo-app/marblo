import { useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { useUiStore } from "../../stores/uiStore";
import { useByomOptions } from "../../hooks/useByomOptions";
import { byomHeadline, byomReadyCount } from "../../lib/byomOnboarding";
import { VendorCard } from "./VendorCard";

/**
 * ②단계(인증)의 **"BYOM 으로 시작하기"** 대안 — 활성화 F4(#633 클린룸 E2E).
 *
 * ── 무엇이 막혀 있었나 ───────────────────────────────────────────────────
 * ②단계는 "Claude 또는 Codex 계정 연결" 하나만 길로 제시했다. 그 두 계정이 **둘 다
 * 없는** 사용자 — 해외·BYOM 유입의 기본형 — 는 여기서 영구히 멈춘다. 정작 앱은
 * 그 사이 GLM/MiniMax/Kimi(구독키만 등록) 와 Grok(자체 CLI) 을 지원하게 됐는데,
 * 첫 실행 화면엔 그 길이 아예 없어서 "이 앱은 Claude 전용" 으로 읽히고 끝났다.
 *
 * ── 이 섹션이 하는 일(재구현 0) ──────────────────────────────────────────
 * 새 UI 를 만들지 않는다. 이미 착지한 두 자산을 ②단계에서 **닿게** 할 뿐이다:
 *   - #624 `VendorKeysSettings` — 키 등록 화면(딥링크 + 등록 상태 다시 확인)
 *   - #632 벤더 카드/분류      — 같은 `VendorCard`, 같은 레지스트리 파생 목록
 * 목록·상태 파생은 `useByomOptions`(→ `lib/byomOnboarding`, 순수)에 있고 이 파일엔
 * 벤더 id·모델 id 리터럴이 하나도 없다.
 *
 * ── ★정직한 통과 조건 ────────────────────────────────────────────────────
 * ③④단계(폴더 연결 → 첫 티켓)는 전부 **오케스트레이터**를 거친다. 그래서 이 대안이
 * ②단계를 대신 만족시키는 것은 "오케를 태울 수 있는 BYOM 경로가 실제로 준비됐을
 * 때" 뿐이다(`byomGateContribution`). 아직 워커(디스패치) 전용인 벤더는 그 사실을
 * 카드 밑에 그대로 적는다 — 화면만 넘겨놓고 ④단계에서 다시 막히게 두지 않는다.
 * 어느 벤더가 오케 후보인지는 우리 취향이 아니라 오케 셀렉터가 세우는 칸 목록에서
 * 파생되므로, 메인 프로세스가 후보를 넓히면 이 화면은 저절로 따라간다.
 */
export function ByomStartSection() {
  const { t } = useTranslation();
  const openSettingsSection = useUiStore((s) => s.openSettingsSection);
  const { options, status, reloadCatalog, recheckKeys } = useByomOptions();
  const [expanded, setExpanded] = useState(false);

  // 붙일 수 있는 벤더가 레지스트리에 하나도 없으면 그리지 않는다(빈 안내는 소음).
  if (status === "ready" && options.length === 0) return null;

  const headline = byomHeadline(options);
  const readyCount = byomReadyCount(options);

  return (
    <section
      data-testid="start-here-byom-section"
      className="rounded-lg border border-[#89b4fa]/30 bg-[#89b4fa]/5"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-0.5 text-base">🔑</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[#cdd6f4]">
              {t("onboarding.byom.title")}
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
          {/* 지금 이 사용자에게 해당하는 한 줄만 — 상태에 따라 갈린다. */}
          <span className="mt-1 block text-xs text-[#a6adc8]">
            {t(`onboarding.byom.headline.${headline}` as MessageKey)}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-xs text-[#7f849c]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[#89b4fa]/20 px-4 py-4">
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
            options.map((option) => (
              <VendorCard
                key={`${option.vendor}:${option.harness}`}
                card={option}
                onOpenKeySettings={() => openSettingsSection("apikeys")}
                onRecheckKeys={recheckKeys}
                footNote={
                  option.canHostOrchestrator ? (
                    <p className="mt-2 text-[11px] text-[#a6e3a1]">
                      {t("onboarding.byom.canHostOrchestrator")}
                    </p>
                  ) : (
                    // ★이 줄이 이 화면의 정직성이다. 이 벤더로는 ②단계를 넘겨도
                    //   ④단계(첫 티켓)에서 다시 막힌다 — 그걸 여기서 미리 말한다.
                    <p className="mt-2 rounded-md border border-[#f9e2af]/25 bg-[#f9e2af]/5 px-2.5 py-1.5 text-[11px] text-[#a6adc8]">
                      {t("onboarding.byom.workerOnlyNote")}
                    </p>
                  )
                }
              />
            ))
          )}

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
