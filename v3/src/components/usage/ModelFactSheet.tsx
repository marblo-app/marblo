import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useModelFactSheetStore } from "../../stores/modelFactSheetStore";
import { vendorColor } from "../../lib/usageBreakdown";
import {
  benchmarkLabel,
  formatContextTokens,
  formatRate,
  shortHarness,
} from "../../lib/modelFactFormat";

/**
 * 사용량 탭 상단 **모델 정보표** — 기본 접힘.
 *
 * ── 이 표가 답하는 질문 ──────────────────────────────────────────────────
 * "지금 우리가 고를 수 있는 모델이 각각 얼마이고(토큰 단가), 대충 어느 급이며
 * (SWE-bench), 컨텍스트 창이 얼마나 되나". 사용량 화면의 나머지는 **우리가 쓴
 * 실적**이고, 이 표만 **모델 자체의 사실**이라 성격이 다르다. 그래서 기본 접힘
 * 이다 — 이 탭에 온 사람의 1차 질문은 "얼마 썼나" 지 "단가가 얼마지" 가 아니다.
 *
 * ── 단일소스 ────────────────────────────────────────────────────────────
 * 세 칸의 출처가 전부 메인 프로세스에 있다(`models:factSheet` IPC):
 *   · 단가        — `electron/model-registry.ts` 의 `pricing` **그대로**. 렌더러엔
 *                   숫자 리터럴이 하나도 없다. 레지스트리에 모델이 늘면 표에 줄이
 *                   자동으로 는다.
 *   · SWE-bench   — `electron/model-bench-reference.ts`(1차 출처 URL + 관측일 +
 *                   스캐폴드까지 붙은 행). 없는 칸은 "확인 필요" 로 비운다.
 *   · 컨텍스트    — `electron/model-context-reference.ts`(벤더 공식문서 크롤).
 *
 * ── ★"개략" 을 화면이 반드시 말해야 하는 이유 ───────────────────────────
 * SWE-bench 는 문제집합이 다른 4종(Verified/Pro/Multilingual/Multimodal)이고,
 * 같은 모델·같은 벤치라도 스캐폴드가 다르면 6~13pt 움직인다. 그래서 각 점수 옆에
 * **벤치 이름과 하네스**를 같이 적고, 같은 벤치의 다른 하네스 점수가 있으면 그것도
 * 함께 보인다(haiku 4.5: 벤더 73.3 vs 공식 리더보드 66.6). 열을 세로로 훑어 순위를
 * 매기지 말라는 경고를 표 안에 박아 두는 셈이다.
 */

export function ModelFactSheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rows = useModelFactSheetStore((s) => s.rows);
  const status = useModelFactSheetStore((s) => s.status);
  const load = useModelFactSheetStore((s) => s.load);
  const reload = useModelFactSheetStore((s) => s.reload);

  // 펼칠 때 처음 한 번만 읽는다. 접혀 있는 동안은 IPC 왕복이 없다.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="model-fact-sheet-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs text-gray-500">{open ? "▾" : "▸"}</span>
        <span className="text-sm font-medium text-gray-300">
          {t("usage.factSheet.title")}
        </span>
        <span className="text-[11px] text-gray-500">
          {t("usage.factSheet.hint")}
        </span>
      </button>

      {open && (
        <div id="model-fact-sheet-body" className="space-y-2 px-3 pb-3">
          {status === "loading" && (
            <p className="text-xs text-gray-500">
              {t("usage.factSheet.loading")}
            </p>
          )}

          {status === "error" && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <span>{t("usage.factSheet.error")}</span>
              <button
                type="button"
                onClick={() => void reload()}
                className="underline underline-offset-2"
              >
                {t("usage.factSheet.retry")}
              </button>
            </div>
          )}

          {status === "ready" && rows.length === 0 && (
            <p className="text-xs text-gray-500">
              {t("usage.factSheet.empty")}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="text-[11px] text-gray-500">
                    <tr className="border-b border-gray-700">
                      <th className="py-1.5 pr-3 font-normal">
                        {t("usage.factSheet.colModel")}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-normal">
                        {t("usage.factSheet.colInput")}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-normal">
                        {t("usage.factSheet.colOutput")}
                      </th>
                      <th className="py-1.5 pr-3 font-normal">
                        {t("usage.factSheet.colBench")}
                      </th>
                      <th className="py-1.5 font-normal">
                        {t("usage.factSheet.colContext")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <FactRow key={row.modelId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] leading-snug text-gray-600">
                ⓘ {t("usage.factSheet.footer")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FactRow({ row }: { row: ModelFactRow }) {
  const { t } = useTranslation();
  const showId = row.label !== row.modelId;
  return (
    <tr className="border-b border-gray-800 align-top last:border-0">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: vendorColor(row.vendor) }}
            aria-hidden
          />
          <span className="font-medium text-gray-200">{row.label}</span>
          <span className="text-[10px] text-gray-500">{row.vendorLabel}</span>
        </div>
        {showId && (
          <div className="mt-0.5 font-mono text-[10px] text-gray-500">
            {row.modelId}
          </div>
        )}
      </td>

      <td className="py-2 pr-3 text-right font-mono text-gray-200">
        {formatRate(row.inputPer1M)}
        {row.estimatedPricing && <EstimatedBadge />}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-gray-200">
        {formatRate(row.outputPer1M)}
      </td>

      <td className="py-2 pr-3">
        <BenchCell row={row} />
      </td>

      <td className="py-2">
        {row.context?.tokens != null ? (
          <>
            <span
              className="font-mono text-gray-200"
              title={row.context.note ?? undefined}
            >
              {formatContextTokens(row.context.tokens)}
            </span>
            {row.context.maxOutputTokens !== undefined && (
              <div className="text-[10px] text-gray-500">
                {t("usage.factSheet.maxOutput", {
                  n: formatContextTokens(row.context.maxOutputTokens),
                })}
              </div>
            )}
            <SourceLink source={row.context.source} asOf={row.context.asOf} />
          </>
        ) : (
          <Unknown note={row.context?.note} />
        )}
      </td>
    </tr>
  );
}

/** 단가가 벤더 공식 리스트가 아니라 보수적 상한일 때. */
function EstimatedBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] font-normal text-amber-400"
      title={t("usage.factSheet.estimatedTip")}
    >
      {t("usage.factSheet.estimated")}
    </span>
  );
}

function BenchCell({ row }: { row: ModelFactRow }) {
  const { t } = useTranslation();
  const bench = row.bench;
  if (!bench) return <Unknown note={t("usage.factSheet.benchNoRow")} />;
  if (bench.score === null) return <Unknown note={bench.note} />;

  const name = benchmarkLabel(bench.benchmark);
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-gray-200">
          {bench.score.toFixed(1)}%
        </span>
        <span className="text-[10px] text-gray-400">{name}</span>
      </div>
      <div
        className="text-[10px] text-gray-500"
        title={`${bench.harness}${bench.note ? ` — ${bench.note}` : ""}`}
      >
        {shortHarness(bench.harness)}
      </div>
      {/* ★같은 벤치의 다른 측정. 하네스가 다를 수도(haiku: 벤더 vs 리더보드),
          하네스는 같은데 발표가 다를 수도 있다(gpt-5.5 를 OpenAI 가 두 번
          발표했고 값이 다르다). 그래서 라벨에 하네스와 **일자**를 같이 적는다 —
          "다른 하네스" 라고만 쓰면 후자를 거짓으로 설명하게 된다. */}
      {row.benchAlternates.map((alt) => (
        <div
          key={`${alt.harness}-${alt.source}-${alt.asOf}`}
          className="text-[10px] text-amber-400/80"
          title={`${t("usage.factSheet.altMeasureTip")}${
            alt.note ? `\n\n${alt.note}` : ""
          }`}
        >
          {t("usage.factSheet.altMeasure", {
            harness: shortHarness(alt.harness),
            date: alt.asOf,
            score: alt.score === null ? "—" : alt.score.toFixed(1),
          })}
        </div>
      ))}
      <SourceLink source={bench.source} asOf={bench.asOf} />
    </div>
  );
}

/**
 * 값이 없는 칸. ★공백이나 0 으로 두지 않는다 — "확인 필요" 라고 적어야 "아직
 * 못 찾았다" 와 "0 이다" 가 구분된다. `note` 가 있으면 왜 비었는지를 툴팁으로.
 */
function Unknown({ note }: { note?: string }) {
  const { t } = useTranslation();
  return (
    <span className="text-[11px] text-gray-500" title={note ?? undefined}>
      {t("usage.factSheet.unknown")}
    </span>
  );
}

/** 1차 출처 링크 + 관측일. 표의 모든 숫자는 출처를 떼고 다니지 않는다. */
function SourceLink({ source, asOf }: { source: string; asOf: string }) {
  return (
    <button
      type="button"
      // main 의 setWindowOpenHandler 가 외부 https 를 shell.openExternal 로
      // 넘긴다(새 IPC 없음) — VendorCreditsPanel 과 같은 경로.
      onClick={() => window.open(source, "_blank", "noopener")}
      className="mt-0.5 block max-w-[200px] truncate text-left text-[10px] text-blue-400/80 underline-offset-2 hover:underline"
      title={source}
    >
      {asOf} ↗
    </button>
  );
}

export default ModelFactSheet;
