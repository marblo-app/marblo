import { useState, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useWorkspaceModeStore } from "../../stores/workspaceModeStore";
import { useBeginnerModeStore } from "../../stores/beginnerModeStore";
import { useCoachmarkStore } from "../../stores/coachmarkStore";
import { BEGINNER_TOUR_ID } from "../../lib/coachmark";
import telemetry from "../../services/telemetryService";
import { useProjectStore } from "../../stores/projectStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import {
  ORCHESTRATOR_HARNESS_DESC,
  ORCHESTRATOR_HARNESS_OPTIONS,
  useOrchestratorStore,
  orchestratorModelProvider,
} from "../../stores/orchestratorStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useUiStore } from "../../stores/uiStore";
import { useTranslation } from "../../lib/i18n";
import { BillingPage } from "./BillingPage";
import { TeamManagement } from "./TeamManagement";
import { PlanGate } from "./PlanGate";
import { APIKeysSettings } from "./APIKeysSettings";
import { VendorKeysSettings } from "./VendorKeysSettings";
import { PrivacySettings } from "./PrivacySettings";
import { BugReportModal } from "./BugReportModal";
import { AdminAnalyticsPanel } from "./AdminAnalyticsPanel";

type SettingsTab =
  | "profile"
  | "adminAnalytics"
  | "models"
  | "billing"
  | "team"
  | "apikeys"
  | "privacy"
  | "language"
  | "bugreport";

interface TabSpec {
  id: SettingsTab;
  labelKey:
    | "settings.tab.profile"
    | "settings.tab.adminAnalytics"
    | "settings.tab.models"
    | "settings.tab.billing"
    | "settings.tab.team"
    | "settings.tab.privacy"
    | "settings.tab.apikeys"
    | "settings.tab.language"
    | "bugReport.tab";
  icon?: React.ReactNode;
}

const TABS: TabSpec[] = [
  { id: "profile", labelKey: "settings.tab.profile" },
  { id: "adminAnalytics", labelKey: "settings.tab.adminAnalytics" },
  { id: "models", labelKey: "settings.tab.models" },
  { id: "billing", labelKey: "settings.tab.billing" },
  { id: "team", labelKey: "settings.tab.team" },
  { id: "privacy", labelKey: "settings.tab.privacy" },
  { id: "language", labelKey: "settings.tab.language" },
  { id: "bugreport", labelKey: "bugReport.tab" },
  {
    id: "apikeys",
    labelKey: "settings.tab.apikeys",
    icon: (
      <svg
        className="mr-1.5 inline h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z"
        />
      </svg>
    ),
  },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const getPlan = useSubscriptionStore((s) => s.getPlan);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Deep-link from the Upgrade modal (or any caller) to a specific section,
  // e.g. Billing. Consume the latch whenever it appears so the sub-tab is
  // selected even if this page is already mounted.
  const pendingSettingsSection = useUiStore((s) => s.pendingSettingsSection);
  const consumeSettingsSection = useUiStore((s) => s.consumeSettingsSection);
  useEffect(() => {
    if (!pendingSettingsSection) return;
    setActiveTab(pendingSettingsSection as SettingsTab);
    consumeSettingsSection();
  }, [pendingSettingsSection, consumeSettingsSection]);

  const plan = getPlan();

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">
            {t("settings.title")}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              plan === "team"
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                : plan === "pro"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
            }`}
          >
            {plan.toUpperCase()} {t("header.planBadge.suffix")}
          </span>
        </div>

        {/* Tab navigation */}
        <div className="mb-6 flex border-b border-gray-700">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "profile" && <ProfileSection />}
        {activeTab === "adminAnalytics" && <AdminAnalyticsPanel />}
        {activeTab === "models" && <ModelPresetSection />}
        {activeTab === "billing" && <BillingPage />}
        {activeTab === "team" &&
          (currentProject ? (
            <PlanGate feature="team_members">
              {/* 같은 <TeamManagement /> 가 프로젝트 탭에도 걸려 있다 — 그쪽은
                  여기에 없는 구성원별 작업량까지 함께 보여주므로 길만 열어 준다
                  (UI 복제 아님). 레거시 Layout 에는 프로젝트 탭이 없으므로 셸이
                  켜져 있을 때만 노출한다. */}
              <ProjectTabPointer />
              <TeamManagement projectId={currentProject.id} />
            </PlanGate>
          ) : (
            <div className="py-12 text-center text-sm text-gray-500">
              {t("settings.team.selectProjectFirst")}
            </div>
          ))}
        {activeTab === "apikeys" && (
          // 벤더(env-swap) 키를 먼저 둔다 — 에이전트 스폰이 실제로 막히는 쪽이라
          // Flow 엔진용 BYOK 키보다 사용자가 찾을 일이 잦다.
          <div className="space-y-6">
            <VendorKeysSettings />
            <APIKeysSettings />
          </div>
        )}
        {activeTab === "privacy" && <PrivacySettings />}
        {activeTab === "language" && <LanguageSection />}
        {activeTab === "bugreport" && <BugReportSection />}
      </div>
    </div>
  );
}

/**
 * Settings → Team 에서 프로젝트 탭으로 보내는 안내 줄. 초대·역할 UI 자체는
 * 두 화면이 <TeamManagement /> 하나를 공유하므로, 여기서 굳이 다시 그리지 않고
 * "작업량까지 보려면 저쪽" 만 알려 준다.
 *
 * 레거시 Layout(워크스페이스 셸 OFF)에는 프로젝트 탭이 없어 이동시킬 곳이 없다
 * — 그때는 아무것도 렌더하지 않는다(막다른 버튼 금지).
 */
function ProjectTabPointer() {
  const { t } = useTranslation();
  const shellEnabled = useWorkspaceModeStore((s) => s.enabled);
  if (!shellEnabled) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700 bg-gray-800/60 px-4 py-2.5">
      <span className="text-xs text-gray-400">
        {t("settings.team.projectTabHint")}
      </span>
      <button
        type="button"
        onClick={() =>
          useSplitWorkspaceStore.getState().setActiveTab("project")
        }
        className="rounded border border-gray-600 px-3 py-1 text-xs font-medium text-gray-200 transition-colors hover:border-blue-500 hover:text-blue-400"
      >
        {t("settings.team.projectTabCta")}
      </button>
    </div>
  );
}

function ProfileSection() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-200">
          {t("settings.profile.heading")}
        </h3>
        <div className="flex items-center gap-4">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="h-16 w-16 rounded-full"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-xl font-medium text-white">
              {user?.displayName?.[0] || user?.email?.[0] || "?"}
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-white">
              {user?.displayName || "User"}
            </p>
            <p className="text-sm text-gray-400">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-4 text-sm font-medium text-gray-200">
          {t("settings.account.heading")}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400">
              {t("settings.account.name")}
            </label>
            <p className="mt-1 text-sm text-gray-200">
              {user?.displayName || "-"}
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-400">
              {t("settings.account.email")}
            </label>
            <p className="mt-1 text-sm text-gray-200">{user?.email || "-"}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400">
              {t("settings.account.uid")}
            </label>
            <p className="mt-1 font-mono text-xs text-gray-500">{user?.uid}</p>
          </div>
        </div>
      </div>

      <BeginnerModeSection />
      <WorkspaceModeSection />
    </div>
  );
}

/**
 * 비기너 모드 되돌리기 (설계 v3/docs/BEGINNER-MODE-DESIGN.md §7).
 *
 * 승격은 한 방향 문이 아니다 — 여기서 언제든 다시 큰 대화창 하나짜리 화면으로
 * 갈 수 있다. 이 화면은 어드밴스드에서만 보이므로(비기너 셸엔 설정 탭이 없다)
 * 토글의 의미는 항상 "비기너로 가기" 다.
 */
function BeginnerModeSection() {
  const { t } = useTranslation();
  const beginner = useBeginnerModeStore((s) => s.state) === "beginner";
  const revertToBeginner = useBeginnerModeStore((s) => s.revertToBeginner);
  const promote = useBeginnerModeStore((s) => s.promote);
  // 첫 실행 코치마크 투어를 다시 볼 수 있는 유일한 문 — '다시 보지 않기' 를 누른
  // 유저에게 되돌릴 방법이 없으면 그건 실수 한 번으로 닫히는 막다른 길이다.
  const resetTour = useCoachmarkStore((s) => s.resetTour);
  const [tourReset, setTourReset] = useState(false);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="mb-1 text-sm font-medium text-gray-200">
            {t("beginner.settings.heading")}
          </h3>
          <p className="text-xs leading-relaxed text-gray-500">
            {t("beginner.settings.body")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          data-testid="settings-beginner-toggle"
          aria-checked={beginner}
          aria-label={t("beginner.settings.heading")}
          onClick={() => {
            if (beginner) {
              telemetry.beginnerPromoted("manual", true);
              promote("manual");
            } else {
              revertToBeginner();
            }
          }}
          className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            beginner ? "bg-blue-600" : "bg-gray-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              beginner ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-gray-400">
        {beginner ? t("beginner.settings.off") : t("beginner.settings.on")}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {t("beginner.settings.restartHint")}
      </p>
      <button
        type="button"
        data-testid="settings-replay-tour"
        onClick={() => {
          resetTour(BEGINNER_TOUR_ID);
          setTourReset(true);
        }}
        className="mt-3 rounded-md border border-gray-600 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-700"
      >
        {t("beginner.settings.replayTour")}
      </button>
      {tourReset && (
        <p className="mt-1.5 text-xs text-green-400">
          {t("beginner.settings.replayTourDone")}
        </p>
      )}
    </div>
  );
}

function WorkspaceModeSection() {
  const { t } = useTranslation();
  const enabled = useWorkspaceModeStore((s) => s.enabled);
  const setEnabled = useWorkspaceModeStore((s) => s.setEnabled);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="mb-1 text-sm font-medium text-gray-200">
            {t("workspace.settings.heading")}
          </h3>
          <p className="text-xs leading-relaxed text-gray-500">
            {t("workspace.settings.help")}
          </p>
        </div>
        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("workspace.settings.toggleLabel")}
          onClick={() => setEnabled(!enabled)}
          className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            enabled ? "bg-blue-600" : "bg-gray-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="mt-2 text-xs font-medium text-gray-400">
        {enabled ? t("workspace.settings.on") : t("workspace.settings.off")}
      </p>
    </div>
  );
}

function LanguageSection() {
  const { t, locale, setLocale } = useTranslation();
  const OPTIONS: {
    id: "ko" | "en";
    labelKey: "settings.language.korean" | "settings.language.english";
  }[] = [
    { id: "ko", labelKey: "settings.language.korean" },
    { id: "en", labelKey: "settings.language.english" },
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          {t("settings.language.heading")}
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          {t("settings.language.help")}
        </p>
        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setLocale(opt.id)}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                locale === opt.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 hover:border-gray-600 hover:bg-gray-700/50"
              }`}
            >
              <span className="text-xl">{opt.id === "ko" ? "🇰🇷" : "🇺🇸"}</span>
              <div className="flex-1">
                <span
                  className={`text-sm font-medium ${
                    locale === opt.id ? "text-blue-400" : "text-gray-200"
                  }`}
                >
                  {t(opt.labelKey)}
                </span>
                <p className="text-xs text-gray-500">{opt.id.toUpperCase()}</p>
              </div>
              {locale === opt.id && (
                <svg
                  className="h-5 w-5 text-blue-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BugReportSection() {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          {t("bugReport.heading")}
        </h3>
        <p className="mb-4 text-xs text-gray-500">{t("bugReport.help")}</p>
        <button
          onClick={() => setShowModal(true)}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          🐛 {t("bugReport.button")}
        </button>
      </div>
      {showModal && <BugReportModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

/**
 * 프리셋 목록은 여기서 만들지 않는다 — `modelPreset:list` IPC 가
 * `electron/dispatch-scoring.MODEL_PRESETS`(dispatch 라우팅이 실제로 읽는 그 표)를
 * 그대로 서빙한다.
 *
 * ★종전엔 이 파일에 표가 **2차 하드코딩**돼 있었다. 그래서 백엔드가 grok 을
 * 편입하고 가중치를 바꾼 뒤에도 화면은 "Claude 60% + Antigravity 20% + Codex 20%"
 * 를 계속 광고했고(실제 표는 50/17/17/17), `grok-only` 프리셋은 행 자체가 없어
 * 고를 방법이 없었다. 오케 실행모델 셀렉터가 같은 이유로 이미 파생으로 바뀌었다
 * (`ORCHESTRATOR_HARNESS_OPTIONS` 주석).
 *
 * 아이콘만 화면 쪽 **덧붙임**이다 — 여기 없는 프리셋도 목록엔 그대로 서고
 * 기본 아이콘을 쓴다. 반대로 두면(아이콘 표가 목록을 정하면) 새 프리셋이
 * 이모지를 기다리다 조용히 사라진다.
 */
const PRESET_ICONS: Readonly<Record<string, string>> = {
  auto: "🎯",
  "cost-saver": "💸",
  balanced: "⚖️",
  "claude-only": "🟣",
  "codex-only": "🟢",
  "grok-only": "⚡",
  "antigravity-only": "🟠",
};
const PRESET_ICON_FALLBACK = "⚙️";

/** 하네스 축의 사람이 읽는 이름(custom 프리셋 체크박스). 없으면 id 그대로. */
const HARNESS_LABELS: Readonly<Record<string, string>> = {
  claude: "Claude",
  gpt: "Codex",
  grok: "Grok",
  antigravity: "Antigravity",
};

const CUSTOM_PRESET_PREFIX = "custom:";

interface PresetRowProps {
  icon: string;
  label: string;
  description: string;
  /** 이 프리셋의 후보 하네스 요약(비어 있으면 안 그린다). */
  detail: string;
  selected: boolean;
  disabled: boolean;
  /** Custom 행처럼 바깥 컨테이너가 이미 테두리를 그린 경우 자기 테두리를 뺀다. */
  bare?: boolean;
  onSelect: () => void;
}

function PresetRow({
  icon,
  label,
  description,
  detail,
  selected,
  disabled,
  bare = false,
  onSelect,
}: PresetRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors ${
        bare
          ? ""
          : selected
          ? "border border-blue-500 bg-blue-500/10"
          : "border border-gray-700 hover:border-gray-600 hover:bg-gray-700/50"
      }`}
    >
      <span className="text-xl leading-6">{icon}</span>
      <div className="min-w-0 flex-1">
        <span
          className={`text-sm font-medium ${
            selected ? "text-blue-400" : "text-gray-200"
          }`}
        >
          {label}
        </span>
        {detail && (
          <p className="mt-0.5 text-xs font-medium text-gray-400">{detail}</p>
        )}
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
          {description}
        </p>
      </div>
      {selected && (
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-blue-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
}

function parseCustomSelection(preset: string): string[] {
  if (!preset.startsWith(CUSTOM_PRESET_PREFIX)) return [];
  return preset
    .slice(CUSTOM_PRESET_PREFIX.length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 이 설정이 다루는 축은 **하네스**(어느 CLI 로 오케를 띄울까) 하나다. 구체 모델
 * 핀은 프로젝트별인 오케 패널 셀렉터의 몫이라 여기 값은 접미 없는 문자열이다.
 *
 * ★종전엔 여기에 claude/codex 두 칸이 **따로 하드코딩**돼 있었다. 그 결과 백엔드
 * (`model-selection.ORCHESTRATOR_HARNESS_SETTINGS`)와 오케 패널 셀렉터가 grok 을
 * 편입한 뒤에도 이 화면만 옛 두 칸에 머물러, 유저는 env 없이는 grok 오케를 고를
 * 길이 없었다(#638/#639 는 백엔드에서 완전 동작 중이었다). 그래서 목록을 여기서
 * 만들지 않고 셀렉터 목록의 하네스 축을 그대로 쓴다 — 두 화면이 벌어질 자리 자체가
 * 없어진다.
 */
type OrchestratorModel = string;

const ORCHESTRATOR_ENV_MODEL = {
  label: "기타(env)",
  desc: "MARBLO_ORCHESTRATOR_MODEL is set to a model outside the UI choices.",
};

function ModelPresetSection() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("auto");
  const [catalog, setCatalog] = useState<ModelPresetCatalog>({
    presets: [],
    customHarnesses: [],
  });
  const [orchestratorModel, setOrchestratorModel] = useState<string>("claude");
  const [saving, setSaving] = useState(false);
  const [savingOrchestratorModel, setSavingOrchestratorModel] = useState(false);
  const [orchestratorModelSaved, setOrchestratorModelSaved] = useState(false);
  const orchestratorStatus = useOrchestratorStore((s) => s.status);
  const isOrchestratorRunning =
    orchestratorStatus === "running" || orchestratorStatus === "starting";

  useEffect(() => {
    window.electronAPI.modelPreset
      .get()
      .then(setCurrent)
      .catch(() => {});
    window.electronAPI.modelPreset
      .list()
      .then(setCatalog)
      .catch(() => {});
    window.electronAPI.orchestratorModel
      .get()
      .then((model) => {
        if (model) {
          // 저장값은 `provider[:modelId]` compound 일 수 있다(오케 패널에서 Claude
          // 변형을 고른 경우). 이 설정은 **어느 CLI 로 띄울지**를 정하는 전역
          // 기본값이므로 프로바이더 축만 본다 — 그러지 않으면 "claude:claude-fable-5"
          // 가 목록에 없는 값이 되어 멀쩡한 선택이 "기타(env)"로 보인다.
          // 구체 모델 선택은 오케 패널 셀렉터가 담당한다(프로젝트별).
          setOrchestratorModel(orchestratorModelProvider(model));
        }
      })
      .catch(() => {});
  }, []);

  const handleSelect = async (preset: string) => {
    setSaving(true);
    try {
      // main 이 정규화한 값을 되받는다 — 유효하지 않은 조합을 골랐을 때 화면이
      // 실제 저장값과 다른 것을 체크된 상태로 보여주지 않게 한다.
      const result = await window.electronAPI.modelPreset.set(preset);
      setCurrent(result?.preset ?? preset);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const customSelection = parseCustomSelection(current);
  const isCustom = customSelection.length > 0;

  /**
   * custom 하네스 토글. 마지막 하나를 끄려는 경우는 무시한다 — 후보가 0이면
   * 라우팅이 고를 것이 없어 dispatch 가 통째로 막힌다(빈 프리셋은 설정이 아니라
   * 장애다).
   */
  const toggleCustomHarness = (harness: string) => {
    const next = customSelection.includes(harness)
      ? customSelection.filter((h) => h !== harness)
      : [...customSelection, harness];
    if (next.length === 0) return;
    void handleSelect(`${CUSTOM_PRESET_PREFIX}${next.join(",")}`);
  };

  /** Custom 행을 처음 켤 때의 시작값 — 현재 프리셋의 후보집합을 그대로 물려준다. */
  const startCustom = () => {
    const seed =
      catalog.presets.find((p) => p.id === current)?.models ??
      catalog.customHarnesses;
    const unique = [...new Set(seed)].filter((m) =>
      catalog.customHarnesses.includes(m)
    );
    if (unique.length === 0) return;
    void handleSelect(`${CUSTOM_PRESET_PREFIX}${unique.join(",")}`);
  };

  const handleOrchestratorModelChange = async (model: OrchestratorModel) => {
    setSavingOrchestratorModel(true);
    setOrchestratorModelSaved(false);
    try {
      await window.electronAPI.orchestratorModel.set(model);
      setOrchestratorModel(model);
      setOrchestratorModelSaved(true);
    } catch {
      /* ignore */
    } finally {
      setSavingOrchestratorModel(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          {t("settings.orchestratorModel.heading")}
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          {t("settings.orchestratorModel.help")}
        </p>
        <label className="mb-2 block text-xs font-medium text-gray-400">
          {t("settings.orchestratorModel.label")}
        </label>
        <select
          value={orchestratorModel}
          disabled={savingOrchestratorModel}
          onChange={(e) =>
            handleOrchestratorModelChange(e.target.value as OrchestratorModel)
          }
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
        >
          {ORCHESTRATOR_HARNESS_OPTIONS.map((harness) => (
            <option key={harness.value} value={harness.value}>
              {harness.label}
            </option>
          ))}
          {!ORCHESTRATOR_HARNESS_OPTIONS.some(
            (h) => h.value === orchestratorModel,
          ) && (
            <option value={orchestratorModel} disabled>
              {ORCHESTRATOR_ENV_MODEL.label}
            </option>
          )}
        </select>
        <p className="mt-2 text-xs text-gray-500">
          {ORCHESTRATOR_HARNESS_OPTIONS.some(
            (h) => h.value === orchestratorModel,
          )
            ? // 설명이 없는 하네스는 설명만 비운다 — 칸은 이미 서 있다.
              (ORCHESTRATOR_HARNESS_DESC[orchestratorModel] ?? "")
            : ORCHESTRATOR_ENV_MODEL.desc}
        </p>
        <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {isOrchestratorRunning
            ? t("settings.orchestratorModel.restartRunning")
            : t("settings.orchestratorModel.restartStopped")}
        </div>
        {orchestratorModelSaved && (
          <p className="mt-2 text-xs text-green-400">
            {t("settings.orchestratorModel.saved")}
          </p>
        )}
      </div>
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">
          {t("settings.models.heading")}
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          {t("settings.models.help")}
        </p>
        <div className="space-y-2">
          {catalog.presets.map((p) => (
            <PresetRow
              key={p.id}
              icon={PRESET_ICONS[p.id] ?? PRESET_ICON_FALLBACK}
              label={p.label}
              description={p.description}
              detail={p.models.map((m) => HARNESS_LABELS[m] ?? m).join(" · ")}
              selected={current === p.id}
              disabled={saving}
              onSelect={() => handleSelect(p.id)}
            />
          ))}
          {catalog.customHarnesses.length > 0 && (
            <div
              className={`rounded-lg border transition-colors ${
                isCustom ? "border-blue-500 bg-blue-500/10" : "border-gray-700"
              }`}
            >
              <PresetRow
                icon="🛠"
                label="Custom"
                description={t("settings.models.customHelp")}
                detail={
                  isCustom
                    ? customSelection
                        .map((m) => HARNESS_LABELS[m] ?? m)
                        .join(" · ")
                    : ""
                }
                selected={isCustom}
                disabled={saving}
                bare
                onSelect={startCustom}
              />
              {isCustom && (
                <div className="flex flex-wrap gap-2 border-t border-blue-500/20 px-4 py-3">
                  {catalog.customHarnesses.map((harness) => {
                    const on = customSelection.includes(harness);
                    // 마지막 하나는 끌 수 없다 — 후보 0이면 dispatch 가 막힌다.
                    const isLastOn = on && customSelection.length === 1;
                    return (
                      <button
                        key={harness}
                        type="button"
                        onClick={() => toggleCustomHarness(harness)}
                        disabled={saving || isLastOn}
                        title={
                          isLastOn
                            ? t("settings.models.customLastHarness")
                            : undefined
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60 ${
                          on
                            ? "border-blue-400 bg-blue-500/20 text-blue-200"
                            : "border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {HARNESS_LABELS[harness] ?? harness}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {t("settings.models.restartNote")}
        </div>
      </div>
      <SubscriptionPlansSection />
    </div>
  );
}

// Patent claim 8 (구독제 vs 토큰단위 과금체계 구분):
// 사용자가 어떤 모델을 구독제로 쓰는지 선언하면 cost-tracker 가
// per-token 단가 대신 월정액 + 한도 기반으로 비용을 산출함. 빈 리스트면
// 모든 모델은 기본 토큰단가로 과금 (현행 동작과 동일).
function SubscriptionPlansSection() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<SubscriptionPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.subscriptionPlans
      .list()
      .then((p) => {
        setPlans(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const update = (i: number, patch: Partial<SubscriptionPlanEntry>) => {
    setPlans((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  };

  const addPlan = () => {
    setPlans((prev) => [
      ...prev,
      { modelPrefix: "claude-opus", monthlyFlatUsd: 200 },
    ]);
  };

  const removePlan = (i: number) => {
    setPlans((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.subscriptionPlans.save(plans);
      if (result.success) {
        setSavedAt(Date.now());
      } else {
        setError(result.error || t("settings.saveFailed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
      <h3 className="mb-1 text-sm font-medium text-gray-200">
        {t("settings.subscription.heading")}
      </h3>
      <p className="mb-4 text-xs text-gray-500">
        {t("settings.subscription.help")}
      </p>

      <div className="space-y-3">
        {plans.length === 0 && (
          <p className="text-xs text-gray-500 italic">
            {t("settings.subscription.empty")}
          </p>
        )}
        {plans.map((p, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded border border-gray-700 bg-gray-900/40 p-3"
          >
            <input
              className="w-40 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200"
              placeholder="claude-opus"
              value={p.modelPrefix}
              onChange={(e) => update(i, { modelPrefix: e.target.value })}
            />
            <span className="text-xs text-gray-500">
              {t("settings.subscription.monthlyFlat")}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-20 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200"
              value={p.monthlyFlatUsd}
              onChange={(e) =>
                update(i, { monthlyFlatUsd: Number(e.target.value) || 0 })
              }
            />
            <span className="text-xs text-gray-500">
              {t("settings.subscription.tokenAllowance")}
            </span>
            <input
              type="number"
              min={0}
              step={100000}
              className="w-32 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200"
              placeholder={t("settings.subscription.optional")}
              value={p.monthlyTokenAllowance ?? ""}
              onChange={(e) =>
                update(i, {
                  monthlyTokenAllowance: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
            />
            <button
              onClick={() => removePlan(i)}
              className="ml-auto rounded bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30"
            >
              {t("settings.subscription.delete")}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={addPlan}
          className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700/50"
        >
          {t("settings.subscription.addPlan")}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-blue-500/20 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
        >
          {saving ? t("settings.subscription.saving") : t("common.save")}
        </button>
        {savedAt && (
          <span className="text-xs text-green-400">
            {t("settings.subscription.saved")}
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
