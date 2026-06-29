import { useEffect, useState } from "react";
import type {
  Mission,
  MissionAccessMode,
  MissionTargetRepository,
  MissionTemplateId,
} from "../../types/mission";
import * as missionService from "../../services/missionService";
import * as taskService from "../../services/taskService";
import { useProjectStore } from "../../stores/projectStore";
import { MissionList } from "../missions/MissionList";
import { MissionDetail } from "../missions/MissionDetail";
import { MissionTemplateCatalog } from "../missions/MissionTemplateCatalog";
import { MissionLaunchDialog } from "../missions/MissionLaunchDialog";
import { MissionOrchestratorPanel } from "../missions/MissionOrchestratorPanel";
import { instantiateTemplateSteps } from "../missions/templates";
import { useTranslation } from "../../lib/i18n";

// Step 5 wiring 전 단계:
//   - LaunchDialog → missionService.createMission(status='planning')
//   - engine 이 main.ts wiring 되면 planning 미션을 자동 pickup 해서 active 로 전환.
//   - Pause/Resume/Abandon 은 임시로 missionService.setMissionStatus 만 호출 (engine
//     이 실제 task/agent 정리 책임).

function isTerminalStatus(s: Mission["status"]): boolean {
  return s === "completed" || s === "abandoned";
}

export function MissionsTab() {
  const { t } = useTranslation();
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
      setMissions
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
      ? missions.find((m) => m.id === selectedId) ?? null
      : null;

    // current 가 살아있고 non-terminal 이면 유지.
    if (current && !isTerminalStatus(current.status)) return;

    // current 가 사라졌거나 terminal → 가장 활동적인 mission 으로 자동 전환.
    const nonTerminal = missions.find((m) => !isTerminalStatus(m.status));
    const candidate =
      missions.find(
        (m) => m.status === "waiting_for_human" || m.status === "active"
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
        {t("missions.tab.noProject")}
      </div>
    );
  }

  const active = missions.filter(
    (m) => m.status !== "completed" && m.status !== "abandoned"
  );
  const archive = missions.filter(
    (m) => m.status === "completed" || m.status === "abandoned"
  );
  const selected = missions.find((m) => m.id === selectedId) ?? null;
  // 미션 오케스트레이터 패널이 종속될 미션. 선택 미션이 터미널(완료/포기)이면
  // 새 오케를 띄울 필요가 없으니 null. 그 외(진행중·planning, 또는 방금 만들어
  // 아직 list 에 없는 신규 미션 → selected=null 이지만 selectedId 존재)는 selectedId.
  const focusedMissionId =
    selected && isTerminalStatus(selected.status) ? null : selectedId;

  const handleLaunch = async ({
    goal,
    templateId,
    targetRepository,
    targetBranch,
    targetAccessMode,
  }: {
    goal: string;
    templateId: MissionTemplateId;
    targetRepository?: MissionTargetRepository;
    targetBranch?: string;
    targetAccessMode?: MissionAccessMode;
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
      targetRepository,
      targetBranch,
      targetAccessMode,
      contextLog: [
        {
          ts: new Date(),
          type: "supervisor.note",
          payload: {
            message: `Mission queued · template=${templateId}`,
            goal,
            targetRepository,
            targetBranch,
            targetAccessMode,
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
    // 미션이 terminal 로 가면 그 미션에 바인딩된 오케도 동반 중지. main 가드가
    // getOwnerMissionId 일치할 때만 stop 하므로 무관 미션이면 no-op. fire-and-forget.
    if (projectId) {
      window.electronAPI?.missionOrchestrator?.stopForMission(
        projectId,
        missionId
      );
    }
    // 대표 보드 카드도 FAILED 로 동기화(있을 때만). 메타카드라 상태머신을 우회해
    // 직접 set (conductor setCardStatus 와 동일 컨벤션). best-effort.
    const cardId = missions.find((m) => m.id === missionId)?.missionCardTaskId;
    if (cardId) {
      try {
        await taskService.updateTask(cardId, { status: "FAILED" });
      } catch {
        /* best-effort — 카드 동기화 실패가 어밴던을 막지 않음 */
      }
    }
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
      targetRepository: source.targetRepository,
      targetBranch: source.targetBranch,
      targetAccessMode: source.targetAccessMode,
      contextLog: [
        {
          ts: new Date(),
          type: "supervisor.note",
          payload: {
            message: `Re-run from ${source.id.slice(0, 8)} · template=${
              source.templateId
            }`,
            goal: source.goal,
          },
        },
      ],
    });
    // user pick 도 새 mission 으로 — 자동 전환 로직과 일관성 유지.
    setSelectedId(id);
    setUserPickedId(id);
  };

  // 미션 문서를 영구 삭제. 선택 중이던 미션이면 선택을 해제해 auto-select effect 가
  // 다음 후보를 고르도록 한다(빈 상태면 새 미션 카드 노출).
  const handleDelete = async (missionId: string) => {
    // 미션 doc 삭제 전에 대표 카드 id 를 캡처(삭제 후엔 missions 에서 사라짐).
    const cardId = missions.find((m) => m.id === missionId)?.missionCardTaskId;
    await missionService.deleteMission(missionId);
    if (selectedId === missionId) setSelectedId(null);
    if (userPickedId === missionId) setUserPickedId(null);
    // 삭제된 미션에 바인딩된 오케도 동반 중지 (main 가드로 무관 미션은 no-op).
    if (projectId) {
      window.electronAPI?.missionOrchestrator?.stopForMission(
        projectId,
        missionId
      );
    }
    // 대표 보드 카드도 함께 삭제 — 안 그러면 보드에 고아 카드가 남는다. best-effort.
    if (cardId) {
      try {
        await taskService.deleteTask(cardId);
      } catch {
        /* best-effort */
      }
    }
  };

  // 아카이브(완료/포기) 미션을 한 번에 정리 — 겹치는 미션이 쌓였을 때.
  const handleClearArchive = async () => {
    if (archive.length === 0) return;
    if (
      !confirm(t("missions.tab.clearArchiveConfirm", { count: archive.length }))
    ) {
      return;
    }
    const ids = archive.map((m) => m.id);
    // 대표 카드 id 들도 미리 캡처해 함께 삭제(고아 카드 방지). best-effort.
    const cardIds = archive
      .map((m) => m.missionCardTaskId)
      .filter((c): c is string => !!c);
    await Promise.all(ids.map((id) => missionService.deleteMission(id)));
    await Promise.all(
      cardIds.map((c) => taskService.deleteTask(c).catch(() => {}))
    );
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    if (userPickedId && ids.includes(userPickedId)) setUserPickedId(null);
    // 아카이브 미션은 보통 오케 바인딩이 없어 no-op 이지만, 만약 바인딩돼 있으면
    // main 가드가 그 미션 오케만 중지 (무관 오케 보존). 안전상 각 id 에 호출.
    if (projectId) {
      for (const id of ids) {
        window.electronAPI?.missionOrchestrator?.stopForMission(projectId, id);
      }
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <MissionOrchestratorPanel missionId={focusedMissionId} />
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
              onDelete={handleDelete}
            />
          </div>
          {archive.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Archive
                </h2>
                <button
                  type="button"
                  onClick={handleClearArchive}
                  className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                  title={t("missions.tab.clearArchiveTitle")}
                >
                  {t("missions.tab.clearArchive")}
                </button>
              </div>
              <MissionList
                missions={archive}
                selectedMissionId={selectedId}
                onSelect={handleSelect}
                onAbandon={() => {
                  /* archive 는 abandon 불가 */
                }}
                onDelete={handleDelete}
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
              onDelete={handleDelete}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/30 p-6 text-center">
              <p className="text-sm text-gray-300">
                {t("missions.tab.noSelection")}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t("missions.tab.noSelectionHint")}
              </p>
            </div>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-200">
                {t("missions.tab.newMissionHeading")}
              </h2>
              <p className="text-xs text-gray-500">
                {t("missions.tab.newMissionHint")}
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
          projectId={projectId}
          initialTemplateId={launchTemplate}
          onCancel={() => setLaunchTemplate(null)}
          onLaunch={handleLaunch}
        />
      )}
    </div>
  );
}
