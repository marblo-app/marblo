/**
 * Mission Replay — 헤드라인 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1.
 *
 * goal·템플릿·시작/완료 시각·소요시간 + **프로버넌스 표기**. 마지막 것이 이
 * 컴포넌트에서 가장 중요한 칸이다: `provenance.sources` 의 `denied` 는 "그 레인의
 * 일이 없었다"가 아니라 "권한이 없어 못 읽었다"이고, 그걸 화면에서 뭉개면 감사에서
 * 최악의 실패(조용한 누락)가 된다(설계 C2/R4, `types/missionReplay.ts` 주석).
 *
 * ★공유·익스포트 버튼은 없다. Phase 2(레닭션)를 통과하지 않은 바이트는 앱 밖으로
 * 한 바이트도 나가지 않는다(설계 §4 불변식) — 버튼이 있으면 반드시 눌린다.
 */

import type { TFunction } from "../../../lib/i18n";
import {
  isReplayShareFormatImplemented,
  type ReplayShareFormat,
} from "./ReplayShareFlow";
import type {
  MissionReplay,
  ReplaySource,
  ReplaySourceState,
} from "../../../types/missionReplay";
import type { ReplaySourceErrors } from "../../../services/missionReplayService";
import { replayHumanStepCount } from "./ReplayStatsGrid";

type ShareFormatCopyKey = Parameters<TFunction>[0];

const SHARE_FORMATS: readonly {
  key: ReplayShareFormat;
  icon: string;
  label: ShareFormatCopyKey;
  hint: ShareFormatCopyKey;
}[] = [
  {
    key: "image",
    icon: "▣",
    label: "workHistory.replay.shareBar.card",
    hint: "workHistory.replay.shareBar.cardHint",
  },
  {
    key: "gif",
    icon: "▶",
    label: "workHistory.replay.shareBar.gif",
    hint: "workHistory.replay.shareBar.gifHint",
  },
  {
    key: "link",
    icon: "↗",
    label: "workHistory.replay.shareBar.link",
    hint: "workHistory.replay.shareBar.linkHint",
  },
];

/** 소스 표기 순서 — 미션 서사(위) → 코드 성과(아래). */
const SOURCE_ORDER: readonly ReplaySource[] = [
  "mission.contextLog",
  "task",
  "task.activity",
  "audit_logs",
  "projectAuditLog",
  "merge_history",
];

/**
 * 소요시간 문자열. 상위 두 단위까지만 쓴다("2시간 13분").
 *
 * `Intl.RelativeTimeFormat` 을 쓰지 않는 이유: 저건 "3시간 전" 같은 **상대 시점**
 * 포맷이고 여기 필요한 것은 **경과 구간**이다. 두 개는 다른 문장이라 로케일 파일의
 * 단위 키를 조합하는 편이 정확하다.
 */
export function formatReplayDuration(ms: number, t: TFunction): string {
  if (!Number.isFinite(ms) || ms <= 0)
    return t("workHistory.replay.duration.none");
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days) parts.push(t("workHistory.replay.duration.days", { count: days }));
  if (hours)
    parts.push(t("workHistory.replay.duration.hours", { count: hours }));
  if (!days && minutes) {
    parts.push(t("workHistory.replay.duration.minutes", { count: minutes }));
  }
  if (!days && !hours && !minutes) {
    parts.push(t("workHistory.replay.duration.seconds", { count: seconds }));
  }
  return parts.slice(0, 2).join(" ");
}

export function formatReplayTimestamp(date: Date | null | undefined): string {
  return date instanceof Date ? date.toLocaleString("ko-KR") : "—";
}

function sourceStateTone(state: ReplaySourceState, failed: boolean): string {
  if (failed) return "text-amber-300 border-amber-500/40";
  if (state === "denied") return "text-red-300 border-red-500/40";
  if (state === "ok") return "text-emerald-300 border-emerald-500/40";
  return "text-gray-500 border-gray-700";
}

function ProvenanceChips({
  sources,
  sourceErrors,
  t,
}: {
  sources: Record<ReplaySource, ReplaySourceState>;
  sourceErrors: ReplaySourceErrors;
  t: TFunction;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SOURCE_ORDER.map((source) => {
        const state = sources[source] ?? "empty";
        const failure = sourceErrors[source];
        const label = failure
          ? t("workHistory.replay.provenance.failed")
          : state === "denied"
            ? t("workHistory.replay.provenance.denied")
            : state === "ok"
              ? t("workHistory.replay.provenance.ok")
              : t("workHistory.replay.provenance.empty");
        return (
          <span
            key={source}
            // 소스 키는 식별자라 번역하지 않는다(locales/README 비번역 규칙).
            title={failure ?? undefined}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${sourceStateTone(
              state,
              !!failure,
            )}`}
          >
            {source} · {label}
          </span>
        );
      })}
    </div>
  );
}

export function ReplayHeadline({
  replay,
  sourceErrors,
  onShare,
  t,
}: {
  replay: MissionReplay;
  sourceErrors: ReplaySourceErrors;
  onShare?: (format: ReplayShareFormat) => void;
  t: TFunction;
}) {
  const denied = SOURCE_ORDER.filter(
    (source) => replay.provenance.sources[source] === "denied",
  );
  const failed = SOURCE_ORDER.filter((source) => !!sourceErrors[source]);

  return (
    <div
      data-testid="replay-accomplishment-hero"
      className="overflow-hidden rounded-2xl border border-violet-500/30 bg-[radial-gradient(700px_320px_at_78%_-30%,rgba(203,166,247,0.22),transparent_60%),linear-gradient(180deg,rgba(49,50,68,0.62),rgba(24,24,37,0.72))] p-5 shadow-2xl shadow-black/30"
    >
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">
        {t("workHistory.replay.hero.eyebrow")}
      </p>
      <h2 className="mt-3 max-w-xl text-3xl font-extrabold leading-tight tracking-normal text-gray-50">
        {t("workHistory.replay.hero.title", {
          count: replay.stats.tasksDone,
        })}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-gray-400">
        {replay.goal}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
        <span>
          {t("workHistory.replay.headline.template")}{" "}
          <span className="font-mono text-gray-300">{replay.templateId}</span>
        </span>
        <span>
          {t("workHistory.replay.headline.launched")}{" "}
          <span className="text-gray-300">
            {formatReplayTimestamp(replay.launchedAt)}
          </span>
        </span>
        <span>
          {t("workHistory.replay.headline.completed")}{" "}
          <span className="text-gray-300">
            {formatReplayTimestamp(replay.completedAt)}
          </span>
        </span>
        <span>
          {t("workHistory.replay.headline.duration")}{" "}
          <span className="text-gray-300">
            {formatReplayDuration(replay.stats.durationMs, t)}
          </span>
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <HeroStat
          label={t("workHistory.replay.stats.agents")}
          value={replay.stats.agents}
          tone="text-sky-300"
        />
        <HeroStat
          label={t("workHistory.replay.stats.tasks")}
          value={replay.stats.tasksDone}
          tone="text-emerald-300"
        />
        <HeroStat
          label={t("workHistory.replay.stats.prs")}
          value={replay.stats.prs}
          tone="text-violet-300"
        />
        <HeroStat
          label={t("workHistory.replay.stats.lines")}
          value={`+${replay.stats.linesAdded}/-${replay.stats.linesDeleted}`}
          tone="text-peach-300 text-orange-300"
        />
        <HeroStat
          label={t("workHistory.replay.stats.interventions")}
          value={replayHumanStepCount(replay)}
          tone="text-teal-300"
        />
      </div>

      {onShare && (
        <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950/70 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500">
            {t("workHistory.replay.shareBar.title")}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {SHARE_FORMATS.map((format) => {
              const implemented = isReplayShareFormatImplemented(format.key);
              return (
                <button
                  key={format.key}
                  type="button"
                  disabled={!implemented}
                  title={
                    implemented
                      ? t(format.hint)
                      : "이 형식은 아직 지원하지 않습니다."
                  }
                  onClick={() => {
                    if (implemented) onShare?.(format.key);
                  }}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    implemented
                      ? "border-gray-700 bg-gray-900 hover:border-violet-400 hover:bg-gray-800"
                      : "cursor-not-allowed border-gray-800 bg-gray-900/50 opacity-40"
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-gray-100">
                    <span aria-hidden>{format.icon}</span>
                    {t(format.label)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-500">
                    {implemented
                      ? t(format.hint)
                      : "곧 지원 예정 · 지금은 사용할 수 없습니다"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-gray-800 pt-2">
        <p className="mb-1.5 text-[11px] font-medium text-gray-500">
          {t("workHistory.replay.provenance.title")}
        </p>
        <ProvenanceChips
          sources={replay.provenance.sources}
          sourceErrors={sourceErrors}
          t={t}
        />
        {denied.length > 0 && (
          // "권한이 없어 못 읽었다" 를 "그런 일이 없었다" 로 읽히게 두지 않는다.
          <p className="mt-1.5 text-[11px] text-red-300">
            {t("workHistory.replay.provenance.deniedNote")}
          </p>
        )}
        {failed.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-300">
            {t("workHistory.replay.provenance.errorNote")}
          </p>
        )}
      </div>

      <p className="mt-2 text-[11px] text-gray-500">
        {t("workHistory.replay.privateNotice")}
      </p>
    </div>
  );
}

function HeroStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  const display =
    typeof value === "string" && value.length > 10
      ? value.slice(0, 9) + "…"
      : value;
  return (
    <div className="min-w-0 rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-2">
      <span
        className={`block min-w-0 truncate font-mono text-xl font-bold tabular-nums ${tone}`}
        title={typeof value === "string" ? value : undefined}
      >
        {display}
      </span>
      <span className="mt-0.5 block text-[11px] text-gray-500">{label}</span>
    </div>
  );
}
