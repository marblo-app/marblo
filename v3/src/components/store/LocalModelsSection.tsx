import { useCallback, useEffect, useState } from "react";
import { useTranslation, t as translate } from "../../lib/i18n";

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

export function formatDownloadSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

export function formatContext(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
}

export function LocalModelsSection() {
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

  return (
    <div>
      {/* 메모리·양자화·컨텍스트 가이드 — 게이트 판정 기준을 먼저 공시한다 */}
      <div className="mb-3 rounded-md border border-[#313244] bg-[#181825] p-3">
        <p className="mb-1 text-xs font-semibold text-[#cdd6f4]">
          {t("harness.store.local.guideTitle")}
        </p>
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#a6adc8]">
          <li>{t("harness.store.local.guideRam")}</li>
          <li>{t("harness.store.local.guideQuant")}</li>
          <li>{t("harness.store.local.guideContext")}</li>
        </ul>
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

      <div className="grid gap-3 md:grid-cols-2">
        {(info?.cards ?? []).map((card) => {
          const pullingPercent = pulling[card.id];
          const isPulling = card.id in pulling;
          const descKey = DESC_KEYS[card.id];
          return (
            <div
              key={card.id}
              className="rounded-md border border-[#313244] bg-[#181825] p-3 transition-colors hover:border-[#45475a]"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-[#cdd6f4]">
                    {card.displayName}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[10px] text-[#6c7086]">
                    {card.id}
                  </span>
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
                  {t("harness.store.local.downloadSize")}:{" "}
                  {formatDownloadSize(card.downloadSizeMB)}
                </span>
                <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
                  {t("harness.store.local.minRam")}: {card.minRamGB} GB
                </span>
                <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
                  {t("harness.store.local.context")}:{" "}
                  {formatContext(card.contextTokens)}
                </span>
              </div>

              {isPulling ? (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-[#313244]">
                    <div
                      className="h-full rounded bg-[#89b4fa] transition-all"
                      style={{ width: `${pullingPercent ?? 0}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-[10px] text-[#a6adc8]">
                    {pullingPercent !== null && pullingPercent !== undefined
                      ? `${pullingPercent}%`
                      : "…"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void cancelPull(card.id)}
                    className="rounded bg-[#f38ba8]/20 px-2 py-0.5 text-[10px] text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/30"
                  >
                    {t("harness.store.local.cancel")}
                  </button>
                </div>
              ) : card.action === "installed" ? (
                <p className="text-[10px] text-[#6c7086]">
                  {t("harness.store.local.installedHint")}
                </p>
              ) : card.action === "pull" ? (
                <button
                  type="button"
                  onClick={() => void runPull(card.id)}
                  className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30"
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
        })}
      </div>
    </div>
  );
}
