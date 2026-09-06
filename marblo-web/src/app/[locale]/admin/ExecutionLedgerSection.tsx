"use client";

// ★불변 실행 원장 — Mission → Ticket → Agent → Model → Cost → Result 를 한 줄로.
//
// ─────────────────────────────────────────────────────────────────────────────
// 왜 이 섹션이 따로 있나
// ─────────────────────────────────────────────────────────────────────────────
// 같은 화면의 "활동 타임라인" 은 **사건 나열**이다. 거기서는 "이 미션의 이 티켓을
// 이 에이전트가 이 모델로 실행해서 이 비용에 이 결과가 났다" 가 한 줄로 읽히지
// 않는다 — 여섯 축이 여섯 행에 흩어져 있기 때문이다. 이 섹션이 그 한 줄이다.
//
// 데이터는 `getAdminProjectAudit` 응답의 `executionLedger` 뿐이다. 새 콜러블도
// 새 집계도 없다(서버 `v3/functions/src/projectAudit.ts` 의 "실행 원장" 절 참조).
//
// ─────────────────────────────────────────────────────────────────────────────
// ★이 화면이 지키는 규율 셋 — 어기면 발표에서 틀린 숫자가 나간다
// ─────────────────────────────────────────────────────────────────────────────
// (1) **미측정을 0 으로 그리지 않는다.** 비용·모델·재시도는 nullable 이고, null
//     은 "미측정" 이라는 **글자**로 그린다. 흐린 `$0.00` 도, `—` 도 안 된다 —
//     둘 다 사람 눈에 "0 원 썼다" 로 읽힌다. 실측 0 인 티켓만 `$0.00` 이다.
// (2) **하네스 축을 실제 모델 칸에 넣지 않는다.** `claude`/`codex` 는 실행기이지
//     모델이 아니다. 실제 모델(`detectedModelId`→`spawnedModel`)이 없으면 그
//     칸은 "미측정" 이고, 하네스는 **별도 칩**으로 축을 밝혀 보여준다.
// (3) **총계 분모를 밝힌다.** 합계는 `실측된 행`만 더하고, 몇 건 중 몇 건이
//     실측인지 헤더에 적는다. 미측정을 0 으로 세어 평균을 희석하지 않는다.
//
// ★자유 텍스트는 새로 늘리지 않는다. 이 표가 그리는 문자열은 이미 응답에 있던
//   티켓 제목·미션 목표뿐이다. 원장 `params`·`result`·`instructionRedacted` 는
//   서버가 이 축에 싣지 않고(테스트로 고정), 이 파일도 그릴 수 없다.

import {
  Ticket as TicketIcon,
  ExternalLink,
  Info,
  ScrollText,
} from "lucide-react";

// ── 콜러블 응답 타입 (v3/functions/src/projectAudit.ts 미러) ─────────────────

export type ModelEvidenceSource = "detectedModelId" | "spawnedModel";

export type LedgerModelAxis = {
  /** 실제 실행 모델. null = 미측정(하네스 값으로 대신하지 않는다). */
  actual: string | null;
  actualSource: ModelEvidenceSource | null;
  /** 하네스/실행기 축. 실제 모델이 아니다. */
  harness: string | null;
};

export type LedgerCostAxis = {
  /** null = 미측정, 0 = 실측 0. */
  total: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  retries: number | null;
};

export type LedgerResultAxis = {
  status: string | null;
  completedAt: string | null;
  prUrl: string | null;
  merged: boolean;
  actions: number;
  failedActions: number;
};

export type ExecutionLedgerRow = {
  taskId: string;
  missionId: string | null;
  missionGoal: string | null;
  ticketTitle: string | null;
  role: string | null;
  claimedBy: string | null;
  agentId: string | null;
  agentName: string | null;
  agentResolved: boolean;
  model: LedgerModelAxis;
  cost: LedgerCostAxis;
  result: LedgerResultAxis;
  at: string | null;
};

export type ExecutionLedgerCoverage = {
  rows: number;
  ticketsWithoutExecution: number;
  modelMeasured: number;
  costMeasured: number;
  agentResolved: number;
  costMeasuredTotal: number;
};

// ── 표시 규약 ────────────────────────────────────────────────────────────────

/**
 * ★"미측정" 은 대시(—)가 아니라 **글자**다.
 *
 * 대시는 이 표에서 이미 "값이 0 이거나 해당 없음" 으로 읽히고, 흐린 0 은 그냥
 * 0 으로 읽힌다. 측정이 아예 없었다는 사실은 눈에 보여야 한다 — 그게 이 화면이
 * 발표에서 방어할 수 있는 유일한 형태다.
 */
export const UNMEASURED_LABEL = "미측정";

/** 미측정 사유를 마우스오버로 밝힌다. 화면은 짧게, 근거는 남기게. */
const UNMEASURED_TITLE =
  "이 축은 기록이 없다. 0 이 아니라 '측정되지 않음' 이다.";

export function Unmeasured({ title }: { title?: string }) {
  return (
    <span
      className="italic text-zinc-600"
      title={title ?? UNMEASURED_TITLE}
      data-measured="false"
    >
      {UNMEASURED_LABEL}
    </span>
  );
}

/**
 * 비용 표기. ★`null` 은 여기 오지 않는다 — 호출부가 먼저 갈라서 `Unmeasured`
 * 를 그린다. 0 은 `$0.00` 으로 **그린다**(실측된 0 은 사실이다).
 * 1센트 미만은 `$0.00` 으로 반올림하면 "0 원" 으로 읽히므로 `<$0.01` 로 쓴다.
 */
export function formatCost(total: number): string {
  if (total === 0) return "$0.00";
  if (total > 0 && total < 0.01) return "<$0.01";
  return `$${total.toFixed(2)}`;
}

/** 토큰 수 — 천 단위 구분. 0 은 0 으로 그린다. */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLE: Record<string, string> = {
  TODO: "bg-zinc-800 text-zinc-300",
  CLAIMED: "bg-sky-950/60 text-sky-300",
  IN_PROGRESS: "bg-indigo-950/60 text-indigo-300",
  REVIEW: "bg-violet-950/60 text-violet-300",
  BLOCKED: "bg-amber-950/60 text-amber-300",
  FAILED: "bg-red-950/60 text-red-300",
  DONE: "bg-emerald-950/60 text-emerald-300",
};

function statusClass(status: string | null): string {
  return (status && STATUS_STYLE[status]) || "bg-zinc-800 text-zinc-400";
}

/**
 * 커버리지 한 줄. ★분모를 항상 같이 낸다 — "N건 중 M건" 이 아니면 이 화면의
 * 숫자는 발표에서 방어할 수 없다.
 */
export function coverageSentence(c: ExecutionLedgerCoverage): string {
  if (c.rows === 0) return "실행 기록이 아직 없습니다.";
  return (
    `실행 ${c.rows}건 · 실제 모델 실측 ${c.modelMeasured}/${c.rows} · ` +
    `티켓 비용 실측 ${c.costMeasured}/${c.rows}`
  );
}

// ── 셀 ──────────────────────────────────────────────────────────────────────

function ModelCell({ model }: { model: LedgerModelAxis }) {
  return (
    <div className="flex flex-col gap-0.5">
      {model.actual ? (
        <span
          className="font-medium text-zinc-200"
          title={
            model.actualSource === "detectedModelId"
              ? "과금 세션 메타데이터에서 관측된 실제 모델"
              : "스폰 argv 를 되읽어 스탬프한 모델"
          }
        >
          {model.actual}
        </span>
      ) : (
        <Unmeasured title="실제 실행 모델이 기록되지 않았다. 아래 하네스 값은 실행기 축이지 모델이 아니다." />
      )}
      {model.harness && (
        <span
          className="w-fit rounded bg-zinc-800/80 px-1.5 py-0.5 text-[11px] text-zinc-500"
          title="하네스(실행기) 축 — 모델 이름이 아니다"
        >
          하네스 {model.harness}
        </span>
      )}
    </div>
  );
}

function CostCell({ cost }: { cost: LedgerCostAxis }) {
  if (cost.total === null) {
    return (
      <Unmeasured
        title={
          "이 티켓에는 비용 롤업이 없다(롤업 도입 이전 티켓이거나 적립된 " +
          "델타가 없다). 0 원이 아니다."
        }
      />
    );
  }
  const tokens =
    cost.inputTokens !== null || cost.outputTokens !== null
      ? `${cost.inputTokens !== null ? formatTokens(cost.inputTokens) : "?"} in / ${
          cost.outputTokens !== null ? formatTokens(cost.outputTokens) : "?"
        } out`
      : null;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-medium tabular-nums text-zinc-200">
        {formatCost(cost.total)}
      </span>
      {tokens && (
        <span className="text-[11px] tabular-nums text-zinc-600">{tokens}</span>
      )}
      {cost.retries !== null && cost.retries > 0 && (
        <span className="text-[11px] text-amber-400/80">
          재시도 {cost.retries}
        </span>
      )}
    </div>
  );
}

function ResultCell({ result }: { result: LedgerResultAxis }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${statusClass(
          result.status
        )}`}
      >
        {result.status ?? "(미기록)"}
      </span>
      {result.merged && (
        <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-xs text-emerald-300">
          머지됨
        </span>
      )}
      {result.failedActions > 0 && (
        <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-xs text-red-300">
          실패 호출 {result.failedActions}
        </span>
      )}
      <span className="text-[11px] text-zinc-600" title="원장에 남은 툴 호출 수">
        원장 {result.actions}
      </span>
      {result.prUrl && (
        <a
          href={result.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-400 transition hover:text-indigo-300"
        >
          PR
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

// ── 본체 ────────────────────────────────────────────────────────────────────

export default function ExecutionLedgerSection({
  rows,
  coverage,
}: {
  rows: ExecutionLedgerRow[];
  coverage: ExecutionLedgerCoverage;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <ScrollText className="h-5 w-5 text-indigo-400" />
        <h3 className="text-base font-semibold">불변 실행 원장</h3>
        <span className="ml-auto text-xs tabular-nums text-zinc-500">
          {coverageSentence(coverage)}
        </span>
      </div>
      <p className="mb-2 text-xs leading-relaxed text-zinc-500">
        미션 · 티켓 · 에이전트 · 모델 · 비용 · 결과를 한 줄로 이은 기록입니다.
        기록 원본은 삭제·수정이 룰로 막힌 컬렉션(<code>audit_logs</code> ·{" "}
        <code>activities</code> · <code>merge_history</code> ·{" "}
        <code>cost_logs</code>)에 있습니다.{" "}
        <strong className="text-zinc-400">
          &quot;{UNMEASURED_LABEL}&quot; 은 0 이 아니라 측정이 없었다는 뜻입니다.
        </strong>
      </p>

      {/* ★기준(basis) — 이 표의 숫자가 무엇을 잰 것인지 화면이 직접 말한다.
          이 문구가 없으면 다음 두 오독이 반드시 일어난다:
            ① 비용을 계정·조직 지출로 읽는다 (아니다 — 티켓 단위 적립값이다)
            ② 에이전트 열을 사람 축으로 읽는다 (아니다 — 실행 단위다)
          ②는 특히 위험하다. 지금 실행이 사실상 한 계정에서 나오므로, 사람
          축을 그렸다면 막대가 하나로 뭉쳤을 것이다. 이 화면은 사람 축을
          아예 그리지 않으며, 그 사실을 숨기지 않는다. */}
      <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs leading-relaxed text-zinc-500">
        <strong className="text-zinc-400">기준.</strong> 비용은 실행 중인
        에이전트의 코스트 스트림에서 <strong>티켓 단위로 적립</strong>된 값입니다
        — 계정·조직 지출 합계가 아니고, 전역 집계를 다시 더한 값도 아닙니다.
        행위자 열은 <strong>에이전트(실행 단위)</strong>이며 사람·계정 축이
        아닙니다. 이 화면은 사람 축을 그리지 않습니다.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-8 text-center">
          <p className="text-sm text-zinc-400">
            이 프로젝트에는 아직 실행 기록이 없습니다.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            티켓이 에이전트에 물리고 툴 호출이 원장에 쌓이면 여기에 나타납니다.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">
              미션별 티켓 실행 원장 — 에이전트, 실행 모델, 비용, 결과
            </caption>
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  미션
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  티켓
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  에이전트
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  모델
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  비용
                </th>
                <th scope="col" className="py-2 font-medium">
                  결과
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.taskId}
                  className="border-b border-zinc-800/60 align-top last:border-0"
                >
                  <td className="max-w-[180px] py-3 pr-4">
                    {row.missionGoal ? (
                      <span className="text-zinc-300">{row.missionGoal}</span>
                    ) : row.missionId ? (
                      <span className="text-zinc-500">
                        미션 {row.missionId.slice(0, 8)}
                      </span>
                    ) : (
                      <span
                        className="text-zinc-600"
                        title="보드/퀵레인에서 실행된 티켓 — 미션에 속하지 않는다"
                      >
                        보드 · 퀵레인
                      </span>
                    )}
                  </td>
                  <td className="max-w-[260px] py-3 pr-4">
                    <div className="flex items-start gap-1.5">
                      <TicketIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
                      <div className="min-w-0">
                        <div className="truncate text-zinc-200">
                          {row.ticketTitle ?? row.taskId}
                        </div>
                        <div className="text-[11px] text-zinc-600">
                          {row.role ?? "역할 미기록"} ·{" "}
                          {formatDateTime(row.at)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {row.agentResolved ? (
                      <span className="text-zinc-300">
                        {row.agentName ?? row.agentId}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-zinc-400">
                          {row.claimedBy ?? "—"}
                        </span>
                        <span
                          className="text-[11px] text-zinc-600"
                          title="완료된 에이전트 문서는 정리되어 사라진다. '에이전트 없음' 이 아니라 '문서 없음' 이다."
                          data-agent-resolved="false"
                        >
                          문서 없음
                        </span>
                      </div>
                    )}
                  </td>
                  <td data-axis="model" className="py-3 pr-4">
                    <ModelCell model={row.model} />
                  </td>
                  <td data-axis="cost" className="py-3 pr-4 text-right">
                    <CostCell cost={row.cost} />
                  </td>
                  <td className="py-3">
                    <ResultCell result={row.result} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ★합계 — 분모를 밝힌다. 미측정 행을 0 으로 세지 않는다. */}
      {coverage.rows > 0 && (
        <div className="mt-4 flex flex-wrap items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs text-zinc-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <p>
              실측된 비용 합계{" "}
              <strong className="tabular-nums text-zinc-300">
                {formatCost(coverage.costMeasuredTotal)}
              </strong>{" "}
              — 분모는 실행 {coverage.rows}건이 아니라{" "}
              <strong className="tabular-nums text-zinc-400">
                비용이 실측된 {coverage.costMeasured}건
              </strong>
              입니다. 나머지 {coverage.rows - coverage.costMeasured}건은 0 원이
              아니라 미측정입니다.
            </p>
            <p>
              실제 실행 모델이 기록된 행은 {coverage.modelMeasured}/
              {coverage.rows}건입니다. 하네스(claude · codex 등)는 실행기 축이라
              모델 수치로 세지 않습니다.
            </p>
            {coverage.ticketsWithoutExecution > 0 && (
              <p>
                실행 흔적이 없어 이 표에 올리지 않은 티켓이{" "}
                {coverage.ticketsWithoutExecution}건 있습니다.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
