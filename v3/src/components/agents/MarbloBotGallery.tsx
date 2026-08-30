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
  Megaphone,
  Palette,
  Play,
  Save,
  Search,
  Sparkles,
  Video,
} from "lucide-react";
import {
  buildBotDispatchInstruction,
  defaultWikiRootPath,
  localizeSeedBots,
  OMITTED_SEED_BOTS,
  seedToDraft,
  validateBotDefinition,
  type BotDefinition,
  type BotDefinitionDraft,
  type BotModel,
  type LocalizedSeedBotDefinition,
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

const OmittedIcon = [Video, Search] as const;

const ROLE_OPTIONS: AgentRole[] = ["frontend", "backend", "test", "devops"];
const MODEL_OPTIONS: Array<{ value: BotModel; label: string }> = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "grok", label: "Grok" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "solar", label: "Solar" },
  { value: "local", label: "Local" },
];

function seedIcon(seedId: string) {
  if (seedId === "knowledge-assistant") return BookOpen;
  if (seedId === "fullstack-developer") return Code2;
  if (seedId === "daily-briefing") return CalendarClock;
  if (seedId === "marketer") return Megaphone;
  if (seedId === "designer") return Palette;
  if (seedId === "jarvis") return Sparkles;
  return Bot;
}

function issueText(issue: string, t: ReturnType<typeof useTranslation>["t"]) {
  switch (issue) {
    case "missing_project":
      return t("agents.marbloBots.validation.missingProject");
    case "missing_owner":
      return t("agents.marbloBots.validation.missingOwner");
    case "missing_name":
      return t("agents.marbloBots.validation.missingName");
    case "missing_persona":
      return t("agents.marbloBots.validation.missingPersona");
    case "empty_mission":
      return t("agents.marbloBots.validation.emptyMission");
    case "unknown_model":
      return t("agents.marbloBots.validation.unknownModel");
    case "knowledge_root_required":
      return t("agents.marbloBots.validation.knowledgeRootRequired");
    default:
      return t("agents.marbloBots.validation.default");
  }
}

function draftFromSeed(
  seed: LocalizedSeedBotDefinition,
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

function TruncatedPathLine({
  label,
  path,
  fallback,
}: {
  label: string;
  path: string;
  fallback: string;
}) {
  const displayPath = path || fallback;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="flex-shrink-0">{label}:</span>
      <span className="min-w-0 truncate" title={displayPath}>
        {displayPath}
      </span>
    </span>
  );
}

function WikiSetupGuide({
  wikiRootPath,
  wikiExists,
}: {
  wikiRootPath: string;
  wikiExists: boolean | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(wikiExists !== true);
  const [copied, setCopied] = useState(false);
  const requestText = [
    t("agents.marbloBots.wiki.request1"),
    t("agents.marbloBots.wiki.request2"),
    t("agents.marbloBots.wiki.request3"),
    t("agents.marbloBots.wiki.request4"),
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
              {t("agents.marbloBots.wiki.title")}
            </span>
            <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-100">
              {wikiExists
                ? t("agents.marbloBots.wiki.ready")
                : t("agents.marbloBots.wiki.needsSetup")}
            </span>
          </span>
          <span className="mt-1 block max-w-4xl text-sm text-emerald-100/80">
            {t("agents.marbloBots.wiki.body")}
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
            <div className="min-w-0 rounded border border-emerald-500/20 bg-gray-950/40 p-2">
              <TruncatedPathLine
                label={t("agents.marbloBots.wiki.root")}
                path={wikiRootPath}
                fallback={t("agents.marbloBots.rootMissing")}
              />
            </div>
            <div
              className="min-w-0 truncate rounded border border-emerald-500/20 bg-gray-950/40 p-2"
              title={t("agents.marbloBots.wiki.mcpTools")}
            >
              {t("agents.marbloBots.wiki.mcpTools")}
            </div>
            <div className="min-w-0 truncate rounded border border-emerald-500/20 bg-gray-950/40 p-2">
              {t("agents.marbloBots.wiki.singleRoot")}
            </div>
          </div>
          <div className="rounded border border-gray-700 bg-gray-950 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-300">
                {t("agents.marbloBots.wiki.copyTitle")}
              </span>
              <button
                type="button"
                onClick={() => void copyRequest()}
                className="inline-flex items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-800"
              >
                {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                {copied
                  ? t("agents.marbloBots.copied")
                  : t("agents.marbloBots.copy")}
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

function BotUsePrimer() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-4 rounded border border-blue-500/30 bg-blue-500/10">
      <div className="px-4 py-3">
        <p className="text-sm font-semibold text-blue-100">
          {t("agents.marbloBots.primer.line1")}
        </p>
        <p className="mt-1 text-sm text-blue-100/90">
          {t("agents.marbloBots.primer.line2")}
        </p>
        <p className="mt-1 text-sm text-blue-100/80">
          {t("agents.marbloBots.primer.line3")}
        </p>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-100 hover:text-white"
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
          {t("agents.marbloBots.primer.details")}
        </button>
      </div>
      {open && (
        <div className="border-t border-blue-500/20 px-4 py-3 text-sm leading-6 text-blue-100/80">
          <p>{t("agents.marbloBots.primer.detail1")}</p>
          <p>{t("agents.marbloBots.primer.detail2")}</p>
        </div>
      )}
    </section>
  );
}

export function MarbloBotGallery({ project, ownerId }: MarbloBotGalleryProps) {
  const { t } = useTranslation();
  const seedBots = useMemo(() => localizeSeedBots(t), [t]);
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
      setError(validation.issues.map((issue) => issueText(issue, t)).join(" "));
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
        setError(t("agents.marbloBots.dispatchFailed"));
      } else {
        setMessage(
          result === "local"
            ? t("agents.marbloBots.dispatchLocal")
            : t("agents.marbloBots.dispatchQueued"),
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const saveSeed = async (
    seed: LocalizedSeedBotDefinition,
  ): Promise<BotDefinition> => {
    const draft = draftFromSeed(seed, project, ownerId);
    const validation = validateBotDefinition(draft);
    if (!validation.ok) {
      throw new Error(
        validation.issues.map((issue) => issueText(issue, t)).join(" "),
      );
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
      setError(validation.issues.map((issue) => issueText(issue, t)).join(" "));
      return;
    }
    setBusy({ key: "custom", action: "save" });
    setError(null);
    setMessage(null);
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
      setMessage(t("agents.marbloBots.savedCustom"));
    } catch (err) {
      // ★Firestore 쓰기 실패가 unhandled rejection 으로 사라지지 않게 — 화면에
      // 이유를 남긴다.
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("agents.marbloBots.saveFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 text-gray-100">
      <BotUsePrimer />
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
        <div className="min-w-0 max-w-full rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 md:max-w-sm">
          <TruncatedPathLine
            label={t("agents.marbloBots.knowledgeRoot")}
            path={wikiRootPath}
            fallback={t("agents.marbloBots.rootMissing")}
          />
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
          {seedBots.map((seed) => {
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
                          {t("agents.marbloBots.knowledgeBadge")}
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
                        {t("agents.marbloBots.required")}: {item}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mb-3 text-xs text-gray-500">
                  {t("agents.marbloBots.evidence")}: {seed.evidence}
                </p>
                {!validation.ok && (
                  <p className="mb-3 text-xs text-red-300">
                    {validation.issues
                      .map((issue) => issueText(issue, t))
                      .join(" ")}
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
                        setMessage(t("agents.marbloBots.savedSeed"));
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : t("agents.marbloBots.saveFailed"),
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
                      // 저장 단계부터 바쁨 표시 — 저장 중 두 번 눌리지 않게.
                      setBusy({ key, action: "run" });
                      setError(null);
                      try {
                        const bot = await saveSeed(seed);
                        await dispatchBot(bot, key);
                      } catch (err) {
                        setBusy(null);
                        setError(
                          err instanceof Error
                            ? err.message
                            : t("agents.marbloBots.runFailed"),
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
                        {t("agents.marbloBots.knowledgeBadge")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300">{bot.persona}</p>
                  <p className="mt-2 text-sm text-gray-400">{bot.mission}</p>
                  {bot.knowledge.enabled && (
                    <p className="mt-2 min-w-0 truncate text-xs text-emerald-200">
                      <TruncatedPathLine
                        label={t("agents.marbloBots.wikiQueryRoot")}
                        path={bot.knowledge.rootPath}
                        fallback={t("agents.marbloBots.rootMissing")}
                      />
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
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
            <span className="mb-1 block text-xs text-gray-400">
              {t("agents.marbloBots.persona")}
            </span>
            <input
              value={custom.persona}
              onChange={(event) =>
                setCustom((prev) => ({ ...prev, persona: event.target.value }))
              }
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-xs text-gray-400">
              {t("agents.marbloBots.mission")}
            </span>
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
                  <span className="font-medium">{t(item.name)}</span>
                </div>
                <p className="text-gray-500">{t(item.reason)}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
