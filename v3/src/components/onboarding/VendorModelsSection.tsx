import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  ORCHESTRATOR_CLI_IDS,
  ROWS,
  useCliSetupStore,
} from "../../stores/cliSetupStore";
import { useQuickLaneModelStore } from "../../stores/quickLaneModelStore";
import { useUiStore } from "../../stores/uiStore";
import {
  additionalVendorCards,
  vendorReadyCount,
  vendorSetupCards,
  type VendorSetupCard,
  type VendorSecretsLike,
} from "../../lib/vendorOnboarding";
import { CliRowCard, CommandBox } from "./CliSetupRows";

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
 * CLI 벤더(Grok)의 설치/로그인 UI 는 ①②단계와 **같은 `CliRowCard`** 다. 새로 만들면
 * 두 화면이 같은 CLI 를 두고 다른 말을 하게 된다.
 */
export function VendorModelsSection({
  /** 온보딩 4단계가 끝났나 — 끝났으면 이 섹션을 펴서 "다음 할 것" 으로 보여준다. */
  onboardingComplete,
}: {
  onboardingComplete: boolean;
}) {
  const { t } = useTranslation();

  const groups = useQuickLaneModelStore((s) => s.groups);
  const status = useQuickLaneModelStore((s) => s.status);
  const reload = useQuickLaneModelStore((s) => s.reload);
  const cliStates = useCliSetupStore((s) => s.states);
  const openSettingsSection = useUiStore((s) => s.openSettingsSection);

  const [secrets, setSecrets] = useState<VendorSecretsLike | null>(null);
  const [expanded, setExpanded] = useState(onboardingComplete);
  // 사용자가 직접 접거나 편 뒤에는 온보딩 완료 여부가 그 선택을 덮지 않는다.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned) setExpanded(onboardingComplete);
  }, [onboardingComplete, pinned]);

  useEffect(() => {
    void useQuickLaneModelStore.getState().load();
  }, []);

  /**
   * 벤더 크레덴셜 스냅샷 — **값이 아니라 키 이름과 존재 여부**만 온다. 카탈로그의
   * `available` 은 `process.env` 만 보므로, 설정 화면(키체인)에 넣은 키를 반영하려면
   * 이 스냅샷이 필요하다. 실패는 조용히 삼킨다(그때는 카탈로그 판정으로 떨어진다).
   */
  const loadSecrets = useCallback(async () => {
    const api = window.electronAPI?.settings;
    if (!api?.getVendorSecrets) return;
    try {
      setSecrets(await api.getVendorSecrets());
    } catch {
      setSecrets(null);
    }
  }, []);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  const cards = useMemo(
    () =>
      additionalVendorCards(
        vendorSetupCards(groups, {
          cliRows: ROWS,
          orchestratorRowIds: ORCHESTRATOR_CLI_IDS,
          cliStates,
          vendorSecrets: secrets,
        }),
      ),
    [groups, cliStates, secrets],
  );

  // 레지스트리에 추가 벤더가 없으면(=오케 CLI 뿐) 섹션 자체를 그리지 않는다.
  if (status === "ready" && cards.length === 0) return null;

  const readyCount = vendorReadyCount(cards);

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
            {cards.length > 0 && (
              <span className="rounded bg-[#585b70]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
                {t("onboarding.startHere.vendors.summary", {
                  ready: readyCount,
                  total: cards.length,
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
                onClick={() => void reload()}
                className="mt-1 underline decoration-dotted hover:text-[#cdd6f4]"
              >
                {t("onboarding.startHere.vendors.retry")}
              </button>
            </div>
          ) : cards.length === 0 ? (
            <p className="text-xs text-[#7f849c]">
              {t("onboarding.startHere.vendors.loading")}
            </p>
          ) : (
            cards.map((card) => (
              <VendorCard
                key={`${card.vendor}:${card.harness}`}
                card={card}
                onOpenKeySettings={() => openSettingsSection("apikeys")}
                onRecheckKeys={() => void loadSecrets()}
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

/** 카드 상자 — `CliRowCard` 와 같은 테두리·배경이라 두 종류가 한 줄로 읽힌다. */
const VENDOR_CARD_BOX = "rounded-lg border border-[#313244] bg-[#181825] p-4";
/** CLI 벤더의 dispatch 상자(행 카드 아래에 붙는 짝) — 세로만 조금 낮다. */
const VENDOR_SUB_BOX =
  "rounded-lg border border-[#313244] bg-[#181825] px-4 py-3";

const STATUS_STYLE: Record<VendorSetupCard["status"], string> = {
  ready: "bg-[#a6e3a1]/15 text-[#a6e3a1]",
  needsKey: "bg-[#f9e2af]/15 text-[#f9e2af]",
  needsInstall: "bg-[#f38ba8]/15 text-[#f38ba8]",
  needsLogin: "bg-[#f9e2af]/15 text-[#f9e2af]",
  unknown: "bg-[#585b70]/30 text-[#a6adc8]",
};

function VendorCard({
  card,
  onOpenKeySettings,
  onRecheckKeys,
}: {
  card: VendorSetupCard;
  onOpenKeySettings: () => void;
  onRecheckKeys: () => void;
}) {
  const { t } = useTranslation();
  // dispatch 예시에 넣을 모델. 기본값은 최상위 등급 모델이고, 아래 칩으로 이 벤더의
  // 다른 모델 id 를 눌러 예시를 바꿀 수 있다(= 어떤 id 가 유효한지 보여준다).
  const [model, setModel] = useState(card.exampleModelId);
  const row = ROWS.find((r) => r.id === card.cliRowId);
  const state = useCliSetupStore((s) =>
    card.cliRowId ? s.states[card.cliRowId] : undefined,
  );

  const isEnvSwap = card.kind === "envSwap";

  return (
    // CLI 벤더는 `CliRowCard` 가 이미 자기 카드(테두리·이름·상태·액션)를 그린다 —
    // 바깥에 또 카드를 두르면 이름과 상태가 2cm 안에서 두 번 반복된다. 그래서
    // env-swap 벤더에만 카드를 두르고, CLI 벤더는 행 카드 자체를 머리로 쓴다.
    <div className={isEnvSwap ? VENDOR_CARD_BOX : "space-y-2"}>
      {isEnvSwap && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm font-medium text-[#cdd6f4]">
              {card.label}
            </span>
            <p className="mt-0.5 text-xs text-[#7f849c]">
              {t("onboarding.startHere.vendors.kind.envSwap", {
                command: card.command,
              })}
            </p>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[card.status]}`}
          >
            {t(
              `onboarding.startHere.vendors.status.${card.status}` as MessageKey,
            )}
          </span>
        </div>
      )}

      {/* ── 첫 켰을 때 해야 하는 한 가지 ──────────────────────────────── */}
      {isEnvSwap ? (
        <div className="mt-3">
          {card.status === "ready" ? (
            <p className="text-xs text-[#a6e3a1]">
              ✓ {t("onboarding.startHere.vendors.key.ready")}
            </p>
          ) : (
            <>
              <p className="text-xs text-[#a6adc8]">
                {t("onboarding.startHere.vendors.key.hint", {
                  keys: (card.missingEnvKeys.length > 0
                    ? card.missingEnvKeys
                    : card.requiredEnvKeys
                  ).join(", "),
                })}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenKeySettings}
                  className="rounded-md bg-[#89b4fa] px-3 py-1.5 text-xs font-medium text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
                >
                  {t("onboarding.startHere.vendors.key.cta")}
                </button>
                <button
                  type="button"
                  onClick={onRecheckKeys}
                  className="rounded-md border border-[#45475a] px-2.5 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
                >
                  {t("onboarding.startHere.vendors.key.recheck")}
                </button>
              </div>
            </>
          )}
        </div>
      ) : row ? (
        // ①②단계와 **같은** 행 UI(재구현 0) — 설치 전이면 설치 버튼, 설치됐으면
        // 브라우저 로그인 버튼. 상태 배지도 저쪽과 같은 프로브에서 나온다.
        <CliRowCard row={row} phase={state?.installed ? "auth" : "install"} />
      ) : null}

      {/* ── 띄우는 법 한 줄(dispatch 지정 예시) ───────────────────────── */}
      <div className={isEnvSwap ? "mt-3" : VENDOR_SUB_BOX}>
        <p className="text-xs font-medium text-[#a6adc8]">
          {t("onboarding.startHere.vendors.dispatchLabel")}
        </p>
        {card.modelIds.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {card.modelIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setModel(id)}
                className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                  id === model
                    ? "border-[#89b4fa] bg-[#89b4fa]/15 text-[#cdd6f4]"
                    : "border-[#45475a] text-[#a6adc8] hover:bg-[#313244]"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
        <CommandBox
          cmd={t("onboarding.startHere.vendors.dispatchSnippet", { model })}
        />
      </div>
    </div>
  );
}
