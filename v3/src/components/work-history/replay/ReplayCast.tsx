/**
 * Mission Replay — 에이전트별 기여 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §1.1 / §2.2.
 *
 * `agentRef` 는 이미 **미션 내 익명 별칭**(`agent-1 · claude`)이다 — 원 agentId 는
 * 비트에도 캐스트에도 없다(`lib/replay/beats.ts` createReplayAliases, 설계 R10).
 * 그래서 이 표는 그대로 그려도 재식별 표면을 만들지 않는다.
 *
 * 모델 칸은 `detectedModelId`(관측=무엇이 실제로 과금됐나) → `spawnedModel`
 * (요청=무엇으로 띄웠나) 순으로 떨어진다. 관측이 요청보다 강한 증거라는
 * `types/agent.ts` 의 규칙을 화면에서도 같게 지킨다.
 */

import type { TFunction } from "../../../lib/i18n";
import type { ReplayCastMember } from "../../../types/missionReplay";

/**
 * Cast marquee: slow (75s / cycle), 2 passes then stop. Pause on hover.
 * `prefers-reduced-motion` drops animation and wraps statically.
 */
const CAST_SCROLL_DURATION_S = 75;
const CAST_SCROLL_ITERATIONS = 2;

export function ReplayCast({
  cast,
  t,
}: {
  cast: readonly ReplayCastMember[];
  t: TFunction;
}) {
  // Duplicate only when scrolling makes sense (>8 members); still need a
  // seamless half-strip for the -50% translate keyframes.
  const shouldMarquee = cast.length > 8;
  const strip = shouldMarquee ? [...cast, ...cast] : cast;
  return (
    <section>
      <style>
        {`
          @keyframes replay-cast-scroll{
            from{transform:translateX(0)}
            to{transform:translateX(-50%)}
          }
          @media (prefers-reduced-motion: no-preference) {
            .replay-cast-track--marquee{
              animation: replay-cast-scroll ${CAST_SCROLL_DURATION_S}s linear ${CAST_SCROLL_ITERATIONS} both;
            }
            .replay-cast-track--marquee:hover{
              animation-play-state: paused;
            }
          }
        `}
      </style>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-300">
          {t("workHistory.replay.cast.title")}
        </h3>
        <span className="font-mono text-[11px] text-gray-500">
          {t("workHistory.replay.cast.count", { count: cast.length })}
        </span>
      </div>

      {cast.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 px-3 py-4 text-center text-xs text-gray-500">
          {t("workHistory.replay.cast.empty")}
        </p>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-950/60">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-gray-950/95 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-gray-950/95 to-transparent" />
          <div
            className={
              shouldMarquee
                ? "replay-cast-track--marquee flex w-max gap-2 px-3 py-3 motion-reduce:w-auto motion-reduce:flex-wrap motion-reduce:animate-none"
                : "flex w-max max-w-full flex-wrap gap-2 px-3 py-3"
            }
          >
            {strip.map((member, index) => {
              const model =
                member.detectedModelId ?? member.spawnedModel ?? member.vendor;
              const initials = member.role.slice(0, 2).toUpperCase();
              return (
                <div
                  key={`${member.agentRef}-${index}`}
                  className="flex min-w-[210px] flex-shrink-0 items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-2 py-1.5 shadow-sm"
                >
                  <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-300 to-sky-300 font-mono text-[10px] font-bold text-gray-950">
                    {initials || "AI"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] font-semibold text-gray-100">
                      {member.agentRef}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-gray-500">
                      {model} · {member.tasksCompleted}{" "}
                      {t("workHistory.replay.cast.tasksShort")} · {member.beats}{" "}
                      {t("workHistory.replay.cast.beatsShort")}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
