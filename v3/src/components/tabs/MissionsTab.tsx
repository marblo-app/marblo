import { useEffect, useState } from "react";
import type { Mission, MissionTemplateId } from "../../types/mission";
import * as missionService from "../../services/missionService";
import { useProjectStore } from "../../stores/projectStore";
import { MissionList } from "../missions/MissionList";
import { MissionDetail } from "../missions/MissionDetail";
import { MissionTemplateCatalog } from "../missions/MissionTemplateCatalog";
import { MissionLaunchDialog } from "../missions/MissionLaunchDialog";
import { instantiateTemplateSteps } from "../missions/templates";

// Step 5 wiring 전 단계:
//   - LaunchDialog → missionService.createMission(status='planning')
//   - engine 이 main.ts wiring 되면 planning 미션을 자동 pickup 해서 active 로 전환.
//   - Pause/Resume/Abandon 은 임시로 missionService.setMissionStatus 만 호출 (engine
//     이 실제 task/agent 정리 책임).

export function MissionsTab() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id;
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // 선택된 mission 이 사라졌거나 없으면, 진행 중 mission 우선으로 자동 선택.
  useEffect(() => {
    if (selectedId && missions.some((m) => m.id === selectedId)) return;
    const candidate =
      missions.find(
        (m) => m.status === "waiting_for_human" || m.status === "active",
      ) ?? missions[0];
    setSelectedId(candidate?.id ?? null);
  }, [missions, selectedId]);

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
    setSelectedId(id);
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

  return (
    <div className="grid h-full grid-cols-[320px_1fr] gap-4 p-4">
      <aside className="space-y-4 overflow-y-auto pr-1">
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Active Missions
          </h2>
          <MissionList
            missions={active}
            selectedMissionId={selectedId}
            onSelect={setSelectedId}
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
              onSelect={setSelectedId}
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
