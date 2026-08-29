import { useState, useEffect } from "react";
import AgentDashboard from "../agents/AgentDashboard";
import AgentAddModal from "../agents/AgentAddModal";
import { AssistantTriggerSettingsPanel } from "../agents/AssistantTriggerSettingsPanel";
import { MarbloBotGallery } from "../agents/MarbloBotGallery";
import { useAgentStore } from "../../stores/agentStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useUiStore } from "../../stores/uiStore";
import { useAuth } from "../../hooks/useAuth";
import { checkAgentSpawn } from "../../lib/planLimits";
import type { Agent, ModelType } from "../../types/agent";
import * as agentService from "../../services/agentService";
import { reportOnrampExecBlocked } from "../../services/onrampBlockSignal";
import { useTranslation } from "../../lib/i18n";

type AgentsTabMode = "marbloBots" | "fleet";

export function AgentsTab() {
  return <AgentsTabSurface mode="marbloBots" />;
}

export function AgentFleetTab() {
  return <AgentsTabSurface mode="fleet" />;
}

function AgentsTabSurface({ mode }: { mode: AgentsTabMode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);
  const loading = useAgentStore((s) => s.loading);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const stopAgent = useAgentStore((s) => s.stopAgent);
  const restartAgent = useAgentStore((s) => s.restartAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const tasks = useTaskStore((s) => s.tasks);
  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeSection, setActiveSection] = useState<
    "bots" | "agents" | "triggers"
  >("bots");

  const projectId = currentProject?.id || "";

  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeToAgents(projectId);
    return unsub;
  }, [projectId, subscribeToAgents]);

  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeToTasks(projectId);
    return unsub;
  }, [projectId, subscribeToTasks]);

  // Consume cross-tab agent jump (Activity Stream "🤖 에이전트 보기").
  // We scroll the matching card into view and flash a purple ring for ~1.4s.
  // Done via DOM rather than state-prop-drilling — one feature, one effect.
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump || pendingJump.type !== "agent") return;
    if (agents.length === 0) return; // wait for subscription to deliver data
    const id = pendingJump.id;
    consumeJump();
    requestAnimationFrame(() => {
      const el = document.getElementById(`agent-card-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[#cba6f7]");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-[#cba6f7]");
      }, 1400);
    });
  }, [pendingJump, agents, consumeJump]);

  const handleLaunch = async (data: {
    name: string;
    model: ModelType;
    role: string;
    command: string;
    cwd: string;
    initialPrompt?: string;
    assignedTaskId?: string;
    /** local(Ollama) 설치 실측 모델 핀 — AgentAddModal 이 목록에서 고른 값. */
    modelPin?: string;
  }) => {
    if (!user || !projectId) return;
    // Plan throttle: gate before creating the Firestore doc. handleLaunch
    // bypasses agentStore.createAgent (it calls the service directly), so
    // we re-check here. Source of truth: lib/planLimits.ts.
    const plan = useSubscriptionStore.getState().getPlan();
    const check = checkAgentSpawn(plan, agents);
    if (!check.allowed) {
      // Free hit the fair-use agent cap → open the upgrade modal (routes to
      // Settings → Billing) instead of a dead-end alert.
      useUiStore.getState().showUpgrade("agents", "pro");
      return;
    }
    const agentData = {
      projectId,
      ownerId: user.uid,
      name: data.name,
      model: data.model,
      role: data.role,
      status: "idle" as const,
      currentTaskId: data.assignedTaskId || null,
      command: data.command,
      skillFile: "",
    };
    const id = await agentService.createAgent(agentData);
    const agent = { ...agentData, id, createdAt: new Date() } as Agent;
    try {
      const result = await window.electronAPI.agent.launch(
        agent,
        data.cwd,
        data.initialPrompt,
        undefined,
        projectId,
        data.assignedTaskId,
        data.modelPin,
      );
      // Spawn blocked: this model's CLI is not installed / not logged in.
      // Open the CLI setup gate rather than attaching an empty terminal.
      if (result?.needsAuth) {
        // ★온램프 축에도 보고한다(설계 #886 §5-A). 계정이 아직 없는 유저에게
        // 위저드만 여는 것은 "왜" 를 말해 주지 않는다 — M1 이 그 몫이고, 이미
        // 연결된 유저에게는 이 호출이 스스로 억제된다.
        reportOnrampExecBlocked(result.needsAuth, "spawn_needs_auth");
        window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
        return;
      }
      // 실제로 뜬 구체 모델(model@effort)을 doc 에 남긴다 — 목록/보드가 벤더
      // 대신 이 값을 배지로 보여준다. 핀 없는 launch 면 no-op.
      agentService.stampSpawnedModel(id, result?.spawnedModel);
      // 에이전트 실행 즉시 터미널 탭 자동 연결 (출력 유실 방지)
      const MODEL_ICONS: Record<string, string> = {
        claude: "🟣",
        gemini: "🔵",
        gpt: "🟢",
        antigravity: "🟠",
        local: "⚫",
        custom: "⚪",
      };
      useTerminalStore
        .getState()
        .attachSession(
          result.ptySessionId,
          `${MODEL_ICONS[data.model] || "⚪"} ${data.name}`,
        );
    } catch (err) {
      console.error("Agent launch failed:", err);
    }
  };

  // Throttle indicator — visible badge so the user always knows their
  // remaining slots before they hit "Add Agent". Re-computes on every
  // agents/subscription change via store subscriptions.
  const planForBadge = useSubscriptionStore((s) => s.getPlan());
  const throttle = checkAgentSpawn(planForBadge, agents);
  const atLimit = !throttle.allowed;
  const selectedProject = currentProject;
  const sectionTabs = [
    ["bots", t("agents.marbloBots.section.bots")],
    ["agents", t("agents.marbloBots.section.agents")],
    ["triggers", t("agents.marbloBots.section.triggers")],
  ] as const;

  // No project selected → "Add agent" (header, empty-state, and the terminal
  // panel's "+ Spawn agent" that routes here) would open a modal gated on
  // `user && projectId` and silently no-op. Show a dedicated CTA that opens a
  // project first (same folder-pick flow as the sidebar), so there's no
  // dead-end. Placed after all hooks to keep hook order stable.
  if (!projectId || !selectedProject) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-gray-400">
        <div>
          <p className="text-lg font-medium">{t("agents.noProject.title")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            {t("agents.noProject.desc")}
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("marblo:select-folder"))
            }
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            {t("agents.noProject.cta")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {throttle.limit > 0 && (
        <div
          className={`flex items-center justify-between border-b px-4 py-1.5 text-xs ${
            atLimit
              ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8]"
              : "border-[#313244] bg-[#181825] text-[#bac2de]"
          }`}
        >
          <span>
            {t("agents.tab.activeCount", {
              active: throttle.active,
              limit: throttle.limit,
            })}{" "}
            · <span className="uppercase">{planForBadge}</span>{" "}
            {t("agents.tab.plan")}
          </span>
          {atLimit && (
            <span className="text-[10px]">{t("agents.tab.atLimitHint")}</span>
          )}
        </div>
      )}
      {mode === "marbloBots" && (
        <div
          role="tablist"
          aria-label={t("agents.marbloBots.tabAria")}
          className="flex flex-shrink-0 items-center gap-1 border-b border-gray-700 bg-gray-900 px-4"
        >
          {sectionTabs.map(([id, label]) => {
            const selected = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() =>
                  setActiveSection(id as "bots" | "agents" | "triggers")
                }
                className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  selected
                    ? "border-blue-500 text-gray-100"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {mode === "fleet" ? (
          <AgentDashboard
            agents={agents}
            tasks={tasks}
            projectId={projectId}
            loading={loading}
            scope="all"
            onAddAgent={() => {
              if (atLimit) {
                useUiStore.getState().showUpgrade("agents", "pro");
                return;
              }
              setShowAddModal(true);
            }}
            onStop={stopAgent}
            onRestart={restartAgent}
            onDelete={deleteAgent}
          />
        ) : activeSection === "bots" ? (
          user ? (
            <MarbloBotGallery project={selectedProject} ownerId={user.uid} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-500">
              {t("agents.marbloBots.loginRequired")}
            </div>
          )
        ) : activeSection === "triggers" ? (
          <AssistantTriggerSettingsPanel project={selectedProject} />
        ) : (
          <AgentDashboard
            agents={agents}
            tasks={tasks}
            projectId={projectId}
            loading={loading}
            scope="bot"
            onAddAgent={() => {
              if (atLimit) {
                useUiStore.getState().showUpgrade("agents", "pro");
                return;
              }
              setShowAddModal(true);
            }}
            onStop={stopAgent}
            onRestart={restartAgent}
            onDelete={deleteAgent}
          />
        )}
      </div>

      {showAddModal && user && projectId && (
        <AgentAddModal
          projectId={projectId}
          ownerId={user.uid}
          tasks={tasks}
          onLaunch={handleLaunch}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
