/**
 * 5단 드릴다운 화면 — 조직 › 팀 › 프로젝트 › **사람** › **에이전트·모델**.
 *
 * ★위 세 단은 Phase 2 의 `OrgUsageView` 가 이미 그린다. 이 파일은 그 표에서
 *   프로젝트 하나를 **펼쳤을 때** 나오는 아래 두 단이다 — 그 표를 다시 만들지
 *   않고, 층 이름만 빵부스러기로 이어 붙인다.
 *
 * ★firebase 도 next-intl 훅도 import 하지 않는다(`OrgViews.tsx` 규약) — 입력이
 *   정규화된 값 + 문구 사전 + 로케일뿐이라 `renderToStaticMarkup` 으로 화면
 *   바이트를 검사할 수 있다.
 *
 * ── 이 화면의 규약 ──────────────────────────────────────────────────────────
 *
 *  1) ★**모르는 것을 0 으로 그리지 않는다.** 기록 없음 · 판정 안 함 · 미측정 ·
 *     권한으로 가려짐은 **넷 다 다른 글자**로 나온다. 흐린 `0` 도 대시(—)도
 *     쓰지 않는다 — 둘 다 사람 눈에는 0 으로 읽힌다.
 *  2) ★**하네스족을 실제 모델로 승격시키지 않는다.** 실행기 이름으로 기록된
 *     금액은 별도 라벨과 **금액 문장**으로 밝힌다(그래야 발표에서 그 막대를
 *     설명할 수 있다).
 *  3) ★**사람 축의 경계를 화면이 말한다.** 비용은 "실행한 로그인 계정" 기준이고,
 *     병합 요청 번호는 사람에게 안 붙으며, 모델별 성공률은 아직 사람 축이
 *     아니다. 셋 다 상시 문장으로 나간다.
 *  4) ★**안 보여주는 것을 스스로 말한다**(#1333 §2.2). 지시문·응답·명령·파일은
 *     이 화면에 없다는 문장을 접지 않고 상시 노출한다.
 */

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { OrgCopy } from "./orgCopy";
import {
  PERSON_OUTCOME_MIN_SAMPLE,
  canDrawSuccessRate,
  reconcilePersonSum,
  successRateOf,
  type DrilldownModelRow,
  type DrilldownPersonRow,
  type DrilldownProjectDetail,
  type LedgerPersonAxis,
  type MemberModelAxis,
  type PersonCostCell,
  type PersonOutcomeAxis,
} from "./orgDrilldownContract";
import type { OrgUsageByProjectRow } from "./orgUsageContract";
import { formatInt, formatUsd } from "../team/teamUsageContract";
import type {
  AgentLabel,
  TeamAuditWorkloadRow,
} from "../team/teamAuditContract";
import type { TeamExecutionLedgerAxis } from "../team/teamExecutionLedgerContract";
// ★재사용 — 두 번 만들지 않는다(티켓 uYcCq9DRPLT8ZEh0rlkh). `/admin` 원장
//   섹션은 firebase 를 import 하지 않는 순수 프레젠테이션 컴포넌트라 이 파일의
//   규약(위 헤더 주석)을 깨지 않는다.
import ExecutionLedgerSection from "../admin/ExecutionLedgerSection";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

/**
 * ★"없음" 을 그리는 **유일한** 자리. 흐린 0 도 대시도 쓰지 않고 **글자**로
 * 그린다 — 대시는 사람 눈에 0 으로 읽힌다(형제 티켓 6X5zmTY5OUKI4Sxwufqo 의
 * `UNMEASURED_LABEL` 과 같은 판정).
 */
function AbsenceLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] font-medium text-zinc-400"
      title={hint}
    >
      {text}
    </span>
  );
}

function NoteLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{children}</p>
  );
}

// ── 비용 칸 — 세 부재를 셋으로 ──────────────────────────────────────────────

function CostCellView({
  copy,
  locale,
  cell,
}: {
  copy: OrgCopy;
  locale: string;
  cell: PersonCostCell;
}) {
  if (cell.kind === "measured") {
    return (
      <span className="text-zinc-200">
        {formatUsd(cell.costUsd, locale)}
        {cell.costUsd === 0 ? (
          <span className="ml-1.5 text-[11px] text-zinc-400">
            {copy.text["drill.cell.realZero"]}
          </span>
        ) : null}
      </span>
    );
  }
  if (cell.kind === "noRecords") {
    return (
      <AbsenceLabel
        text={copy.text["drill.cell.noRecords"]}
        hint={copy.text["drill.cell.noRecordsHint"]}
      />
    );
  }
  return (
    <AbsenceLabel
      text={copy.text["drill.cell.unknown"]}
      hint={copy.text["drill.cell.unknownHint"]}
    />
  );
}

// ── 5단째 — 이 사람의 모델·행위자종류 ───────────────────────────────────────

function ModelRowView({
  copy,
  locale,
  row,
}: {
  copy: OrgCopy;
  locale: string;
  row: DrilldownModelRow;
}) {
  const label =
    row.axis.kind === "model" ? (
      <span className="font-mono text-zinc-300">{row.axis.modelId}</span>
    ) : row.axis.kind === "harnessOnly" ? (
      // ★실행기 이름을 모델 자리에 그대로 앉히지 않는다 — 라벨을 갈라 붙인다.
      <span className="text-zinc-400">
        <span className="font-mono">{row.axis.harnessId}</span>{" "}
        <span className="rounded-full border border-amber-900/60 bg-amber-950/20 px-1.5 py-0.5 text-[11px] text-amber-200">
          {copy.text["drill.model.harnessOnly"]}
        </span>
      </span>
    ) : (
      <AbsenceLabel text={copy.text["drill.model.unknown"]} />
    );
  return (
    <tr className="border-b border-zinc-900 last:border-b-0">
      <td className="px-3 py-1.5">{label}</td>
      <td className="px-3 py-1.5 text-right text-zinc-300">
        {formatUsd(row.costUsd, locale)}
      </td>
      <td className="px-3 py-1.5 text-right text-zinc-400">
        {formatInt(row.tokens, locale)}
      </td>
    </tr>
  );
}

function MemberModelsView({
  copy,
  locale,
  axis,
}: {
  copy: OrgCopy;
  locale: string;
  axis: MemberModelAxis;
}) {
  if (axis.kind === "noRows") {
    return (
      <AbsenceLabel
        text={copy.text["drill.cell.noRecords"]}
        hint={copy.text["drill.cell.noRecordsHint"]}
      />
    );
  }
  if (axis.kind === "unknown") {
    return (
      <AbsenceLabel
        text={copy.text["drill.cell.unknown"]}
        hint={copy.text["drill.cell.unknownHint"]}
      />
    );
  }
  if (axis.kind === "unwired") {
    return (
      <AbsenceLabel
        text={copy.text["drill.cell.unwired"]}
        hint={copy.text["drill.cell.unwiredHint"]}
      />
    );
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-[11px]">
          <tbody>
            {axis.fold.rows.map((r) => (
              <ModelRowView
                key={r.rawKey}
                copy={copy}
                locale={locale}
                row={r}
              />
            ))}
          </tbody>
        </table>
      </div>
      {/* ★섞인 축을 금액으로 밝힌다 — 그래야 그 막대를 설명할 수 있다. */}
      {axis.fold.harnessOnlyCostUsd > 0 ? (
        <NoteLine>
          {fill(copy.text["drill.model.harnessNote"], {
            amount: formatUsd(axis.fold.harnessOnlyCostUsd, locale),
          })}
        </NoteLine>
      ) : null}
      {axis.byActorKind.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
          {axis.byActorKind.map((a) => (
            <span key={a.actorKind}>
              {a.actorKind === "orchestrator"
                ? copy.text["drill.actor.orchestrator"]
                : copy.text["drill.actor.worker"]}{" "}
              <span className="text-zinc-400">
                {formatUsd(a.costUsd, locale)}
              </span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

// ── 익명 설치 축 성과 — T₀ 경계를 화면이 말한다 ─────────────────────────────

function OutcomeAxisView({
  copy,
  axis,
}: {
  copy: OrgCopy;
  axis: PersonOutcomeAxis;
}) {
  if (axis.kind === "unwired") {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2">
        <p className="text-[11px] font-medium text-zinc-400">
          {copy.text["drill.outcome.title"]}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {copy.text["drill.outcome.unwired"]}
        </p>
        {/* ★각인 이전 구간은 영영 안 붙는다 — 나중에 버그로 보고되지 않게. */}
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {copy.text["drill.outcome.boundary"]}
        </p>
      </div>
    );
  }
  if (axis.kind === "pending") {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2">
        <p className="text-[11px] font-medium text-zinc-400">
          {copy.text["drill.outcome.title"]}
        </p>
        {axis.stampedFrom ? (
          <p className="mt-1 text-[11px] text-zinc-400">
            {fill(copy.text["drill.outcome.pending"], {
              date: axis.stampedFrom,
            })}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {copy.text["drill.outcome.boundary"]}
        </p>
      </div>
    );
  }
  const rate = successRateOf(axis.successes, axis.decided);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <p className="text-[11px] font-medium text-zinc-400">
        {copy.text["drill.outcome.title"]}
      </p>
      {/* ★표본이 모자라면 퍼센트를 그리지 않는다 — 없는 정밀도를 만들지 않는다. */}
      {canDrawSuccessRate(axis.decided) && rate !== null ? (
        <p className="mt-1 text-sm font-semibold text-zinc-100">
          {Math.round(rate * 1000) / 10}%
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-amber-200">
          {fill(copy.text["drill.outcome.sample"], {
            n: String(axis.decided),
            min: String(PERSON_OUTCOME_MIN_SAMPLE),
          })}
        </p>
      )}
      {axis.stampedFrom ? (
        <NoteLine>
          {fill(copy.text["drill.outcome.pending"], { date: axis.stampedFrom })}
        </NoteLine>
      ) : null}
    </div>
  );
}

// ── 4단 — 사람 한 명 ────────────────────────────────────────────────────────

function PersonCard({
  copy,
  locale,
  person,
  ledgerWired,
}: {
  copy: OrgCopy;
  locale: string;
  person: DrilldownPersonRow;
  /**
   * ★프로젝트 원장이 **배선돼 있나**. `person.ledger === null` 은 두 뜻이라
   * 이 값 없이는 못 가른다:
   *   배선됨 + 행 없음 → 이 사람 앞으로 사건이 없다(기록 없음)
   *   미배선          → 원장 자체가 안 온다(미측정)
   * 후자를 "기록 없음" 으로 그리면 배포 갭이 사람에 대한 판단으로 둔갑한다.
   */
  ledgerWired: boolean;
}) {
  const ledger = person.ledger;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-zinc-200">
          {person.displayName ?? copy.text["drill.person.unknownName"]}
        </span>
        <span className="text-[11px] text-zinc-400">
          {copy.text["drill.person.cost"]}{" "}
          <CostCellView copy={copy} locale={locale} cell={person.cost} />
        </span>
      </div>

      {/* 계정 축 원장 — 성공/실패·병합. ★사건이 안 붙었으면 0 이 아니라 없음. */}
      <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        {ledger === null ? (
          ledgerWired ? (
            <AbsenceLabel
              text={copy.text["drill.cell.noRecords"]}
              hint={copy.text["drill.cell.noRecordsHint"]}
            />
          ) : (
            <AbsenceLabel
              text={copy.text["drill.cell.unwired"]}
              hint={copy.text["drill.cell.unwiredHint"]}
            />
          )
        ) : (
          <>
            <span>
              {copy.text["drill.ledger.tasks"]}{" "}
              <span className="text-zinc-300">
                {formatInt(ledger.tasksTouched, locale)}
              </span>
            </span>
            <span>
              {copy.text["drill.ledger.successes"]}{" "}
              <span className="text-emerald-300">
                {formatInt(ledger.successes, locale)}
              </span>
            </span>
            <span>
              {copy.text["drill.ledger.failures"]}{" "}
              <span className="text-amber-300">
                {formatInt(ledger.failures, locale)}
              </span>
            </span>
            <span>
              {copy.text["drill.ledger.merges"]}{" "}
              <span className="text-zinc-300">
                {formatInt(ledger.merges, locale)}
              </span>
            </span>
          </>
        )}
      </p>

      {/* ── 5단째 ── */}
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {copy.text["drill.model.title"]}
      </p>
      <MemberModelsView copy={copy} locale={locale} axis={person.models} />

      <div className="mt-2">
        <OutcomeAxisView copy={copy} axis={person.outcome} />
      </div>
    </div>
  );
}

// ── 에이전트 표 — ★개체 나열이 아니라 이미 감사 화면이 내는 행 그대로 ───────

function agentText(copy: OrgCopy, label: AgentLabel): string {
  if (label.kind === "value") return label.value;
  // ★"가렸음" 과 "없음" 을 같은 칸으로 그리지 않는다.
  return label.kind === "redacted"
    ? copy.text["drill.agents.redacted"]
    : copy.text["drill.agents.absent"];
}

function AgentsTable({
  copy,
  locale,
  rows,
}: {
  copy: OrgCopy;
  locale: string;
  rows: ReadonlyArray<TeamAuditWorkloadRow>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <h6 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {copy.text["drill.agents.title"]}
      </h6>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="px-3 py-1.5 font-medium">
                {copy.text["drill.agents.title"]}
              </th>
              <th className="px-3 py-1.5 font-medium">
                {copy.text["drill.model.title"]}
              </th>
              <th className="px-3 py-1.5 font-medium">
                {copy.text["drill.agents.role"]}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">
                {copy.text["drill.agents.open"]}
              </th>
              <th className="px-3 py-1.5 text-right font-medium">
                {copy.text["drill.agents.done"]}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${agentText(copy, r.agentId)}:${i}`}
                className="border-b border-zinc-900 last:border-b-0"
              >
                <td className="px-3 py-1.5 text-zinc-300">
                  {agentText(copy, r.name)}
                </td>
                <td className="px-3 py-1.5 font-mono text-zinc-400">
                  {r.model ?? (
                    <AbsenceLabel text={copy.text["drill.model.unknown"]} />
                  )}
                </td>
                <td className="px-3 py-1.5 text-zinc-400">
                  {r.role ?? (
                    <AbsenceLabel text={copy.text["drill.agents.absent"]} />
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-400">
                  {formatInt(r.openTasks, locale)}
                </td>
                <td className="px-3 py-1.5 text-right text-zinc-400">
                  {formatInt(r.doneTasks, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 프로젝트 하나를 펼친 모습 ───────────────────────────────────────────────

function LedgerNotes({
  copy,
  locale,
  ledger,
}: {
  copy: OrgCopy;
  locale: string;
  ledger: LedgerPersonAxis;
}) {
  if (ledger.kind !== "measured") return null;
  return (
    <>
      {/* ★병합 이력에는 행위자가 없다 — 번호를 사람에게 붙이지 않는다는 사실. */}
      {ledger.unattributedMerges > 0 ? (
        <NoteLine>
          {fill(copy.text["drill.ledger.unattributedMerges"], {
            n: formatInt(ledger.unattributedMerges, locale),
          })}
        </NoteLine>
      ) : null}
      {ledger.truncated ? (
        <p className="mt-1 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-200">
          {copy.text["drill.ledger.truncated"]}
        </p>
      ) : null}
    </>
  );
}

/**
 * ★Mission→Ticket→Agent→Model→Cost→Result — `/admin` `ExecutionLedgerSection`
 * 재사용(티켓 uYcCq9DRPLT8ZEh0rlkh). `unwired`(콜러블 미배선/실패)는 아무것도
 * 그리지 않는다 — `/admin` `ProjectAuditPanel` 이 원장을 못 받았을 때 하는
 * 것과 같은 판단(0 을 지어내지 않는다).
 */
function ExecutionLedgerAxisSection({
  copy,
  ledger,
}: {
  copy: OrgCopy;
  ledger: TeamExecutionLedgerAxis;
}) {
  if (ledger.kind === "unwired") return null;
  if (ledger.kind === "restricted") {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2">
        <p className="text-[11px] font-medium text-zinc-300">
          {copy.text["drill.executionLedger.title"]}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {ledger.reason ?? copy.text["drill.executionLedger.restricted"]}
        </p>
      </div>
    );
  }
  if (ledger.kind === "empty") {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2">
        <p className="text-[11px] font-medium text-zinc-300">
          {copy.text["drill.executionLedger.title"]}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {copy.text["drill.executionLedger.empty"]}
        </p>
      </div>
    );
  }
  return (
    <ExecutionLedgerSection rows={ledger.rows} coverage={ledger.coverage} />
  );
}

export function ProjectDrilldownDetail({
  copy,
  locale,
  detail,
  projectTotalUsd,
}: {
  copy: OrgCopy;
  locale: string;
  detail: DrilldownProjectDetail;
  projectTotalUsd: number | null;
}) {
  if (detail.kind === "loading") {
    return (
      <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-zinc-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {copy.text["drill.loading"]}
      </p>
    );
  }
  if (detail.kind === "error") {
    return (
      <p className="px-3 py-3 text-[11px] text-amber-300">
        {copy.text["drill.error"]}
      </p>
    );
  }
  // ★권한으로 가려진 칸. 숫자를 그리지 않고 **무엇이 있어야 보이는지**만 말한다.
  if (detail.kind === "restricted") {
    return (
      <div className="m-3 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2">
        <p className="text-[11px] font-medium text-zinc-300">
          {copy.text["drill.restricted.title"]}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {detail.reason ?? copy.text["drill.restricted.body"]}
        </p>
      </div>
    );
  }

  if (detail.persons.length === 0) {
    return (
      <div className="space-y-2 p-3">
        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            {copy.text["drill.empty"]}
          </p>
          <NoteLine>{copy.text["drill.person.basis"]}</NoteLine>
        </div>
        {/* ★사람 축이 비었어도 실행 원장은 독립된 축이다 — 같이 접지 않는다
            (비용 게이트가 사람 축과 다른 이유로 열리고 닫힐 수 있다). */}
        <ExecutionLedgerAxisSection
          copy={copy}
          ledger={detail.executionLedger}
        />
      </div>
    );
  }

  const reconciliation = reconcilePersonSum(detail.persons, projectTotalUsd);

  return (
    <div className="space-y-2 p-3">
      <h5 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {copy.text["drill.person.title"]}
      </h5>
      <div className="grid gap-2 md:grid-cols-2">
        {detail.persons.map((p) => (
          <PersonCard
            key={p.memberKey}
            copy={copy}
            locale={locale}
            person={p}
            ledgerWired={detail.ledger.kind !== "unwired"}
          />
        ))}
      </div>

      {/* ★막대가 하나만 서는 화면을 "데이터 부족" 이 아니라 "축이 안 갈렸다" 로. */}
      {detail.persons.length === 1 ? (
        <NoteLine>{copy.text["drill.person.single"]}</NoteLine>
      ) : null}
      {/* ★사람 합 ≠ 프로젝트 합. 차이를 삼키지 않는다. */}
      {reconciliation.hasGap && reconciliation.gapUsd !== null ? (
        <NoteLine>
          {fill(copy.text["drill.person.gap"], {
            amount: formatUsd(Math.abs(reconciliation.gapUsd), locale),
          })}
        </NoteLine>
      ) : null}
      <LedgerNotes copy={copy} locale={locale} ledger={detail.ledger} />

      <AgentsTable copy={copy} locale={locale} rows={detail.workload} />

      {/* ★비용의 축이 무엇인지 상시 문장. 한 사람 여러 기기가 한 줄로 합쳐진다. */}
      <NoteLine>{copy.text["drill.person.basis"]}</NoteLine>

      <ExecutionLedgerAxisSection copy={copy} ledger={detail.executionLedger} />
    </div>
  );
}

// ── 섹션 — 프로젝트 목록 + 펼침 ─────────────────────────────────────────────

export type DrilldownProjectEntry = OrgUsageByProjectRow;

export function OrgDrilldownSection({
  copy,
  locale,
  projects,
  expandedProjectId,
  onToggle,
  detail,
}: {
  copy: OrgCopy;
  locale: string;
  /** Phase 2 봉투의 프로젝트 행 그대로. ★여기서 다시 집계하지 않는다. */
  projects: ReadonlyArray<DrilldownProjectEntry>;
  expandedProjectId: string | null;
  onToggle: (projectId: string | null) => void;
  /** 펼친 프로젝트의 4·5단. 안 펼쳤으면 `null`. */
  detail: DrilldownProjectDetail | null;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h4 className="text-sm font-semibold text-zinc-300">
        {copy.text["drill.title"]}
      </h4>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
        {copy.text["drill.subtitle"]}
      </p>

      {projects.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
          {copy.text["drill.empty"]}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {projects.map((p) => {
            const open = expandedProjectId === p.projectId;
            return (
              <li
                key={p.projectId}
                className="overflow-hidden rounded-xl border border-zinc-800"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onToggle(open ? null : p.projectId)}
                  className="flex w-full items-center justify-between gap-3 bg-zinc-950/60 px-3 py-2 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    )}
                    <span className="truncate text-xs text-zinc-300">
                      {/* 빵부스러기 — 위 세 단을 다시 그리지 않고 이름만 잇는다. */}
                      {p.teamDisplayName ? (
                        <span className="text-zinc-400">
                          {p.teamDisplayName} ›{" "}
                        </span>
                      ) : null}
                      {p.projectName ?? p.projectId}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-zinc-400">
                      {formatUsd(p.costUsd, locale)}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {open
                        ? copy.text["drill.collapse"]
                        : copy.text["drill.expand"]}
                    </span>
                  </span>
                </button>
                {open ? (
                  <ProjectDrilldownDetail
                    copy={copy}
                    locale={locale}
                    detail={detail ?? { kind: "loading" }}
                    projectTotalUsd={p.costUsd}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* ★안 보여주는 것을 접지 않고 상시 노출한다(#1333 §2.2). */}
      <NoteLine>{copy.text["drill.withheld"]}</NoteLine>
    </div>
  );
}
