import { useEffect, useState } from "react";
import type { Mission, MissionTemplateId } from "../../types/mission";
import * as missionService from "../../services/missionService";
import { useProjectStore } from "../../stores/projectStore";
import { MissionList } from "../missions/MissionList";
import { MissionDetail } from "../missions/MissionDetail";
import { MissionTemplateCatalog } from "../missions/MissionTemplateCatalog";
import { MissionLaunchDialog } from "../missions/MissionLaunchDialog";
import { MissionOrchestratorPanel } from "../missions/MissionOrchestratorPanel";
import { instantiateTemplateSteps } from "../missions/templates";

// Step 5 wiring 전 단계:
//   - LaunchDialog → missionService.createMission(status='planning')
//   - engine 이 main.ts wiring 되면 planning 미션을 자동 pickup 해서 active 로 전환.
//   - Pause/Resume/Abandon 은 임시로 missionService.setMissionStatus 만 호출 (engine
//     이 실제 task/agent 정리 책임).

function isTerminalStatus(s: Mission["status"]): boolean {
  return s === "completed" || s === "abandoned";
}

export function MissionsTab() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id;
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 사용자가 명시적으로 클릭해서 선택한 ID — auto-switch 가 이걸 덮어쓰지 않음.
  // 사용자가 archive 미션을 보기 위해 클릭한 경우 새 active 가 떠도 자동 전환 안 함.
  const [userPickedId, setUserPickedId] = useState<string | null>(null);
  const [launchTemplate, setLaunchTemplate] =
    useState<MissionTemplateId | null>(null);

  useEffect(() => {
    if (!projectId) {
      setMissions([]);
      return;
    }
    const unsubscribe = missionService.subscribeToMissions(
      projectId,
      setMissions,
    );
    return () => unsubscribe();
  }, [projectId]);

  // 자동 선택 규칙:
  //   1. 사용자가 명시적으로 고른 ID 가 살아있으면 그대로 유지 (terminal 이어도).
  //   2. 그 외에는 현재 selected 가 비어있거나 사라졌거나 terminal 이면
  //      가장 활동적인 non-terminal mission 으로 전환.
  //   3. 후보가 없으면 selectedId=null → empty state 노출 → 새 미션 카드 보임.
  useEffect(() => {
    if (userPickedId) {
      const stillExists = missions.some((m) => m.id === userPickedId);
      if (stillExists) {
        if (selectedId !== userPickedId) setSelectedId(userPickedId);
        return;
      }
      // 사용자가 고른 미션이 삭제됐으면 user pick 도 cleared.
      setUserPickedId(null);
    }

    const current = selectedId
      ? (missions.find((m) => m.id === selectedId) ?? null)
      : null;

    // current 가 살아있고 non-terminal 이면 유지.
    if (current && !isTerminalStatus(current.status)) return;

    // current 가 사라졌거나 terminal → 가장 활동적인 mission 으로 자동 전환.
    const nonTerminal = missions.find((m) => !isTerminalStatus(m.status));
    const candidate =
      missions.find(
        (m) => m.status === "waiting_for_human" || m.status === "active",
      ) ?? nonTerminal;

    setSelectedId(candidate?.id ?? null);
  }, [missions, selectedId, userPickedId]);

  // 사용자가 list 에서 클릭 — userPickedId 도 함께 업데이트.
  const handleSelect = (id: string | null) => {
    setSelectedId(id);
    setUserPickedId(id);
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
        프로젝트를 선택하면 미션을 시작할 수 있습니다.
      </div>
    );
  }

  const active = missions.filter(
    (m) => m.status !== "completed" && m.status !== "abandoned",
  );
  const archive = missions.filter(
    (m) => m.status === "completed" || m.status === "abandoned",
  );
  const selected = missions.find((m) => m.id === selectedId) ?? null;

  const handleLaunch = async ({
    goal,
    templateId,
  }: {
    goal: string;
    templateId: MissionTemplateId;
  }) => {
    const steps = instantiateTemplateSteps(templateId);
    const id = await missionService.createMission({
      projectId,
      goal,
      templateId,
      status: "planning",
      // Step 5 wiring 시 engine.ensureSession 결과로 갱신.
      ownerOrchestratorSessionId: "pending",
      steps,
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [
        {
          ts: new Date(),
          type: "supervisor.note",
          payload: {
            message: `Mission queued · template=${templateId}`,
            goal,
          },
        },
      ],
    });
    setLaunchTemplate(null);
    // 새로 만든 미션은 사용자가 명시적으로 의도한 거니 user pick 도 동기화.
    setSelectedId(id);
    setUserPickedId(id);
  };

  const handleAbandon = async (missionId: string) => {
    await missionService.setMissionStatus(missionId, "abandoned", {
      abandonedReason: "user_abandoned",
    });
    await missionService.appendTimelineEvent(missionId, {
      ts: new Date(),
      type: "mission.paused",
      payload: { kind: "abandoned", reason: "user_abandoned" },
    });
  };

  const handlePause = async (missionId: string) => {
    await missionService.setMissionStatus(missionId, "sleeping");
    await missionService.appendTimelineEvent(missionId, {
      ts: new Date(),
      type: "mission.paused",
      payload: { kind: "paused_by_user" },
    });
  };

  const handleResume = async (missionId: string) => {
    await missionService.setMissionStatus(missionId, "active");
    await missionService.appendTimelineEvent(missionId, {
      ts: new Date(),
      type: "mission.resumed",
      payload: { by: "user" },
    });
  };

  // 같은 goal + template 로 새 미션 생성. abandoned/completed 카드에서 호출.
  // 기존 archive 항목은 그대로 두고 새 mission 이 active 로 떠서 사용자가 그쪽을 본다.
  const handleRestart = async (source: Mission) => {
    if (!projectId) return;
    const steps = instantiateTemplateSteps(source.templateId);
    const id = await missionService.createMission({
      projectId,
      goal: source.goal,
      templateId: source.templateId,
      status: "planning",
      ownerOrchestratorSessionId: "pending",
      steps,
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [
        {
          ts: new Date(),
          type: "supervisor.note",
          payload: {
            message: `Re-run from ${source.id.slice(0, 8)} · template=${source.templateId}`,
            goal: source.goal,
          },
        },
      ],
    });
    // user pick 도 새 mission 으로 — 자동 전환 로직과 일관성 유지.
    setSelectedId(id);
    setUserPickedId(id);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <MissionOrchestratorPanel />
      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-4">
        <aside className="space-y-4 overflow-y-auto pr-1">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Active Missions
            </h2>
            <MissionList
              missions={active}
              selectedMissionId={selectedId}
              onSelect={handleSelect}
              onAbandon={handleAbandon}
            />
          </div>
          {archive.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Archive
              </h2>
              <MissionList
                missions={archive}
                selectedMissionId={selectedId}
                onSelect={handleSelect}
                onAbandon={() => {
                  /* archive 는 abandon 불가 */
                }}
              />
            </div>
          )}
        </aside>

        <main className="space-y-6 overflow-y-auto">
          {selected ? (
            <MissionDetail
              mission={selected}
              onPause={handlePause}
              onResume={handleResume}
              onAbandon={handleAbandon}
              onRestart={handleRestart}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <p className="text-sm text-gray-300">선택된 미션이 없습니다.</p>
              <p className="mt-1 text-xs text-gray-500">
                아래에서 템플릿을 골라 새 미션을 시작하세요.
              </p>
            </div>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-200">
                새 미션 시작
              </h2>
              <p className="text-xs text-gray-500">
                템플릿을 누르면 한 줄 목표를 입력하는 화면이 뜹니다.
              </p>
            </div>
            <MissionTemplateCatalog
              onSelect={(id) => setLaunchTemplate(id)}
              highlighted={launchTemplate}
            />
          </section>
        </main>
      </div>

      {launchTemplate && (
        <MissionLaunchDialog
          initialTemplateId={launchTemplate}
          onCancel={() => setLaunchTemplate(null)}
          onLaunch={handleLaunch}
        />
      )}
    </div>
  );
}
