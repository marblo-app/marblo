import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Loader2,
  Play,
  Save,
  Search,
  Video,
} from "lucide-react";
import {
  buildBotDispatchInstruction,
  defaultWikiRootPath,
  OMITTED_SEED_BOTS,
  SEED_BOTS,
  seedToDraft,
  validateBotDefinition,
  type BotDefinition,
  type BotDefinitionDraft,
  type BotModel,
  type SeedBotDefinition,
} from "../../lib/botDefinition";
import {
  createBotDefinition,
  subscribeToBotDefinitions,
  upsertSeedBotDefinition,
} from "../../services/botDefinitionService";
import { routeInstructionToOrchestrator } from "../../services/orchestratorInstructionService";
import type { Project } from "../../types/project";
import type { AgentRole } from "../../types/task";
import { useTranslation } from "../../lib/i18n";

interface MarbloBotGalleryProps {
  project: Project;
  ownerId: string;
}

type BusyState = { key: string; action: "save" | "run" } | null;

const OmittedIcon = [Video, CalendarClock, Search] as const;

const ROLE_OPTIONS: AgentRole[] = ["frontend", "backend", "test", "devops"];

function seedIcon(seedId: string) {
  if (seedId === "knowledge-assistant") return BookOpen;
  if (seedId === "fullstack-developer") return Code2;
  return Bot;
}

function issueText(issue: string): string {
  switch (issue) {
    case "missing_project":
      return "프로젝트 귀속이 없습니다.";
    case "missing_owner":
      return "소유자 정보가 없습니다.";
    case "missing_name":
      return "봇 이름이 비어 있습니다.";
    case "missing_persona":
      return "Persona가 비어 있습니다.";
    case "empty_mission":
      return "Mission이 비어 있습니다.";
    case "unknown_model":
      return "알 수 없는 모델입니다.";
    case "knowledge_root_required":
      return "Knowledge를 켜려면 wiki root_path가 필요합니다.";
    default:
      return "봇 정의를 저장할 수 없습니다.";
  }
}

function draftFromSeed(
  seed: SeedBotDefinition,
  project: Project,
  ownerId: string,
): BotDefinitionDraft {
  return seedToDraft({
    seed,
    projectId: project.id,
    ownerId,
    wikiRootPath: defaultWikiRootPath(project.folderPath),
  });
}

function asRunnableBot(id: string, draft: BotDefinitionDraft): BotDefinition {
  return {
    ...draft,
    id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function WikiSetupGuide({
  wikiRootPath,
  wikiExists,
}: {
  wikiRootPath: string;
  wikiExists: boolean | null;
}) {
  const [open, setOpen] = useState(wikiExists !== true);
  const [copied, setCopied] = useState(false);
  const requestText = [
    "오케, 이 프로젝트에 마블로 지식위키를 구성해줘.",
    "공유 위키 루트는 docs/wiki 하나만 쓰고, .claude/skills/wiki-init · wiki-note · wiki-ingest 스킬과 MCP wiki_ingest/wiki_query/wiki_lint를 사용해.",
    "먼저 README와 기본 분류를 만들고, 현재 프로젝트 문서/결정사항 중 봇이 자주 참조할 내용을 wiki-note로 정리한 뒤 wiki-ingest와 wiki-lint까지 돌려줘.",
    "다른 프로젝트에서 참조할 때는 wiki_query({ root_path: \"<프로젝트 절대경로>/docs/wiki\", query: \"...\" }) 형태로 쓰게 안내해줘.",
  ].join("\n");

  useEffect(() => {
    if (wikiExists === true) setOpen(false);
  }, [wikiExists]);

  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(requestText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="flex flex-wrap items-center gap-2">
            <BookOpen size={18} className="text-emerald-200" />
            <span className="text-sm font-semibold text-emerald-100">
              먼저 Knowledge 축 켜기: 마블로 위키 구성 가이드
            </span>
            <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-100">
              {wikiExists ? "docs/wiki 확인됨" : "구성 필요"}
            </span>
          </span>
          <span className="mt-1 block max-w-4xl text-sm text-emerald-100/80">
            봇의 차별점은 프로젝트 지식입니다. 새 엔진이 아니라 이미 등록된
            wiki_ingest, wiki_query, wiki_lint와 wiki-init/wiki-note/wiki-ingest
            스킬을 쓰게 오케에게 요청하세요.
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`mt-0.5 flex-shrink-0 text-emerald-100 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-emerald-500/20 px-4 py-3">
          <div className="mb-3 grid gap-2 text-xs text-emerald-100/80 md:grid-cols-3">
            <div className="rounded border border-emerald-500/20 bg-gray-950/40 p-2">
              루트: {wikiRootPath || "프로젝트 폴더 연결 필요"}
            </div>
            <div className="rounded border border-emerald-500/20 bg-gray-950/40 p-2">
              MCP: wiki_ingest / wiki_query / wiki_lint
            </div>
            <div className="rounded border border-emerald-500/20 bg-gray-950/40 p-2">
              공유 위키는 docs/wiki 하나
            </div>
          </div>
          <div className="rounded border border-gray-700 bg-gray-950 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-300">
                오케에게 복사해서 보낼 요청
              </span>
              <button
                type="button"
                onClick={() => void copyRequest()}
                className="inline-flex items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-800"
              >
                {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-xs leading-5 text-gray-300">
              {requestText}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

export function MarbloBotGallery({ project, ownerId }: MarbloBotGalleryProps) {
  const { t } = useTranslation();
  const [savedBots, setSavedBots] = useState<BotDefinition[]>([]);
  const [runMission, setRunMission] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wikiExists, setWikiExists] = useState<boolean | null>(null);
  const [custom, setCustom] = useState({
    name: "",
    persona: "",
    mission: "",
    model: "claude" as BotModel,
    role: "backend" as AgentRole,
    knowledgeEnabled: true,
  });

  const wikiRootPath = defaultWikiRootPath(project.folderPath);
  const savedSeedIds = useMemo(
    () => new Set(savedBots.map((bot) => bot.seedId).filter(Boolean)),
    [savedBots],
  );

  useEffect(() => {
    return subscribeToBotDefinitions(project.id, setSavedBots);
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    if (!wikiRootPath) {
      setWikiExists(false);
      return;
    }
    void window.electronAPI?.fs
      ?.pathExists?.(wikiRootPath)
      .then((exists) => {
        if (!cancelled) setWikiExists(exists === true);
      })
      .catch(() => {
        if (!cancelled) setWikiExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wikiRootPath]);

  const dispatchBot = async (bot: BotDefinition, key: string) => {
    const mission = runMission.trim() || bot.mission;
    const validation = validateBotDefinition(bot);
    if (!validation.ok) {
      setError(validation.issues.map(issueText).join(" "));
      return;
    }
    setBusy({ key, action: "run" });
    setError(null);
    setMessage(null);
    try {
      const result = await routeInstructionToOrchestrator({
        projectId: project.id,
        message: buildBotDispatchInstruction({
          bot,
          userMission: mission,
          projectRootPath: project.folderPath,
        }),
        fromUserId: ownerId,
        taskId: null,
      });
      if (result === "failed") {
        setError("오케스트레이터에 실행 지시를 보내지 못했습니다.");
      } else {
        setMessage(
          result === "local"
            ? "오케스트레이터에 보냈습니다. 보드 티켓 생성 후 dispatch_task로 물리 에이전트가 뜹니다."
            : "오케스트레이터가 꺼져 있어 실행 지시를 대기열에 넣었습니다.",
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const saveSeed = async (seed: SeedBotDefinition): Promise<BotDefinition> => {
    const draft = draftFromSeed(seed, project, ownerId);
    const validation = validateBotDefinition(draft);
    if (!validation.ok) {
      throw new Error(validation.issues.map(issueText).join(" "));
    }
    const id = await upsertSeedBotDefinition({
      ...draft,
      seedId: seed.seedId,
    });
    return asRunnableBot(id, draft);
  };

  const saveCustom = async () => {
    const draft: BotDefinitionDraft = {
      projectId: project.id,
      ownerId,
      name: custom.name,
      persona: custom.persona,
      mission: custom.mission,
      model: custom.model,
      role: custom.role,
      tools: ["wiki_query", "filesystem", "marblo_mcp"],
      knowledge: {
        enabled: custom.knowledgeEnabled,
        rootPath: custom.knowledgeEnabled ? wikiRootPath : "",
      },
    };
    const validation = validateBotDefinition(draft);
    if (!validation.ok) {
      setError(validation.issues.map(issueText).join(" "));
      return;
    }
    setBusy({ key: "custom", action: "save" });
    setError(null);
    try {
      await createBotDefinition(draft);
      setCustom({
        name: "",
        persona: "",
        mission: "",
        model: "claude",
        role: "backend",
        knowledgeEnabled: true,
      });
      setMessage("봇 정의를 프로젝트에 저장했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 text-gray-100">
      <WikiSetupGuide wikiRootPath={wikiRootPath} wikiExists={wikiExists} />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("agents.marbloBots.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-400">
            {t("agents.marbloBots.subtitle")}
          </p>
        </div>
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {t("agents.marbloBots.knowledgeRoot")}:{" "}
          {wikiRootPath || t("agents.marbloBots.rootMissing")}
        </div>
      </div>

      {(message || error) && (
        <div
          className={`mb-4 rounded border px-3 py-2 text-sm ${
            error
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {error || message}
        </div>
      )}

      <label className="mb-4 block">
        <span className="mb-1 block text-xs font-medium uppercase text-gray-500">
          {t("agents.marbloBots.runMission")}
        </span>
        <textarea
          value={runMission}
          onChange={(event) => setRunMission(event.target.value)}
          rows={3}
          className="w-full resize-none rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500"
          placeholder={t("agents.marbloBots.runPlaceholder")}
        />
      </label>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            {t("agents.marbloBots.runnableSeeds")}
          </h3>
          <span className="text-xs text-gray-500">
            {t("agents.marbloBots.storageScope")}
          </span>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {SEED_BOTS.map((seed) => {
            const Icon = seedIcon(seed.seedId);
            const key = `seed:${seed.seedId}`;
            const draft = draftFromSeed(seed, project, ownerId);
            const validation = validateBotDefinition(draft);
            const isBusy = busy?.key === key;
            const saved = savedSeedIds.has(seed.seedId);
            return (
              <article
                key={seed.seedId}
                className="rounded border border-gray-700 bg-gray-900 p-4"
              >
                <div className="mb-3 flex items-start gap-3">
                  <div className="rounded bg-gray-800 p-2 text-blue-300">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium">{seed.name}</h4>
                      <span className="rounded border border-gray-700 px-2 py-0.5 text-[11px] uppercase text-gray-400">
                        {seed.model}
                      </span>
                      {seed.knowledgeEnabled && (
                        <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-200">
                          Knowledge
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-300">{seed.persona}</p>
                  </div>
                </div>
                <p className="mb-3 text-sm text-gray-400">{seed.mission}</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {seed.tools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
                {seed.requires && seed.requires.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {seed.requires.map((item) => (
                      <span
                        key={item}
                        className="rounded border border-amber-500/30 px-2 py-1 text-[11px] text-amber-200"
                      >
                        필요: {item}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mb-3 text-xs text-gray-500">
                  MCP 근거: {seed.evidence}
                </p>
                {!validation.ok && (
                  <p className="mb-3 text-xs text-red-300">
                    {validation.issues.map(issueText).join(" ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isBusy || !validation.ok}
                    onClick={async () => {
                      setBusy({ key, action: "save" });
                      setError(null);
                      try {
                        await saveSeed(seed);
                        setMessage("시드 봇을 프로젝트에 저장했습니다.");
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : "저장 실패",
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy && busy.action === "save" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {saved
                      ? t("agents.marbloBots.saveAgain")
                      : t("agents.marbloBots.saveToProject")}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || !validation.ok}
                    onClick={async () => {
                      try {
                        const bot = await saveSeed(seed);
                        await dispatchBot(bot, key);
                      } catch (err) {
                        setBusy(null);
                        setError(
                          err instanceof Error ? err.message : "실행 실패",
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy && busy.action === "run" ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    {t("agents.marbloBots.saveAndRun")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">
          {t("agents.marbloBots.savedBots")}
        </h3>
        {savedBots.length === 0 ? (
          <div className="rounded border border-dashed border-gray-700 p-4 text-sm text-gray-500">
            {t("agents.marbloBots.savedEmpty")}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {savedBots.map((bot) => {
              const key = `saved:${bot.id}`;
              const isBusy = busy?.key === key;
              return (
                <article
                  key={bot.id}
                  className="rounded border border-gray-700 bg-gray-900 p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="font-medium">{bot.name}</h4>
                    <span className="rounded border border-gray-700 px-2 py-0.5 text-[11px] uppercase text-gray-400">
                      {bot.model}
                    </span>
                    {bot.knowledge.enabled && (
                      <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-200">
                        Knowledge
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300">{bot.persona}</p>
                  <p className="mt-2 text-sm text-gray-400">{bot.mission}</p>
                  {bot.knowledge.enabled && (
                    <p className="mt-2 truncate text-xs text-emerald-200">
                      wiki_query root_path: {bot.knowledge.rootPath}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => dispatchBot(bot, key)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    {t("agents.marbloBots.runSaved")}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">
          {t("agents.marbloBots.newBot")}
        </h3>
        <div className="grid gap-3 rounded border border-gray-700 bg-gray-900 p-4 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">
              {t("agents.marbloBots.name")}
            </span>
            <input
              value={custom.name}
              onChange={(event) =>
                setCustom((prev) => ({ ...prev, name: event.target.value }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">
              {t("agents.marbloBots.model")}
            </span>
            <select
              value={custom.model}
              onChange={(event) =>
                setCustom((prev) => ({
                  ...prev,
                  model: event.target.value as BotModel,
                }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="grok">Grok</option>
              <option value="deepseek">DeepSeek</option>
              <option value="solar">Solar</option>
              <option value="local">Local</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">
              {t("agents.marbloBots.role")}
            </span>
            <select
              value={custom.role}
              onChange={(event) =>
                setCustom((prev) => ({
                  ...prev,
                  role: event.target.value as AgentRole,
                }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={custom.knowledgeEnabled}
              onChange={(event) =>
                setCustom((prev) => ({
                  ...prev,
                  knowledgeEnabled: event.target.checked,
                }))
              }
              className="mb-2 h-4 w-4 rounded border-gray-600 bg-gray-950"
            />
            <span className="pb-2">{t("agents.marbloBots.knowledgeUse")}</span>
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs text-gray-400">Persona</span>
            <input
              value={custom.persona}
              onChange={(event) =>
                setCustom((prev) => ({ ...prev, persona: event.target.value }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs text-gray-400">Mission</span>
            <textarea
              value={custom.mission}
              onChange={(event) =>
                setCustom((prev) => ({ ...prev, mission: event.target.value }))
              }
              rows={3}
              className="w-full resize-none rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <div className="lg:col-span-2">
            <button
              type="button"
              disabled={busy?.key === "custom"}
              onClick={saveCustom}
              className="inline-flex items-center gap-1.5 rounded bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy?.key === "custom" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {t("agents.marbloBots.save")}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-200">
          {t("agents.marbloBots.omitted")}
        </h3>
        <div className="grid gap-3 xl:grid-cols-3">
          {OMITTED_SEED_BOTS.map((item, index) => {
            const Icon = OmittedIcon[index] ?? Bot;
            return (
              <div
                key={item.name}
                className="rounded border border-gray-800 bg-gray-950 p-4 text-sm"
              >
                <div className="mb-2 flex items-center gap-2 text-gray-300">
                  <Icon size={16} aria-hidden="true" />
                  <span className="font-medium">{item.name}</span>
                </div>
                <p className="text-gray-500">{item.reason}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
