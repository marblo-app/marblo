import { useCallback, useEffect, useState } from "react";
import { useTranslation, t as translate } from "../../lib/i18n";
import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
  ConnectorGuideSteps,
} from "../harness/ConnectorGuidePanel";

/**
 * 스토어 **'로컬 모델'(Ollama)** 탭 본문 — first-party 큐레이션 카탈로그.
 *
 * 공개 레지스트리 그리드(`RegistryStoreSection` 의 항목 모집단)와 **데이터
 * 소스·IPC 채널·설치 경로를 전혀 공유하지 않는다**(§4.4 신뢰경계): 카탈로그는
 * 앱 상수, 다운로드는 ollama 공식 라이브러리, 게이트 판정(하드웨어·카탈로그
 * 화이트리스트)은 전부 메인 프로세스가 한다. 이 UI 는 판정 결과를 그릴 뿐이다.
 *
 * 정직성 원칙:
 *  - ollama 미설치면 가짜 pull 버튼 대신 설치 안내 링크(레지스트리의 "자동 설치
 *    불가" 와 같은 규율).
 *  - RAM 부족이면 버튼 비활성 + "부족(N GB 필요)" 사유를 그대로 보여준다.
 *  - 설치됨 판정은 요청 이력이 아니라 `ollama list` 실측이다 — 에이전트 추가에서
 *    고를 수 있는 것도 그 실측 목록뿐(유령비용 방지).
 *
 * `showSectionChrome` — 하네스탭(EnvSwapVendorSection 옆)에 단독 섹션으로
 * 올릴 때 true. 스토어탭(RegistryStoreSection 로컬 탭)은 부모가 이미
 * title/subtitle 을 그리므로 기본 false.
 */

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** 카탈로그 id → 한줄 설명 i18n 키(카탈로그는 first-party 상수라 전수 매핑). */
const DESC_KEYS: Record<string, string> = {
  "qwen2.5:0.5b": "harness.store.local.desc.qwen25_05b",
  "qwen2.5:1.5b": "harness.store.local.desc.qwen25_15b",
  "llama3.2:1b": "harness.store.local.desc.llama32_1b",
  "llama3.2:3b": "harness.store.local.desc.llama32_3b",
  "phi3:mini": "harness.store.local.desc.phi3_mini",
  "gemma2:2b": "harness.store.local.desc.gemma2_2b",
};

/**
 * 메모리 구간 표시 순서. **임계값은 여기 없다** — 어떤 카드가 어느 구간인지는
 * 메인 프로세스(`electron/local-models.ts` 의 `localMemoryTier`)가 정해서
 * `card.memoryTier` 로 내려준다. 렌더러가 GB 경계를 다시 계산하면 두 곳이
 * 갈라지므로, 여기서는 **순서만** 안다.
 */
const MEMORY_TIER_ORDER = ["8", "16", "32", "48plus"] as const;

/** 구간 헤더 문구 — 계산된 키 대신 리터럴 매핑이라 i18n 키 타입이 유지된다. */
const MEMORY_TIER_TITLE_KEYS = {
  "8": "harness.store.local.memoryTierTitle.8",
  "16": "harness.store.local.memoryTierTitle.16",
  "32": "harness.store.local.memoryTierTitle.32",
  "48plus": "harness.store.local.memoryTierTitle.48plus",
} as const;

/**
 * 3티어 배지 — ★`toolSupport === "tool-use"` 로 **이분하지 말 것**.
 * 이분하면 경량 티어(gemma3:27b, qwen3.8:27b)가 "대화 전용"으로 잘못 뜬다.
 * 새 티어가 생기면 이 맵에 한 줄을 더하고, switch 가 없으니 빠뜨릴 곳도 없다.
 */
const TOOL_SUPPORT_BADGE = {
  "chat-only": {
    labelKey: "harness.store.local.badgeChatOnly",
    hintKey: "harness.store.local.chatOnlyHint",
    installedHintKey: "harness.store.local.installedHintChatOnly",
    className: "bg-[#f9e2af]/20 text-[#f9e2af]",
  },
  "tool-use-lite": {
    labelKey: "harness.store.local.badgeToolUseLite",
    hintKey: "harness.store.local.toolUseLiteHint",
    installedHintKey: "harness.store.local.installedHintToolUseLite",
    className: "bg-[#94e2d5]/20 text-[#94e2d5]",
  },
  "tool-use": {
    labelKey: "harness.store.local.badgeToolUse",
    hintKey: "harness.store.local.toolUseHint",
    installedHintKey: "harness.store.local.installedHintToolUse",
    className: "bg-[#89b4fa]/20 text-[#89b4fa]",
  },
} as const;

export interface LocalModelsSectionProps {
  /** 하네스탭 단독 섹션 크롬(제목·부제). 스토어탭 임베드는 false. */
  showSectionChrome?: boolean;
}

export function formatDownloadSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

export function formatContext(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
}

/** 파라미터 규모 배지 문구. 태그에서 못 읽은 모델은 호출부가 미상으로 처리한다. */
export function formatParamBillions(billions: number): string {
  return `${billions}B`;
}

/**
 * 구간 헤더의 "실행 가능/부족" 칩 상태.
 *
 * ★임계를 다시 계산하지 않고 **카드가 이미 들고 있는 `fits`** 만 접는다. 일부만
 * 맞는 구간(예: 24GB 기기 × 32GB 구간)은 칩을 아예 달지 않는다 — 구간 단위로
 * 뭉뚱그리면 거짓말이 되고, 카드마다 붙는 배지가 이미 정확한 답을 준다.
 */
export function memoryTierFitState(
  cards: readonly LocalModelCard[],
): "all" | "none" | "mixed" {
  if (cards.every((c) => c.fits)) return "all";
  if (cards.every((c) => !c.fits)) return "none";
  return "mixed";
}

export function LocalModelsSection({
  showSectionChrome = false,
}: LocalModelsSectionProps = {}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<LocalModelsInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<Record<string, number | null>>({});
  const [notice, setNotice] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await window.electronAPI.localModels.info());
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    window.electronAPI.localModels.onPullProgress((ev) => {
      if (ev.phase === "progress") {
        setPulling((prev) => ({ ...prev, [ev.id]: ev.percent ?? null }));
      }
    });
    return () => {
      window.electronAPI.localModels.offPullProgress();
    };
  }, []);

  const runPull = useCallback(
    async (id: string) => {
      setNotice(null);
      setPulling((prev) => ({ ...prev, [id]: null }));
      try {
        const res = await window.electronAPI.localModels.pull({ id });
        if (res.success) {
          setNotice({
            kind: "info",
            text: translate("harness.store.local.pullDone", { id }),
          });
        } else if (res.cancelled) {
          setNotice({
            kind: "info",
            text: translate("harness.store.local.pullCancelled", { id }),
          });
        } else {
          setNotice({
            kind: "error",
            text: translate("harness.store.local.pullFail", {
              id,
              error: res.error ?? "unknown",
            }),
          });
        }
      } finally {
        setPulling((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // 설치됨 판정은 항상 `ollama list` 재실측으로 — 성공/실패 무관하게 갱신.
        void load();
      }
    },
    [load],
  );

  const cancelPull = useCallback(async (id: string) => {
    await window.electronAPI.localModels.cancelPull({ id });
  }, []);

  const cards = info?.cards ?? [];
  /**
   * 메모리 구간별 그룹. 카탈로그 밖 설치분은 소요 RAM 을 모르므로
   * `memoryTier === null` 이고, 여기서 자연히 빠져 별도 섹션으로 간다.
   */
  const tierGroups = MEMORY_TIER_ORDER.map((tier) => ({
    tier,
    cards: cards.filter((c) => c.memoryTier === tier),
  })).filter((g) => g.cards.length > 0);
  const outsideCatalog = cards.filter(
    (c) => c.source === "installed-outside-catalog",
  );

  const renderCard = (card: LocalModelCard) => {
    const pullingPercent = pulling[card.id];
    const isPulling = card.id in pulling;
    const descKey = DESC_KEYS[card.id];
    const badge = TOOL_SUPPORT_BADGE[card.toolSupport];
    return (
      <div
        key={card.id}
        className="rounded-md border border-[#313244] bg-[#181825] p-3 transition-colors hover:border-[#45475a]"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          {/*
            ★이름은 자르지 않는다. 종전에는 displayName 에 `truncate`,
            id 는 한 줄 안에서 밀려 `deepseek-r1:14b-qwen-distill-q4_K_M`
            같은 긴 태그가 잘려 보였다. 이름은 단어 단위로, 태그는 임의
            위치에서(`break-all`) 줄바꿈해 끝까지 보이게 한다.
          */}
          <div className="min-w-0 flex-1">
            <div className="break-words text-sm font-semibold text-[#cdd6f4]">
              {card.displayName}
            </div>
            <div className="break-all font-mono text-[10px] leading-tight text-[#6c7086]">
              {card.id}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {card.installed ? (
              <span className="rounded bg-[#a6e3a1]/20 px-1.5 py-0.5 text-[10px] text-[#a6e3a1]">
                {t("harness.store.local.installed")}
              </span>
            ) : card.fits ? (
              <span className="rounded bg-[#a6e3a1]/20 px-1.5 py-0.5 text-[10px] text-[#a6e3a1]">
                {t("harness.store.local.fits")}
              </span>
            ) : (
              <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                {t("harness.store.local.insufficientRam", {
                  gb: String(card.minRamGB),
                })}
              </span>
            )}
          </div>
        </div>

        {descKey && (
          <p className="mb-2 text-xs text-[#bac2de]">
            {t(descKey as Parameters<typeof t>[0])}
          </p>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
            {card.categoryLabel}
          </span>
          {/* ★3티어 분기 — 이분하면 경량 티어가 "대화 전용"으로 잘못 뜬다. */}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${badge.className}`}
            title={translate(badge.hintKey)}
          >
            {t(badge.labelKey)}
          </span>
          <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
            {card.paramBillions === null
              ? t("harness.store.local.paramUnknown")
              : `${t("harness.store.local.paramSize")}: ${formatParamBillions(
                  card.paramBillions,
                )}`}
          </span>
          {card.downloadSizeMB !== undefined && (
            <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
              {t("harness.store.local.downloadSize")}:{" "}
              {formatDownloadSize(card.downloadSizeMB)}
            </span>
          )}
          {card.minRamGB > 0 && (
            <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
              {t("harness.store.local.minRam")}: {card.minRamGB} GB
            </span>
          )}
          {card.contextTokens !== undefined && (
            <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
              {t("harness.store.local.context")}:{" "}
              {formatContext(card.contextTokens)}
            </span>
          )}
          {/*
            모델 원본(HuggingFace). 새 IPC 를 만들지 않는다 — main 의
            setWindowOpenHandler 가 https + target=_blank 를
            shell.openExternal 로 넘겨 OS 기본 브라우저로 연다(이 파일의
            ollama.com/download 링크와 같은 처리).
          */}
          {card.huggingFaceUrl && (
            <a
              href={card.huggingFaceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={translate("harness.store.local.huggingFaceAria", {
                name: card.displayName,
              })}
              className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#89b4fa] transition-colors hover:bg-[#45475a] hover:underline"
            >
              {t("harness.store.local.huggingFace")} ↗
            </a>
          )}
        </div>

        {isPulling ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="font-medium text-[#cdd6f4]">
                {t("harness.store.local.installing")}
              </span>
              <span className="font-mono text-[#89b4fa]">
                {pullingPercent !== null && pullingPercent !== undefined
                  ? `${pullingPercent}%`
                  : t("harness.store.local.progressPending")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-[#313244]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pullingPercent ?? undefined}
              >
                <div
                  className="h-full rounded-full bg-[#89b4fa] transition-all"
                  style={{ width: `${pullingPercent ?? 8}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => void cancelPull(card.id)}
                className="rounded bg-[#f38ba8]/20 px-2 py-0.5 text-[10px] text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/30"
              >
                {t("harness.store.local.cancel")}
              </button>
            </div>
          </div>
        ) : card.action === "installed" ? (
          <p className="text-[10px] text-[#6c7086]">
            {t(badge.installedHintKey)}
          </p>
        ) : card.action === "pull" ? (
          <button
            type="button"
            onClick={() => void runPull(card.id)}
            className="rounded bg-[#89b4fa] px-3 py-1.5 text-xs font-semibold text-[#11111b] shadow-sm shadow-[#89b4fa]/20 transition-colors hover:bg-[#b4befe] focus:outline-none focus:ring-2 focus:ring-[#89b4fa]/60 focus:ring-offset-2 focus:ring-offset-[#181825]"
          >
            {t("harness.store.local.pull")}
          </button>
        ) : (
          // insufficient-ram / ollama-missing / daemon-stopped:
          // 비활성 버튼 + 사유(가짜 활성 버튼 금지)
          <button
            type="button"
            disabled
            title={
              card.action === "insufficient-ram"
                ? translate("harness.store.local.insufficientRam", {
                    gb: String(card.minRamGB),
                  })
                : card.action === "ollama-missing"
                  ? translate("harness.store.local.ollamaMissingShort")
                  : translate("harness.store.local.daemonStoppedShort")
            }
            className="cursor-not-allowed rounded bg-[#313244] px-2.5 py-1 text-xs text-[#6c7086] opacity-60"
          >
            {t("harness.store.local.pull")}
          </button>
        )}
      </div>
    );
  };

  const body = (
    <div>
      {/* Ollama 설치→pull→스폰 가이드 (Slack #939 ConnectorGuidePanel 패턴) */}
      <div className="mb-3">
        <ConnectorGuidePanel
          toggleLabel={t("harness.store.local.guide.toggle")}
        >
          <ConnectorGuideSteps>
            <ConnectorGuideStep>
              1. {t("harness.store.local.guide.step1Before")}
              <a
                href={OLLAMA_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#89b4fa] hover:underline"
              >
                ollama.com/download
              </a>
              {t("harness.store.local.guide.step1After")}
            </ConnectorGuideStep>
            <ConnectorGuideStep>
              2. {t("harness.store.local.guide.step2")}
            </ConnectorGuideStep>
            <ConnectorGuideStep>
              3. {t("harness.store.local.guide.step3")}
            </ConnectorGuideStep>
          </ConnectorGuideSteps>
          <div className="rounded border border-[#313244] bg-[#181825] px-3 py-2">
            <p className="mb-1 text-xs font-medium text-[#cdd6f4]">
              {t("harness.store.local.guideTitle")}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#a6adc8]">
              <li>{t("harness.store.local.guideRam")}</li>
              <li>{t("harness.store.local.guideQuant")}</li>
              <li>{t("harness.store.local.guideContext")}</li>
              <li>{t("harness.store.local.guideToolUse")}</li>
            </ul>
          </div>
        </ConnectorGuidePanel>
      </div>

      {/* 이 기기 실측 — 게이트가 무엇을 기준으로 판정했는지 그대로 공시 */}
      {info && (
        <p className="mb-3 text-xs text-[#7f849c]">
          {t("harness.store.local.hardwareLine", {
            gb: String(info.hardware.totalMemGB),
          })}
          {info.hardware.unifiedMemory
            ? ` · ${t("harness.store.local.unifiedMemoryNote")}`
            : ""}
          {info.ollama.installed && info.ollama.version
            ? ` · Ollama v${info.ollama.version}`
            : ""}
        </p>
      )}

      {notice && (
        <div
          className={`mb-3 rounded border px-3 py-2 text-xs ${
            notice.kind === "error"
              ? "border-[#f38ba8]/30 bg-[#f38ba8]/10 text-[#f38ba8]"
              : "border-[#a6e3a1]/30 bg-[#a6e3a1]/10 text-[#a6e3a1]"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* ollama 미설치/데몬 정지 — 가짜 버튼 대신 정직한 안내 */}
      {info && !info.ollama.installed && (
        <div className="mb-3 rounded border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-3 py-2 text-xs text-[#f9e2af]">
          {t("harness.store.local.ollamaMissing")}{" "}
          <a
            href={OLLAMA_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline"
          >
            {t("harness.store.local.ollamaInstallLink")}
          </a>
        </div>
      )}
      {info && info.ollama.installed && !info.ollama.daemonRunning && (
        <div className="mb-3 rounded border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-3 py-2 text-xs text-[#f9e2af]">
          {t("harness.store.local.daemonStopped")}
        </div>
      )}

      {loading && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.local.loading")}
        </p>
      )}
      {!loading && !info && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.local.loadFail")}
        </p>
      )}

      {/* 메모리 구간별 섹션 — 사용자가 "내 기기에서 뭐가 도나"를 먼저 본다. */}
      {tierGroups.map(({ tier, cards: tierCards }) => {
        const fitState = memoryTierFitState(tierCards);
        return (
          <section key={tier} className="mb-4 last:mb-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold text-[#cdd6f4]">
                {t(MEMORY_TIER_TITLE_KEYS[tier])}
              </h4>
              <span className="text-[10px] text-[#6c7086]">
                {t("harness.store.local.memoryTierCount", {
                  count: String(tierCards.length),
                })}
              </span>
              {fitState === "all" && (
                <span className="rounded bg-[#a6e3a1]/20 px-1.5 py-0.5 text-[10px] text-[#a6e3a1]">
                  {t("harness.store.local.memoryTierRunnable")}
                </span>
              )}
              {fitState === "none" && (
                <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                  {t("harness.store.local.memoryTierTooBig")}
                </span>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {tierCards.map(renderCard)}
            </div>
          </section>
        );
      })}

      {/* ★카탈로그 밖 설치분 — 큐레이션 정리가 "쓰던 모델이 사라짐"이 되지 않게. */}
      {outsideCatalog.length > 0 && (
        <section className="mt-4 border-t border-[#313244] pt-3">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold text-[#cdd6f4]">
              {t("harness.store.local.outsideCatalogTitle")}
            </h4>
            <span className="text-[10px] text-[#6c7086]">
              {t("harness.store.local.memoryTierCount", {
                count: String(outsideCatalog.length),
              })}
            </span>
          </div>
          <p className="mb-2 text-[11px] text-[#7f849c]">
            {t("harness.store.local.outsideCatalogNote")}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {outsideCatalog.map(renderCard)}
          </div>
        </section>
      )}
    </div>
  );

  if (!showSectionChrome) return body;

  return (
    <section className="border-b border-[#313244] px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-base">🖥️</span>
        <h3 className="text-sm font-semibold text-[#cdd6f4]">
          {t("harness.store.local.title")}
        </h3>
      </div>
      <p className="mb-3 text-xs text-[#7f849c]">
        {t("harness.store.local.subtitle")}
      </p>
      {body}
    </section>
  );
}
