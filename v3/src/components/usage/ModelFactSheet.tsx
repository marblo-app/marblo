import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useModelFactSheetStore } from "../../stores/modelFactSheetStore";
import { vendorColor } from "../../lib/usageBreakdown";
import {
  formatContextTokens,
  formatRate,
  shortHarness,
} from "../../lib/modelFactFormat";
import { groupModelsByTier, type ModelTier } from "../../lib/modelTier";
import {
  KST_OFFSET_MINUTES,
  deepseekPeakWindowsLabel,
  isDeepSeekPeak,
} from "../../lib/deepseekOffPeak";

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
 *
 * ── ★★기준(변형) 고정 — 이 화면이 실제로 낸 사고와 그 수리 ─────────────
 * 위 경고문만으로는 부족했다. 예전 이 표의 벤치 열은 **행마다 자가 달랐다**:
 * 모델별로 "점수가 있는 첫 변형" 을 골랐기 때문에 Claude 칸엔 Verified 96 이,
 * GPT-5.6 칸엔 Pro 64.6 이 들어갔다. 두 숫자는 문제집합이 다른 별개 시험의 결과라
 * 뺄셈이 성립하지 않는데, 세로로 붙어 있으면 사람은 32pt 차를 능력차로 읽는다.
 * 실제로 사장님이 그렇게 읽었고, 그게 이 수리의 출발점이다.
 *
 * 수리는 경고를 더 크게 쓰는 쪽이 아니라 **구조를 바꾸는 쪽**이다:
 *   · 변형이 이제 **열의 속성**이다. 한 번에 한 변형만 그리고, 그 변형에 값이 없는
 *     모델은 낮은 점수가 아니라 빈칸("확인 필요")이 된다.
 *   · 기본 변형은 하드코딩이 아니라 **커버리지에서 파생**된다(메인 프로세스의
 *     `benchVariantCoverage`). 지금 데이터에선 Pro 가 12/19 로 1위라 기본이 되고,
 *     같은 Pro 축에서 opus-5 79.2 vs gpt-5.6-sol 64.6 이 되어 오독이 사라진다.
 *     ★수치는 하나도 안 건드렸다 — 자를 통일했을 뿐이다.
 *   · 왜 Verified 로 통일하지 않았나: OpenAI 가 Verified 를 공개하지 않고
 *     swebench.com 공식 리더보드에도 gpt-5.5/5.6 제출이 없다(2026-07-28 실측).
 *     Verified 를 고르면 gpt 열 전체가 "확인 필요" 로 빈다 — 고를 수는 있지만
 *     기본값으로 두면 표가 절반 비어 보인다.
 *
 * ── 필터 한 줄 ──────────────────────────────────────────────────────────
 * 기준(변형)과 티어는 표를 좁힌다. 둘 다 표 위의 한 줄에 모아 둔다.
 *
 * ── ★막대차트를 걷어낸 이유 (티켓 kEMh5HGDGggponXrsgby) ─────────────────
 * 한동안 이 표 위에 "Price vs performance at a glance" 막대차트가 있었다(단가 패널
 * + SWE-bench 패널). 그 차트의 입력은 **바로 아래 표와 같은 세 칸**(input/output
 * 단가, 선택 변형 점수)이었다 — 같은 사실을 두 번 그린 셈이라, 화면이 길어진 만큼
 * 아래의 "우리가 실제로 얼마 썼나" 섹션들이 밀려났다(사장님 리포트).
 *
 * 표를 남기고 차트를 지운 이유: 이 표의 값은 **조건을 달고 다녀야 하는 숫자**다.
 * 벤치 점수는 스캐폴드·변형·관측일이 붙어야 뜻이 서고, 단가엔 "추정" 배지가 붙는다.
 * 표는 그 조건들을 같은 칸에 담을 수 있지만 막대는 길이 하나로 접어 버린다. 잃은 건
 * "눈으로 정렬" 하나이고, 그건 티어 묶음(프리미어·일반작업·가성비)이 이미 대신한다.
 * 출처 링크·관측일·대체 측정치는 표에 그대로 있다 — 정보는 하나도 안 줄었다.
 *
 * ── ★티어 묶음(프리미어 · 일반작업 · 가성비) ────────────────────────────
 * 위의 세 칸은 정확하지만, 19줄을 훑어 "그래서 뭘 고르나" 를 사용자가 직접 계산해야
 * 했다. 그 한 단계를 `lib/modelTier.ts` 가 대신 밟는다 — **여기에 모델 목록이 없다**.
 * 티어는 행이 들고 온 사실(capability + 벤치/단가 비)에서 파생되므로 레지스트리에
 * 모델이 늘면 새 줄이 알아서 제 묶음에 들어간다. 파생 규칙과 그 한계는 그 파일에
 * 적혀 있고, 화면은 묶음 헤더의 툴팁으로 같은 말을 사용자에게도 한다.
 */

export function ModelFactSheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tierFilter, setTierFilter] = useState<ModelTier | "all">("all");
  // null = "아직 안 골랐다" → 메인이 커버리지로 파생한 기본 축을 따른다. 사용자가
  // 한 번 고르면 그 선택이 이긴다(응답이 다시 와도 덮어쓰지 않는다).
  const [pickedVariant, setPickedVariant] = useState<BenchmarkVariantId | null>(
    null,
  );
  const rows = useModelFactSheetStore((s) => s.rows);
  const variants = useModelFactSheetStore((s) => s.variants);
  const defaultBenchmark = useModelFactSheetStore((s) => s.defaultBenchmark);
  const status = useModelFactSheetStore((s) => s.status);
  const load = useModelFactSheetStore((s) => s.load);
  const reload = useModelFactSheetStore((s) => s.reload);

  // 고른 변형이 응답에 없으면(레지스트리 변화로 사라진 축) 기본으로 되돌린다 —
  // 없는 축을 들고 있으면 표 전체가 조용히 "확인 필요" 로 빈다.
  const activeVariant =
    variants.find((v) => v.benchmark === pickedVariant) ??
    variants.find((v) => v.benchmark === defaultBenchmark) ??
    variants[0] ??
    null;
  const benchmark = activeVariant?.benchmark ?? null;

  // ★묶기는 **항상 전체 행**으로 한다. 필터는 그 결과에서 보여줄 묶음만 고른다 —
  // 필터링한 뒤에 묶으면 기준(단가 중앙값)이 같이 좁아져 같은 모델이 필터를 바꿀
  // 때마다 다른 티어로 보인다.
  //
  // ★티어에 먹이는 벤치는 **선택된 변형이 아니라 행의 대표 벤치**
  // (`representativeBench`, 메인이 `pickBenchRecords` 로 뽑아 내려준다)다.
  //
  // 티어는 모델 고유 속성이다 — 사용자가 위의 벤치 탭을 Verified ↔ Pro 로 토글했다고
  // 같은 모델이 가성비였다가 아니었다가 하면 그건 모델이 아니라 화면 상태에 대한
  // 말이 된다. 선택된 변형을 먹이면 그 변형에 점수가 없는 행은 근거가 통째로 사라져
  // (valueRatio=null) 오케가 `get_model_guidance` 로 듣는 판정과도 갈라진다.
  // 대표는 그 두 경로가 공유하는 한 벌이라 화면과 오케가 같은 티어를 말한다.
  //
  // 표의 **셀**은 여전히 선택된 변형만 그린다(benchByVariant) — 그 규율은
  // 그대로다. 여기서만 자를 하나로 고정할 뿐이다.
  const tierFacts = useMemo(
    () =>
      rows.map((row) => ({
        row,
        capability: row.capability,
        outputPer1M: row.outputPer1M,
        bench: row.representativeBench ?? null,
      })),
    [rows],
  );
  const groups = useMemo(() => groupModelsByTier(tierFacts), [tierFacts]);
  const visibleGroups =
    tierFilter === "all" ? groups : groups.filter((g) => g.tier === tierFilter);

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

          {rows.length > 0 && benchmark && activeVariant && (
            <>
              {/* ★필터 한 줄 — 기준(변형)과 티어가 표를 좁힌다. */}
              <div className="space-y-1.5">
                <VariantFilter
                  variants={variants}
                  selected={benchmark}
                  onSelect={setPickedVariant}
                />
                <TierFilter
                  groups={groups}
                  selected={tierFilter}
                  total={rows.length}
                  onSelect={setTierFilter}
                />
              </div>

              {/* ★'기준' 안내 한 줄 — 이 열의 자가 무엇인지, 왜 하나로 고정했는지. */}
              <p className="text-[11px] leading-snug text-amber-300/70">
                ⓘ{" "}
                {t("usage.factSheet.basisNote", {
                  variant: activeVariant.label,
                  n: activeVariant.scoredModels,
                  total: activeVariant.totalModels,
                })}
              </p>

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
                      {/* ★열 제목이 변형을 이름으로 말한다 — 이 열이 무슨 자인지
                          헤더만 봐도 알아야 한다. */}
                      <th
                        className="py-1.5 pr-3 font-normal"
                        title={activeVariant.blurb}
                      >
                        {t("usage.factSheet.colBenchVariant", {
                          variant: activeVariant.label,
                        })}
                      </th>
                      <th className="py-1.5 font-normal">
                        {t("usage.factSheet.colContext")}
                      </th>
                    </tr>
                  </thead>
                  {/* 묶음마다 tbody 를 따로 둔다 — 헤더 줄이 그 묶음에 속한다는
                      것이 마크업으로도 참이어야 스크린리더가 같이 읽는다. */}
                  {visibleGroups.map((group) => (
                    <tbody key={group.tier}>
                      <TierHeaderRow
                        tier={group.tier}
                        count={group.rows.length}
                      />
                      {group.rows.map((assignment) => (
                        <FactRow
                          key={assignment.row.row.modelId}
                          row={assignment.row.row}
                          benchmark={benchmark}
                          variant={activeVariant}
                        />
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
              {/* ★DeepSeek 행이 **지금 보일 때만** 그린다 — 티어 필터로 그 행이
                  빠지면 이 줄도 같이 빠진다. 다른 벤더 행 밑에 이 문구가 서면
                  "내 모델도 시간대 할인이 있나" 로 읽혀서 거짓이 된다. */}
              {visibleGroups.some((g) =>
                g.rows.some((a) => a.row.row.vendor === "deepseek"),
              ) && <DeepSeekOffPeakNote />}
              <p className="text-[11px] leading-snug text-gray-600">
                ⓘ {t("usage.factSheet.footer")}
              </p>
              <p className="text-[11px] leading-snug text-gray-600">
                ⓘ {t("usage.factSheet.tierFooter")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * **DeepSeek off-peak 안내 한 줄** — 모델 정보표 바로 아래.
 *
 * ── 무엇을 말하고, 무엇을 말하지 않나 ──────────────────────────────────────
 * 말하는 것: peak 구간(UTC·KST 양쪽)과 "그 외 시간은 단가 절반".
 * 말하지 않는 것: **표의 단가는 한 글자도 안 바꾼다.** 표시값은 계속 peak 정가다
 * (과소보고 방지 — 레지스트리 DeepSeek 블록 주석). off-peak 는 "실제 청구는 이보다
 * 낮을 수 있다" 는 보조 설명이지 단가의 대체값이 아니다. 두 정책이 충돌하는 것처럼
 * 보이지만 방향이 하나다: **화면이 실제보다 싸게 보이는 경우를 만들지 않는다.**
 *
 * ── ★KST 를 같이 적는 이유(ko 한정) ───────────────────────────────────────
 * 벤더 고시가 UTC 라 UTC 를 지우면 출처 대조가 안 되고, UTC 만 적으면 사용자가 볼
 * 때마다 +9 를 암산해야 한다. 그래서 **한국어 문구는** 둘 다 적되 **KST 는 UTC
 * 에서 파생**한다(`deepseekPeakWindowsLabel`) — 손으로 두 벌 적으면 한쪽만
 * 고쳐지는 날이 온다.
 *
 * ★en 문구는 **UTC 만** 적는다(사장님 지시). 영어 독자는 KST 에 살지 않아
 * 남의 지역시계가 한 줄 더 붙는 셈이고, UTC 는 벤더가 고시한 축 그대로다.
 * 지우는 건 **표시뿐**이다: `kst` 는 여기서 계속 넘기고(en 템플릿이 그 자리를
 * 안 쓸 뿐이다 — `i18n.format` 은 안 쓰인 변수를 조용히 무시한다), 아래 실시간
 * 배지의 판정 축도 변함없이 UTC 하나다. 두 로케일이 **같은 UTC 구간**을 뜻한다는
 * 사실은 `tests/unit/deepseek-off-peak.test.ts` 가 못박는다.
 *
 * ── ★실시간 배지를 다는 조건 ──────────────────────────────────────────────
 * 틀린 실시간 배지는 정확한 정적 문구보다 나쁘다(없는 할인을 약속하게 된다).
 * 그래서 판정을 컴포넌트 안에서 즉석 계산하지 않고 순수 함수로 떼어
 * (`lib/deepseekOffPeak.isDeepSeekPeak`) 경계 6개를 테스트로 못박은 뒤에만 단다.
 * 판정 축은 UTC 하나뿐이라 기기 타임존·서머타임이 결과에 끼어들지 않는다.
 *
 * ★1분마다 다시 계산한다. 사용량 탭을 열어둔 채 경계를 넘으면 배지가 조용히
 * 거짓이 되는데, 그 상태가 바로 "틀린 실시간 배지" 다. 타이머는 이 줄이 화면에
 * 있는 동안만 돈다(표가 접혀 있으면 이 컴포넌트 자체가 마운트되지 않는다).
 */
function DeepSeekOffPeakNote() {
  const { t } = useTranslation();
  const [peak, setPeak] = useState(() => isDeepSeekPeak(new Date()));

  useEffect(() => {
    const tick = () => setPeak(isDeepSeekPeak(new Date()));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="text-[11px] leading-snug text-gray-500">
      ⓘ{" "}
      <span
        className={`mr-1 rounded px-1 py-0.5 text-[10px] ${
          peak
            ? "bg-gray-500/15 text-gray-400"
            : "bg-emerald-500/15 text-emerald-300"
        }`}
      >
        {t(
          peak
            ? "usage.factSheet.deepseekNowPeak"
            : "usage.factSheet.deepseekNowOffPeak",
        )}
      </span>
      {t("usage.factSheet.deepseekOffPeak", {
        utc: deepseekPeakWindowsLabel(0),
        kst: deepseekPeakWindowsLabel(KST_OFFSET_MINUTES),
      })}
    </p>
  );
}

/**
 * 티어 배색. 묶음 헤더·필터 칩이 같은 색을 쓰므로 한 군데서만 정의한다.
 * ★색만으로 뜻을 나르지 않는다 — 라벨 글자가 항상 함께 있다(색각 이상 대응).
 */
const TIER_STYLE: Readonly<Record<ModelTier, { dot: string; text: string }>> = {
  premier: { dot: "bg-violet-400", text: "text-violet-300" },
  standard: { dot: "bg-sky-400", text: "text-sky-300" },
  value: { dot: "bg-emerald-400", text: "text-emerald-300" },
};

/**
 * 티어 라벨/설명 i18n 키. 템플릿 문자열로 조립하지 않고 리터럴로 적는다 —
 * `t()` 의 키 타입이 유니온이라, 조립하면 오탈자를 타입체커가 못 잡는다.
 */
const TIER_LABEL_KEY = {
  premier: "usage.factSheet.tier.premier",
  standard: "usage.factSheet.tier.standard",
  value: "usage.factSheet.tier.value",
} as const;

const TIER_DESC_KEY = {
  premier: "usage.factSheet.tier.premierDesc",
  standard: "usage.factSheet.tier.standardDesc",
  value: "usage.factSheet.tier.valueDesc",
} as const;

/**
 * ★**기준(변형) 선택기.** 이 화면에서 가장 중요한 컨트롤이다 — 벤치 열과 차트
 * 축이 무엇을 재는 자인지가 여기서 정해진다.
 *
 * 라디오 그룹인 이유(체크박스가 아니라): 여러 변형을 **동시에** 켜는 순간 이
 * 티켓이 고친 버그가 그대로 돌아온다. 한 번에 하나만 고를 수 있다는 사실 자체가
 * "서로 다른 변형을 나란히 두지 않는다" 는 규칙의 구현이다.
 *
 * 칩마다 `n/total` 커버리지를 적는 이유: Verified 를 고르면 표의 절반이 비는데,
 * 고르기 **전에** 그걸 알 수 있어야 사용자가 "이 앱이 고장났나" 대신 "OpenAI 가
 * 이 수치를 안 낸다" 로 읽는다.
 */
function VariantFilter({
  variants,
  selected,
  onSelect,
}: {
  variants: ModelFactVariant[];
  selected: BenchmarkVariantId;
  onSelect: (v: BenchmarkVariantId) => void;
}) {
  const { t } = useTranslation();
  if (variants.length <= 1) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="radiogroup"
      aria-label={t("usage.factSheet.basisLabel")}
    >
      <span className="text-[11px] text-gray-500">
        {t("usage.factSheet.basisLabel")}
      </span>
      {variants.map((v) => {
        const active = v.benchmark === selected;
        return (
          <button
            key={v.benchmark}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(v.benchmark)}
            title={`${v.blurb}\n\n${t("usage.factSheet.basisTip")}`}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
              active
                ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
                : "border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
          >
            <span>{v.short}</span>
            <span className="tabular-nums text-gray-500">
              {v.scoredModels}/{v.totalModels}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 티어 필터 칩. 표를 좁혀 보는 용도지, 티어 판정을 바꾸지는 않는다(판정은 늘
 * 전체 묶음 기준). 선택 상태는 `aria-pressed` 로도 나른다.
 */
function TierFilter({
  groups,
  selected,
  total,
  onSelect,
}: {
  groups: { tier: ModelTier; rows: unknown[] }[];
  selected: ModelTier | "all";
  total: number;
  onSelect: (tier: ModelTier | "all") => void;
}) {
  const { t } = useTranslation();
  const chip = (key: ModelTier | "all", label: string, count: number) => {
    const active = selected === key;
    const style = key === "all" ? null : TIER_STYLE[key];
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(key)}
        title={key === "all" ? undefined : t(TIER_DESC_KEY[key])}
        className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
          active
            ? "border-gray-500 bg-gray-700/60 text-gray-100"
            : "border-gray-700 text-gray-400 hover:text-gray-200"
        }`}
      >
        {style && (
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`}
            aria-hidden
          />
        )}
        <span>{label}</span>
        <span className="text-gray-500">{count}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {chip("all", t("usage.factSheet.tier.all"), total)}
      {groups.map((g) =>
        chip(g.tier, t(TIER_LABEL_KEY[g.tier]), g.rows.length),
      )}
    </div>
  );
}

/** 묶음 헤더 줄. 라벨 + 개수 + 한 줄 설명(툴팁엔 파생 규칙 전문). */
function TierHeaderRow({ tier, count }: { tier: ModelTier; count: number }) {
  const { t } = useTranslation();
  const style = TIER_STYLE[tier];
  return (
    <tr className="border-b border-gray-700 bg-gray-800/40">
      {/* 이 줄은 **뒤따르는 행들**의 머리다 → scope=rowgroup(= 이 tbody). */}
      <th colSpan={5} scope="rowgroup" className="px-0 py-1.5 text-left">
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${style.dot}`}
            aria-hidden
          />
          <span className={`text-[11px] font-medium ${style.text}`}>
            {t(TIER_LABEL_KEY[tier])}
          </span>
          <span className="text-[10px] text-gray-500">
            {t("usage.factSheet.tier.count", { n: count })}
          </span>
          <span
            className="truncate text-[10px] font-normal text-gray-500"
            title={t("usage.factSheet.tier.ruleTip")}
          >
            {t(TIER_DESC_KEY[tier])}
          </span>
        </span>
      </th>
    </tr>
  );
}

function FactRow({
  row,
  benchmark,
  variant,
}: {
  row: ModelFactRow;
  benchmark: BenchmarkVariantId;
  variant: ModelFactVariant;
}) {
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
        <BenchCell
          cell={row.benchByVariant?.[benchmark] ?? null}
          variant={variant}
        />
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

/**
 * 벤치 칸 — **선택된 변형 하나**에 대한 이 모델의 답.
 *
 * 빈 칸이 두 종류라는 점이 중요하다. 둘 다 "확인 필요" 로 그리되 툴팁이 다르다:
 *   · `cell == null` / `primary == null` → 이 변형에 이 모델의 참조 행이 아예 없다
 *     (= 아직 안 찾아봤다).
 *   · `primary.score == null` → 찾아봤는데 벤더가 공식 수치를 안 냈다. 그 note 가
 *     어디까지 찾았는지를 들고 있어, 다음 사람이 같은 곳을 다시 뒤지지 않는다.
 *
 * ★어느 경우에도 **다른 변형의 점수로 메우지 않는다**. 그 메움이 이 티켓의 버그였다.
 */
function BenchCell({
  cell,
  variant,
}: {
  cell: ModelFactBenchCell | null;
  variant: ModelFactVariant;
}) {
  const { t } = useTranslation();
  const bench = cell?.primary ?? null;
  if (!bench)
    return (
      <Unknown
        note={t("usage.factSheet.benchNoVariantRow", {
          variant: variant.label,
        })}
      />
    );
  if (bench.score === null) return <Unknown note={bench.note} />;

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-gray-200">
          {bench.score.toFixed(1)}%
        </span>
        {/* 출처가 화면에 적은 변형 이름 그대로 — 표준 표기와 다르면 그 차이가
            보여야 리뷰어가 출처를 열어 한 번에 대조한다. */}
        <span className="text-[10px] text-gray-400" title={variant.blurb}>
          {cell?.variantLabel ?? variant.label}
        </span>
      </div>
      <div
        className="text-[10px] text-gray-500"
        title={`${bench.harness}${bench.note ? ` — ${bench.note}` : ""}`}
      >
        {shortHarness(bench.harness)}
      </div>
      {/* ★같은 변형의 다른 측정. 하네스가 다를 수도(haiku: 벤더 vs 리더보드),
          하네스는 같은데 발표가 다를 수도 있다(gpt-5.5 를 OpenAI 가 두 번
          발표했고 값이 다르다). 그래서 라벨에 하네스와 **일자**를 같이 적는다 —
          "다른 하네스" 라고만 쓰면 후자를 거짓으로 설명하게 된다. */}
      {(cell?.alternates ?? []).map((alt) => (
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
