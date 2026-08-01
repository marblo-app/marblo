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

export function ReplayCast({
  cast,
  t,
}: {
  cast: readonly ReplayCastMember[];
  t: TFunction;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-gray-300">
        {t("workHistory.replay.cast.title")}
      </h3>

      {cast.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-700 bg-gray-800/30 px-3 py-4 text-center text-xs text-gray-500">
          {t("workHistory.replay.cast.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-gray-900/60 text-[11px] text-gray-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">
                  {t("workHistory.replay.cast.agent")}
                </th>
                <th className="px-3 py-1.5 font-medium">
                  {t("workHistory.replay.cast.model")}
                </th>
                <th className="px-3 py-1.5 font-medium">
                  {t("workHistory.replay.cast.role")}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t("workHistory.replay.cast.tasks")}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t("workHistory.replay.cast.beats")}
                </th>
              </tr>
            </thead>
            <tbody>
              {cast.map((member) => (
                <tr
                  key={member.agentRef}
                  className="border-t border-gray-800 text-gray-300"
                >
                  {/* 별칭·모델 id·역할 코드는 전부 식별자라 번역하지 않는다. */}
                  <td className="px-3 py-1.5 font-mono text-[11px] text-gray-200">
                    {member.agentRef}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-gray-400">
                    {member.detectedModelId ?? member.spawnedModel ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-gray-400">
                    {member.role}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px]">
                    {member.tasksCompleted}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px]">
                    {member.beats}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
