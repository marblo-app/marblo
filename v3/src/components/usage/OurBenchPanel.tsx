import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useOurBenchStore } from "../../stores/ourBenchStore";

/**
 * 사용량 탭 **우리 자체 실측** 섹션(SWE-bench, our-measured).
 *
 * ── 이 섹션이 답하는 질문 ────────────────────────────────────────────────
 * "벤더가 뭐라고 발표했나" 가 아니라 **"우리 스폰 경로로 직접 돌리면 어떻게
 * 나오나"**. 바로 위 `ModelFactSheet` 과 이웃해 있지만 **다른 물건**이고, 그
 * 사실이 화면에서 지워지지 않는 것이 이 컴포넌트의 존재 이유다.
 *
 * ── ★벤더 공개치와 절대 같은 표에 놓지 않는다 ────────────────────────────
 * 이유는 표본 크기(N=3)가 아니라 **실행환경**이다. 공식 SWE-bench 채점은 인스턴스
 * 마다 구운 Docker 이미지 안에서 도는데 우리는 native venv 다. 같은 인스턴스라도
 * 환경이 다르면 점수가 움직이므로, 우리 숫자는 "리더보드보다 높다/낮다" 를 말할
 * 수 없다. 그 한계 문구는 취향이 아니라 데이터다 — `generated-report.md` 헤더와
 * **같은 문자열**이고(`OUR_MEASURED_DISCLAIMERS`), 아래 캡션 두 줄은 표를 접어도
 * 사라지지 않는다.
 *
 * 분리는 세 겹으로 구조화돼 있다: IPC 채널이 다르고(`models:ourBench`), 스토어가
 * 다르고, 타입이 다르다(`OurBench*` vs `ModelFact*`). 두 배열을 concat 하려면
 * 컴파일이 먼저 막는다.
 *
 * ── ★"안 보인다" 재발 방지 ───────────────────────────────────────────────
 * 이 화면의 직전 사고는 섹션이 조용히 사라지는 것이었다(빈 데이터에 `return null`,
 * 페이지가 자기 스크롤을 안 가짐 — `tests/unit/usage-page-sections-render.test.ts`).
 * 같은 실패를 두 가지로 막는다:
 *   · **제목과 한 줄 요약은 항상 렌더된다.** 데이터가 없어도, 로딩 중이어도,
 *     브리지가 없어도 섹션 자리는 남고 왜 비었는지를 글로 말한다.
 *   · 전체 표만 접이식이다. 접힘의 대상은 **세부**지 결론이 아니다.
 *
 * ── ★대조행(noop 0% / gold 100%)을 요약에 같이 싣는 이유 ─────────────────
 * "claude 100%" 만 보이는 요약은 숫자가 참이어도 **증거가 없는 주장**이다. noop 이
 * 0% 이고 gold 가 100% 라는 것이 "채점기가 헐겁지도 조이지도 않다" 의 증거이고,
 * 그 증거는 주장과 같은 줄에 있어야 같이 읽힌다.
 */
export function OurBenchPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const report = useOurBenchStore((s) => s.report);
  const status = useOurBenchStore((s) => s.status);
  const load = useOurBenchStore((s) => s.load);
  const reload = useOurBenchStore((s) => s.reload);

  // ★마운트에서 읽는다(factSheet 은 펼칠 때 읽는다). 접힌 상태에서도 한 줄 요약과
  // 대조행이 보여야 하므로, 이 왕복은 미룰 수 없는 것이다.
  useEffect(() => {
    void load();
  }, [load]);

  return (
    // 테두리 색을 위 정보표(회색)와 다르게 둔다 — "다른 출처" 라는 말을 글로만
    // 하지 않고 눈으로도 한 번 더 한다(색만으로 나르지는 않는다: 배지와 캡션이
    // 같은 사실을 글자로도 말한다).
    <section
      aria-labelledby="our-bench-title"
      className="rounded-lg border border-amber-700/40 bg-amber-500/[0.03]"
    >
      <div className="space-y-1.5 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="our-bench-title"
            className="text-sm font-medium text-gray-300"
          >
            {t("usage.ourBench.title")}
          </h2>
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
            {t("usage.ourBench.badge")}
          </span>
        </div>

        {/* ★항상 보이는 한 줄 요약. 상태에 따라 문장이 바뀔 뿐, 자리가 비지 않는다. */}
        {status === "loading" && (
          <p className="text-xs text-gray-500">{t("usage.ourBench.loading")}</p>
        )}
        {status === "error" && (
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <span>{t("usage.ourBench.error")}</span>
            <button
              type="button"
              onClick={() => void reload()}
              className="underline underline-offset-2"
            >
              {t("usage.ourBench.retry")}
            </button>
          </div>
        )}
        {status !== "loading" && status !== "error" && !report && (
          <p className="text-xs text-gray-500">{t("usage.ourBench.empty")}</p>
        )}
        {report && <SummaryLine report={report} />}

        {/* ★한계 캡션 — 접어도 사라지지 않는다. 숫자와 조건은 같이 다녀야 한다. */}
        <p className="text-[11px] leading-snug text-amber-300/70">
          {t("usage.ourBench.caption.separate")}
        </p>
        <p className="text-[11px] leading-snug text-amber-300/70">
          {t("usage.ourBench.caption.execEnv")}
        </p>

        {report && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls="our-bench-body"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 pt-0.5 text-[11px] text-gray-400 hover:text-gray-200"
          >
            <span className="text-gray-500">{open ? "▾" : "▸"}</span>
            <span>
              {open ? t("usage.ourBench.collapse") : t("usage.ourBench.expand")}
            </span>
          </button>
        )}
      </div>

      {open && report && (
        <div id="our-bench-body" className="space-y-3 px-3 pb-3">
          <CellsTable report={report} />
          <InstanceTable report={report} />
          <div className="space-y-0.5 text-[11px] leading-snug text-gray-600">
            <p>
              {t("usage.ourBench.envLine", {
                scaffold: report.meta.scaffold,
                execEnv: report.meta.execEnv,
                grader: report.meta.graderVersion,
              })}
            </p>
            <p>
              {t("usage.ourBench.runsLine", {
                runs: report.meta.totalRuns,
                generatedAt: report.meta.generatedAt,
              })}
            </p>
            <p>
              ⓘ {t("usage.ourBench.footer", { path: report.meta.reportPath })}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/** `n/a` 와 `0.0%` 를 구분한다 — 분모가 0 인 칸을 0% 로 적지 않는다. */
function fmtPct(pct: number | null): string {
  return pct === null ? "n/a" : `${pct.toFixed(1)}%`;
}

/**
 * ★한 줄 요약. 접힌 상태의 **결론**이다.
 *
 * 담는 것: 무엇을 잰 것인지(데이터셋·N) + 모델 셀들의 결과 + **대조행**. 셋 중
 * 어느 하나라도 빠지면 남은 것이 오해를 만든다 — N 이 없으면 3개짜리 표본이
 * 리더보드처럼 읽히고, 대조행이 없으면 100% 가 검증되지 않은 주장이 된다.
 */
function SummaryLine({ report }: { report: OurBenchPayload }) {
  const { t } = useTranslation();
  const floor = report.controls.find((c) => c.role === "floor");
  const ceiling = report.controls.find((c) => c.role === "ceiling");
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-gray-500">
        {t("usage.ourBench.summaryLead", {
          dataset: report.meta.dataset,
          n: report.meta.instances.length,
        })}
      </span>
      {report.measured.map((cell) => (
        <span
          key={`${cell.harness}-${cell.model ?? "default"}-${cell.effort ?? ""}`}
          className="rounded border border-gray-700 px-1.5 py-0.5 font-mono text-[11px] text-gray-200"
          title={`${cell.harness} · n=${cell.graded}`}
        >
          {t("usage.ourBench.summaryCell", {
            model: cell.model ?? t("usage.ourBench.cliDefault"),
            pct: fmtPct(cell.resolvedPct),
          })}
        </span>
      ))}
      {floor && ceiling && (
        <span
          className="font-mono text-[11px] text-amber-300/80"
          title={t("usage.ourBench.summaryControlTip")}
        >
          {t("usage.ourBench.summaryControl", {
            floor: fmtPct(floor.resolvedPct),
            ceiling: fmtPct(ceiling.resolvedPct),
          })}
        </span>
      )}
    </div>
  );
}

/** 셀별 요약 — 리포트 마크다운의 첫 표와 같은 칸. */
function CellsTable({ report }: { report: OurBenchPayload }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-medium text-gray-400">
        {t("usage.ourBench.cellsTitle")}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[11px] text-gray-500">
            <tr className="border-b border-gray-700">
              <th className="py-1.5 pr-3 font-normal">
                {t("usage.ourBench.colHarness")}
              </th>
              <th className="py-1.5 pr-3 font-normal">
                {t("usage.ourBench.colModel")}
              </th>
              <th className="py-1.5 pr-3 font-normal">
                {t("usage.ourBench.colEffort")}
              </th>
              <th className="py-1.5 pr-3 text-right font-normal">
                {t("usage.ourBench.colGraded")}
              </th>
              <th className="py-1.5 pr-3 text-right font-normal">
                {t("usage.ourBench.colResolved")}
              </th>
              <th className="py-1.5 pr-3 text-right font-normal">
                {t("usage.ourBench.colPct")}
              </th>
              <th className="py-1.5 pr-3 text-right font-normal">
                {t("usage.ourBench.colNoOutput")}
              </th>
              <th className="py-1.5 pr-3 text-right font-normal">
                {t("usage.ourBench.colErrored")}
              </th>
              <th className="py-1.5 text-right font-normal">
                {t("usage.ourBench.colAvg")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.cells.map((cell) => (
              <CellRow
                key={`${cell.harness}-${cell.model ?? "default"}-${cell.effort ?? ""}`}
                cell={cell}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 셀 한 줄. ★대조행(noop/gold)은 **지우지 않고 라벨을 붙여** 남긴다 — 이 두 줄이
 * 나머지 줄의 신뢰 근거다.
 */
function CellRow({ cell }: { cell: OurBenchCell }) {
  const { t } = useTranslation();
  const control =
    cell.harness === "noop"
      ? t("usage.ourBench.control.floor")
      : cell.harness === "gold"
        ? t("usage.ourBench.control.ceiling")
        : null;
  return (
    <tr className="border-b border-gray-800 last:border-0">
      <td className="py-1.5 pr-3">
        <span className="font-mono text-gray-200">{cell.harness}</span>
        {control && (
          <span
            className="ml-1.5 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300"
            title={t("usage.ourBench.summaryControlTip")}
          >
            {control}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-gray-200">
        {cell.model ?? (
          <span className="text-gray-500">
            {t("usage.ourBench.cliDefault")}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-gray-400">{cell.effort ?? "—"}</td>
      <td className="py-1.5 pr-3 text-right font-mono text-gray-200">
        {cell.graded}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-gray-200">
        {cell.resolved}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono font-medium text-gray-100">
        {fmtPct(cell.resolvedPct)}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-gray-400">
        {cell.noOutput}
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-gray-400">
        {cell.errored}
      </td>
      <td className="py-1.5 text-right font-mono text-gray-400">
        {cell.avgAgentSeconds === null
          ? "—"
          : t("usage.ourBench.seconds", { n: cell.avgAgentSeconds })}
      </td>
    </tr>
  );
}

/**
 * 인스턴스 × 하네스 격자. 셀별 비율만 보면 "3개 중 3개" 가 어느 문제였는지 알 수
 * 없다 — F2P/P2P 를 그대로 실어야 채점이 무엇을 봤는지가 남는다.
 */
function InstanceTable({ report }: { report: OurBenchPayload }) {
  const { t } = useTranslation();
  // 열 순서는 셀 표와 같게 고정한다(대조행이 먼저 오도록 데이터 순서를 따른다).
  const harnesses = report.cells.map((c) => c.harness);
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-medium text-gray-400">
        {t("usage.ourBench.instancesTitle")}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[11px] text-gray-500">
            <tr className="border-b border-gray-700">
              <th className="py-1.5 pr-3 font-normal">
                {t("usage.ourBench.colInstance")}
              </th>
              {harnesses.map((h) => (
                <th key={h} className="py-1.5 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.instances.map((row) => (
              <tr
                key={row.instanceId}
                className="border-b border-gray-800 align-top last:border-0"
              >
                <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-300">
                  {row.instanceId}
                </td>
                {harnesses.map((h) => {
                  const cell = row.cells.find((c) => c.harness === h);
                  return (
                    <td key={h} className="py-1.5 pr-3">
                      <GradeCell cell={cell ?? null} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ★`null`(채점 실패)과 `false`(미해결)를 다른 글자로 그린다. */
function GradeCell({ cell }: { cell: OurBenchInstanceCell | null }) {
  const { t } = useTranslation();
  if (!cell) return <span className="text-gray-600">–</span>;
  if (cell.resolved === null)
    return (
      <span className="text-amber-400">{t("usage.ourBench.notGraded")}</span>
    );
  return (
    <span className={cell.resolved ? "text-emerald-400" : "text-gray-400"}>
      {cell.resolved ? "✅" : "❌"}{" "}
      <span className="font-mono text-[10px] text-gray-500">
        {t("usage.ourBench.grade", {
          f2pPassed: cell.f2pPassed,
          f2pTotal: cell.f2pTotal,
          p2pPassed: cell.p2pPassed,
          p2pTotal: cell.p2pTotal,
        })}
      </span>
    </span>
  );
}

export default OurBenchPanel;
