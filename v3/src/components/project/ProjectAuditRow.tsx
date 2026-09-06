import { useTranslation } from "../../lib/i18n";
import {
  auditBadgeKind,
  type AuditRowLabel,
  type AuditRowEvidence,
  type UnifiedAuditRow,
} from "../../lib/projectAuditView";

/**
 * 감사 행 하나를 그리는 **공용 조각들**.
 *
 * 예전엔 이 셋이 ProjectAuditPanel 안에 살았고 티켓 상세 모달이 패널에서
 * import 했다. 관리자 뷰가 패널을 여러 컴포넌트로 쪼개면서 그 배치가
 * 순환 import(패널 → 티켓 카드 → 패널)를 만들게 돼, 화면이 아니라 **조각**인
 * 것들만 여기로 내렸다. 동작은 하나도 안 바뀐다.
 */

/**
 * 뱃지 하나 — 사람 / 오케(에이전트, 모델 있음) / 오케(컨트롤플레인, 모델 없음).
 *
 * ★세 갈래로 가르는 이유: 지금 오케가 사장님 uid 로 행동해 사람 행과 오케 행이
 * 이름만으로는 안 갈린다("John Kim" 이 둘 다에 뜬다). `actorKind`+`model` 로
 * 시각 구분을 강제한다. 모델이 없는 오케 행은 "모델 미상"(오류처럼 읽힘)이
 * 아니라 "오케 조작"(정상 분류 — 스폰된 에이전트 없이 오케 자신이 MCP 툴을
 * 직접 호출한 행위)으로 구분한다.
 */
export function AuditBadge({
  row,
}: {
  row: Pick<UnifiedAuditRow, "actorKind" | "model">;
}) {
  const { t } = useTranslation();
  const kind = auditBadgeKind(row);

  if (kind === "human") {
    return (
      <span className="flex-shrink-0 rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400">
        {t("project.audit.actor.human")}
      </span>
    );
  }
  if (kind === "agentModel") {
    return (
      <span
        className="flex-shrink-0 rounded border border-purple-800/70 bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-300"
        title={t("project.audit.actor.agentHint")}
      >
        {`🤖 ${row.model}`}
      </span>
    );
  }
  return (
    <span
      className="flex-shrink-0 rounded border border-blue-800/70 bg-blue-950/40 px-1.5 py-0.5 text-[10px] text-blue-300"
      title={t("project.audit.actor.orchestratorHint")}
    >
      {`🎛️ ${t("project.audit.actor.orchestrator")}`}
    </span>
  );
}

/**
 * 사람 행위·아는 툴은 번역한 라벨을, 모르는 툴은 코드 값 그대로 찍는다
 * (모노스페이스). 아는 툴의 원문 toolName 은 감춘 게 아니라 감싸는 배지의
 * `title` 로 옮겨졌다(hover 로 대조 가능).
 */
export function RowLabel({ label }: { label: AuditRowLabel }) {
  const { t } = useTranslation();
  if (label.kind === "i18n" || label.kind === "tool")
    return <>{t(label.key)}</>;
  return <span className="font-mono">{label.text}</span>;
}

/**
 * 감사 시각은 **절대 시각**으로 찍는다. 작업량 표의 "3분 전"과 달리 감사는
 * 나중에 "그때 정확히 언제였나"를 되짚는 용도라, 상대 시각은 기록을 다시 읽는
 * 순간 쓸모가 없어진다.
 *
 * createdAt 이 Date 가 아닌 경우(변환 실패)에도 터지지 않게 방어한다.
 */
export function formatAuditTime(value: Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 이벤트 한 줄 — 티켓 그룹을 펼쳤을 때 보이는 타임라인의 원소.
 *
 * ★티켓 칸이 없다. 이 행은 이미 **자기 티켓 카드 안**에 있어서 티켓 이름을 다시
 * 찍으면 같은 문장을 줄마다 되풀이하게 된다(예전 평면 목록이 시끄러웠던 이유의
 * 절반이 이거였다). 워크트리·PR 같은 티켓 단위 사실도 카드 헤더의 링크
 * 클러스터로 한 번만 올라간다.
 */
export function AuditTimelineRow({
  row,
  locale,
}: {
  row: UnifiedAuditRow;
  locale: string;
}) {
  const { t } = useTranslation();

  return (
    <li className="py-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <AuditBadge row={row} />

        <span
          className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400"
          title={row.label.kind === "tool" ? row.label.toolName : undefined}
        >
          <RowLabel label={row.label} />
        </span>

        <span className="text-xs text-gray-200">
          {row.actorLabel ?? t("project.audit.actor.unknown")}
        </span>

        {row.detail && (
          <span className="min-w-0 whitespace-normal break-words text-xs text-gray-500">
            {row.detail}
          </span>
        )}

        {row.failed && (
          <span className="rounded border border-red-900/60 px-1 text-[10px] text-red-400">
            {t("project.audit.failed")}
          </span>
        )}

        <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-gray-500">
          {formatAuditTime(row.createdAt, locale)}
        </span>
      </div>
      <AuditEvidenceDetails evidence={row.evidence} />
    </li>
  );
}

export function AuditEvidenceDetails({
  evidence,
}: {
  evidence: AuditRowEvidence | null;
}) {
  const { t } = useTranslation();
  if (
    !evidence?.paramsJson &&
    !evidence?.resultText &&
    !evidence?.instructionRedacted &&
    !evidence?.activityText &&
    !evidence?.paramsWithheld
  )
    return null;
  return (
    <details className="mt-1 rounded border border-gray-800 bg-gray-950/40 px-2 py-1 text-xs text-gray-400">
      <summary className="cursor-pointer select-none text-[11px] text-gray-500 hover:text-gray-300">
        {t("project.audit.detail.toggle")}
      </summary>
      <div className="mt-2 space-y-2">
        {evidence.activityText && (
          <AuditEvidenceBlock
            label={t("project.audit.detail.lastActivity")}
            value={evidence.activityText}
          />
        )}
        {evidence.paramsJson && (
          <AuditEvidenceBlock
            label={t("project.audit.detail.params")}
            value={evidence.paramsJson}
            mono
          />
        )}
        {evidence.paramsWithheld && (
          <p
            data-testid="audit-params-withheld"
            className="text-[11px] text-amber-600/80"
          >
            {t("project.audit.detail.paramsWithheld")}
          </p>
        )}
        {evidence.instructionRedacted && (
          <AuditEvidenceBlock
            label={t("project.audit.detail.prompt")}
            value={evidence.instructionRedacted}
            mono
          />
        )}
        {evidence.resultText && (
          <AuditEvidenceBlock
            label={t("project.audit.detail.result")}
            value={evidence.resultText}
            mono
          />
        )}
      </div>
    </details>
  );
}

function AuditEvidenceBlock({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-600">
        {label}
      </div>
      <pre
        className={`max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-950 px-2 py-1.5 text-[11px] leading-relaxed text-gray-300 ${
          mono ? "font-mono" : "font-sans"
        }`}
      >
        {value}
      </pre>
    </div>
  );
}
