import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { ModelType } from "./agent-manager";

export interface ResolvedCli {
  /** Absolute path to the binary, or the bare name if resolution failed. */
  command: string;
  /** Parsed "X.Y.Z" version string, or "" if unknown. */
  version: string;
}

let _claudeResolved: ResolvedCli | null = null;

/**
 * Resolve the `claude` binary deterministically instead of trusting PATH
 * order. A stale npm/bun install — e.g. `~/.bun/bin/claude` symlinked to an
 * accidental `npm i` under `~/node_modules` — can shadow the auto-updated
 * native build at `~/.local/bin/claude`, pinning every spawned agent (and the
 * orchestrator) to an old model list (Opus 4.1 / Sonnet 4). The harness
 * auto-updater only touches the native/npm-global installs, never these
 * stray copies, so the shadow persists across restarts.
 *
 * We probe the canonical install locations, ask each for its version, and
 * pick the newest — never a stray copy. Memoized; call resetClaudeResolution
 * after an update to re-probe.
 */
export function resolveClaudeBinary(): ResolvedCli {
  if (_claudeResolved) return _claudeResolved;
  const home = os.homedir();
  // Locations a `claude` must never resolve to: bun's shim dir and the
  // accidental `npm i` tree directly under HOME. NOTE: we intentionally do
  // NOT block all `node_modules` paths — legit homebrew / npm-global installs
  // live under their own `lib/node_modules`, and blocking those would defeat
  // the purpose.
  const blocked = [path.join(home, ".bun"), path.join(home, "node_modules")];
  const isBlocked = (p: string) =>
    blocked.some((b) => p === b || p.startsWith(b + path.sep));
  // Canonical install locations, highest trust first. The native installer
  // (~/.local/bin) self-updates; homebrew / npm-global come next.
  const candidates = [
    path.join(home, ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(home, ".npm-global/bin/claude"),
  ];
  const parseVer = (s: string): number[] => {
    const m = s.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  };
  const cmp = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

  let best: ResolvedCli | null = null;
  let bestVer = [0, 0, 0];
  for (const c of candidates) {
    try {
      const real = fs.realpathSync(c);
      if (isBlocked(real)) continue;
      const out = execFileSync(c, ["--version"], {
        timeout: 5000,
        encoding: "utf-8",
      }).trim();
      const ver = parseVer(out);
      if (!best || cmp(ver, bestVer) > 0) {
        best = { command: c, version: out.match(/\d+\.\d+\.\d+/)?.[0] || "" };
        bestVer = ver;
      }
    } catch {
      // Missing, non-executable, or blocked candidate — skip.
    }
  }
  _claudeResolved = best || { command: "claude", version: "" };
  return _claudeResolved;
}

/** Clear the memoized claude resolution (e.g. after a harness update). */
export function resetClaudeResolution(): void {
  _claudeResolved = null;
  _harnessCliResolved.clear();
}

const _harnessCliResolved = new Map<ModelType, ResolvedCli>();

// Binary name each model launches with. "gpt" is Codex; "antigravity" is the
// `agy` CLI. local/custom have no managed binary.
const MODEL_BINARY: Partial<Record<ModelType, string>> = {
  gemini: "gemini",
  gpt: "codex",
  antigravity: "agy",
};

// 작업 complexity → 프로바이더별 모델/레벨. 품질 우선 정책: 기본(standard)은
// 최상위(claude=opus, gpt-5.5=medium)를 유지하고, 작은 작업(simple)만 한 단계 낮추며,
// 어려운 작업(complex)은 최상위를 쓴다. complexity 가 undefined 면 override 하지 않아
// 기본 모델을 상속한다(오케스트레이터 등). claude=--model, gpt(codex)=model_reasoning_effort.
//   claude:  simple → sonnet,        standard/complex → opus
//   gpt:     simple → low, standard → medium, complex → high
export type TaskComplexity = "simple" | "standard" | "complex";
export function modelTierForComplexity(
  model: ModelType,
  complexity: TaskComplexity | undefined,
): { claudeModel?: string; codexReasoning?: string } {
  if (!complexity) return {}; // override 없음 → 기본 상속
  if (model === "claude") {
    // 기본·complex 는 opus(최상위), simple(작은 작업)만 sonnet 으로 하향.
    return { claudeModel: complexity === "simple" ? "sonnet" : "opus" };
  }
  if (model === "gpt") {
    return {
      codexReasoning:
        complexity === "simple"
          ? "low"
          : complexity === "complex"
            ? "high"
            : "medium",
    };
  }
  return {}; // gemini/antigravity/local/custom — 레벨 플래그 없음(기본 유지)
}

/**
 * Resolve the installed CLI version for any agent model, fast and offline —
 * a plain `<bin> --version`, no npm-registry round-trip. Unlike the Harness
 * store's `getCatalogVersions` (network-coupled, and it omits the shell-
 * installed `agy` and gemini), this works for every managed CLI and returns
 * instantly, so agent cards can show a version badge the same way the
 * orchestrator header does. Memoized per model.
 */
export function resolveHarnessCli(model: ModelType): ResolvedCli {
  if (model === "claude") return resolveClaudeBinary();
  const cached = _harnessCliResolved.get(model);
  if (cached) return cached;

  const binary = MODEL_BINARY[model];
  const home = os.homedir();
  const stray = [path.join(home, ".bun"), path.join(home, "node_modules")];
  const isStray = (p: string) =>
    stray.some((b) => p === b || p.startsWith(b + path.sep));

  let resolved: ResolvedCli = { command: binary || model, version: "" };
  if (binary) {
    for (const dir of getEnrichedPath().split(":")) {
      if (!dir) continue;
      const candidate = path.join(dir, binary);
      try {
        const real = fs.realpathSync(candidate);
        if (isStray(real)) continue;
        const out = execFileSync(candidate, ["--version"], {
          timeout: 5000,
          encoding: "utf-8",
        }).trim();
        const v = out.match(/\d+\.\d+\.\d+/)?.[0];
        if (v) {
          resolved = { command: candidate, version: v };
          break;
        }
      } catch {
        // Missing / non-executable / stray — keep scanning.
      }
    }
  }
  _harnessCliResolved.set(model, resolved);
  return resolved;
}

/** Installed version string per model (empty string if not detectable). */
export function resolveAllHarnessVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const model of [
    "claude",
    "gpt",
    "antigravity",
    "gemini",
  ] as ModelType[]) {
    out[model] = resolveHarnessCli(model).version;
  }
  return out;
}

export interface LaunchConfig {
  model: ModelType;
  command: string;
  args: string[];
  env: Record<string, string>;
  mcpConfigPath: string;
  skillContent: string;
  initialPrompt?: string;
  /**
   * For Claude only: the session id this launch is PINNED to (via the
   * `--session-id` flag on a fresh launch, or the `--resume` UUID on a resume).
   * Lets the caller wire cost tracking deterministically — no racy post-launch
   * "which new JSONL appeared?" scan. Undefined for non-Claude models, and for
   * the rare unresolved `--resume latest` claude case (caller falls back to
   * detection). See claudeSessionArgs.
   */
  claudeSessionId?: string;
}

/**
 * Decide Claude's session-related CLI args and the resulting session id.
 *
 * Per-agent token attribution keys off the Claude session JSONL filename
 * (`<sessionId>.jsonl`). Rather than racily detecting which file a fresh spawn
 * created — fragile when several Claude agents share one cwd, which is exactly
 * when attribution silently collapses onto the orchestrator — we PIN the id up
 * front and hand it straight to the cost tracker. Claude Code 2.1+ honors
 * `--session-id <uuid>` and names the JSONL after it (verified empirically).
 *
 *   fresh / "new" (pinFreshSession)→ `--session-id <newSessionId>`, id = newSessionId
 *   fresh / "new" (else)           → no session flag,               id = undefined
 *   resume concrete UUID           → `--resume <uuid>`,             id = uuid
 *   resume "latest" (unresolved)   → no session flag,               id = undefined
 *
 * `pinFreshSession` is opt-in: the AGENT path turns it on so each spawn's
 * tokens attribute deterministically. The orchestrator leaves it OFF — it owns
 * its own session lifecycle (it pushes `--resume` onto the args itself and
 * detects its session by prompt signature), so injecting `--session-id` there
 * would both be redundant and collide with its manual `--resume` on resume.
 *
 * The "latest" sentinel normally reaches the CLI already resolved to a concrete
 * UUID (the caller's resolveSessionId); if it didn't, we leave it unpinned so
 * the legacy post-launch detector can still recover it. We never emit both
 * `--resume` and `--session-id`.
 */
export function claudeSessionArgs(
  resumeSessionId: string | undefined,
  newSessionId: string,
  pinFreshSession: boolean,
): { args: string[]; sessionId?: string } {
  const wantResume = !!resumeSessionId && resumeSessionId !== "new";
  const resumeIsLatest = resumeSessionId === "latest";
  if (wantResume && !resumeIsLatest) {
    return { args: ["--resume", resumeSessionId!], sessionId: resumeSessionId };
  }
  if (wantResume && resumeIsLatest) {
    return { args: [], sessionId: undefined };
  }
  if (pinFreshSession) {
    return { args: ["--session-id", newSessionId], sessionId: newSessionId };
  }
  return { args: [], sessionId: undefined };
}

interface MCPServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const SKILLS_DIR = path.resolve(__dirname, "..", "skills");
const CONFIG_DIR = path.resolve(os.tmpdir(), "marblo-agent-configs");
const TF_SKILL_DIR_CANDIDATES = [
  // Packaged app bundle.
  path.join(process.resourcesPath || "", "bundled-harness", "skills"),
  // Dev/runtime from compiled Electron output: v3/dist-electron -> repo root.
  path.resolve(__dirname, "..", "..", "config", "claude", "skills"),
  // Dev/runtime from TS source: v3/electron -> repo root.
  path.resolve(__dirname, "..", "..", "..", "config", "claude", "skills"),
  // Repo-local bundle copied by setup scripts.
  path.resolve(__dirname, "..", "..", ".claude", "skills"),
  path.resolve(__dirname, "..", "..", "..", ".claude", "skills"),
];

/**
 * Root of the per-agent Codex session tree (`<CODEX_HOME>/sessions`), where
 * the CLI writes `YYYY/MM/DD/rollout-*.jsonl`. Each agent gets an isolated
 * CODEX_HOME, so this directory is unambiguously that agent's — no shared
 * account / attribution problem (unlike antigravity). Used by the cost
 * tracker to locate the agent's rollout file.
 */
export function codexSessionsDir(agentId: string): string {
  return path.join(CONFIG_DIR, `codex-home-${agentId}`, "sessions");
}

/**
 * Root of the per-agent Gemini chat-log tree
 * (`<GEMINI_CLI_HOME>/.gemini/tmp/<project>/chats/session-*.jsonl`). Isolated
 * per agent like Codex above. Used by the cost tracker to locate the agent's
 * chat session file.
 */
export function geminiTmpDir(agentId: string): string {
  return path.join(CONFIG_DIR, `gemini-home-${agentId}`, ".gemini", "tmp");
}

// MCP server entry point (compiled JS in dist-mcp/)
function getMCPServerPath(): string {
  return path.resolve(__dirname, "..", "dist-mcp", "index.js");
}

/**
 * Get a rich PATH that includes common binary locations.
 * Electron on macOS doesn't inherit the user's shell PATH when launched from Finder.
 */
function getEnrichedPath(): string {
  const basePath = process.env.PATH || "";
  const extraPaths = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    path.join(os.homedir(), ".nvm/versions/node", process.version, "bin"),
    // npm global bin locations — covers the default `npm install -g`
    // prefix as well as common user-customized prefixes (~/.npm-global).
    // The Harness store installs Codex / Gemini CLI here, so the
    // spawned agent processes need these on PATH to find them.
    path.join(os.homedir(), ".npm/bin"),
    path.join(os.homedir(), ".npm-global/bin"),
    path.join(os.homedir(), ".local/bin"),
    path.join(os.homedir(), ".cargo/bin"),
    path.join(os.homedir(), ".bun/bin"),
    path.join(os.homedir(), ".deno/bin"),
    path.join(os.homedir(), ".volta/bin"),
  ];

  const pathSet = new Set(basePath.split(":"));
  for (const p of extraPaths) {
    pathSet.add(p);
  }
  // Put the resolved claude's own directory first so any PATH-based `claude`
  // lookup (by the CLI itself or by sub-tools) hits the newest install rather
  // than a stale shadowing copy (e.g. ~/.bun/bin/claude). The command we spawn
  // already uses the absolute path; this keeps child lookups consistent.
  const resolvedDir = path.dirname(resolveClaudeBinary().command);
  if (path.isAbsolute(resolvedDir)) {
    return [
      resolvedDir,
      ...Array.from(pathSet).filter((p) => p !== resolvedDir),
    ].join(":");
  }
  return Array.from(pathSet).join(":");
}

function getMCPServerEnv(
  projectDir: string,
  marbloProjectId?: string,
  agentId?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: getEnrichedPath(),
  };

  // Forward Firebase env vars if present
  const firebaseVars = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
  ];

  for (const key of firebaseVars) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  // Set Marblo-specific env — prefer explicit projectId, fallback to process.env
  const resolvedProject = marbloProjectId || process.env.MARBLO_PROJECT || "";
  if (resolvedProject) {
    env.MARBLO_PROJECT = resolvedProject;
  }
  env.MARBLO_SKILLS_DIR = SKILLS_DIR;

  // Bridge port for MCP → Electron communication
  if (process.env.MARBLO_BRIDGE_PORT) {
    env.MARBLO_BRIDGE_PORT = process.env.MARBLO_BRIDGE_PORT;
  }

  // Agent ID for audit trail logging
  if (agentId) {
    env.MARBLO_AGENT_ID = agentId;
  } else if (process.env.MARBLO_AGENT_ID) {
    env.MARBLO_AGENT_ID = process.env.MARBLO_AGENT_ID;
  }

  return env;
}

// ─── agy conversation labels (per-agentId UUID 영속화) ────────────────────
// agy 의 conversations 는 ~/.gemini/antigravity-cli/conversations/<UUID>.pb
// 에 cwd 무관하게 다 섞여 들어가서 claude 의 saveSessionLabel (cwd 기반
// labels.json) 로는 매칭 불가. 별도 단일 파일에 agentId → UUID 매핑을 둔다.
function getAgyLabelsPath(): string {
  return path.join(
    os.homedir(),
    ".gemini",
    "antigravity-cli",
    "marblo-agy-labels.json",
  );
}

interface AgyLabelEntry {
  conversationUuid: string;
  label: string;
  agentId: string;
  createdAt: number;
}

function readAgyLabels(): Record<string, AgyLabelEntry> {
  try {
    return JSON.parse(fs.readFileSync(getAgyLabelsPath(), "utf-8"));
  } catch {
    return {};
  }
}

export function saveAgyConversationLabel(
  agentId: string,
  conversationUuid: string,
  label: string,
): void {
  const labels = readAgyLabels();
  labels[agentId] = {
    conversationUuid,
    label,
    agentId,
    createdAt: Date.now(),
  };
  const labelsPath = getAgyLabelsPath();
  try {
    fs.mkdirSync(path.dirname(labelsPath), { recursive: true });
    fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2), "utf-8");
  } catch (err) {
    console.error("[agy-labels] save failed:", err);
  }
}

/**
 * 저장된 agy conversation UUID 를 돌려준다 — 단 실제 .pb 파일이 아직 존재할
 * 때만 (agy 가 GC 했거나 사용자가 ~/.gemini 청소했으면 stale → null).
 */
export function getAgyConversationId(agentId: string): string | null {
  const entry = readAgyLabels()[agentId];
  if (!entry) return null;
  const pbPath = path.join(
    os.homedir(),
    ".gemini",
    "antigravity-cli",
    "conversations",
    `${entry.conversationUuid}.pb`,
  );
  return fs.existsSync(pbPath) ? entry.conversationUuid : null;
}

function buildMCPServerEntry(
  projectDir: string,
  marbloProjectId?: string,
  agentId?: string,
): MCPServerEntry {
  return {
    command: "node",
    args: [getMCPServerPath()],
    env: getMCPServerEnv(projectDir, marbloProjectId, agentId),
  };
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function frontmatterValue(content: string, key: string): string {
  const match = content.match(
    new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\r\\n]*))`, "m"),
  );
  return (match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

function discoverTfSkillDirs(projectDir: string): Array<{
  name: string;
  skillPath: string;
}> {
  const dirs = [
    // If a target project explicitly carries Marblo commands, prefer them.
    path.join(projectDir, ".claude", "skills"),
    ...TF_SKILL_DIR_CANDIDATES,
  ];
  const seen = new Set<string>();
  const result: Array<{ name: string; skillPath: string }> = [];

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("tf-")) continue;
      if (seen.has(entry.name)) continue;
      const skillPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;
      seen.add(entry.name);
      result.push({ name: entry.name, skillPath });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export class AgentConfigGenerator {
  private generatedFiles: Map<string, string[]> = new Map();

  /**
   * Generate model-specific MCP configuration file.
   * Returns the path to the generated config file.
   */
  generateMCPConfig(
    agentId: string,
    model: ModelType,
    projectDir: string,
    marbloProjectId?: string,
  ): string {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    const mcpEntry = buildMCPServerEntry(projectDir, marbloProjectId, agentId);

    switch (model) {
      case "claude":
        return this.generateClaudeConfig(agentId, mcpEntry);
      case "gemini":
        return this.generateGeminiConfig(agentId, mcpEntry);
      case "gpt":
        return this.generateGPTConfig(agentId, mcpEntry, projectDir);
      case "antigravity":
        return this.generateAntigravityConfig(agentId, mcpEntry);
      case "custom":
        return this.generateCustomConfig(agentId, mcpEntry);
      default:
        return this.generateClaudeConfig(agentId, mcpEntry);
    }
  }

  /**
   * Generate role-specific skill file in the project's skills directory.
   * Returns the path to the skill file.
   */
  generateSkillFile(agentId: string, role: string, projectDir: string): string {
    const safeRole = role.replace(/[^a-zA-Z0-9_]/g, "");
    const skillSource = path.join(SKILLS_DIR, `${safeRole}_agent.md`);

    // If skill file exists in v3/skills/, return its path
    if (fs.existsSync(skillSource)) {
      return skillSource;
    }

    // Fallback: try without _agent suffix
    const altSource = path.join(SKILLS_DIR, `${safeRole}.md`);
    if (fs.existsSync(altSource)) {
      return altSource;
    }

    // No skill file found — return empty path
    return "";
  }

  /**
   * Get unified launch configuration for an agent.
   */
  getLaunchConfig(
    agent: { id: string; model: ModelType; role: string; command: string },
    projectDir: string,
    initialPrompt?: string,
    marbloProjectId?: string,
    resumeSessionId?: string,
    // Opt-in: pin a fresh Claude launch to a generated --session-id so its
    // tokens attribute deterministically. The agent path passes true; the
    // orchestrator leaves it false (manages its own session). See
    // claudeSessionArgs.
    pinClaudeSession = false,
    // 작업 난이도 — claude(--model)·codex(reasoning) 모델/레벨 선택에 쓰인다.
    // 미지정(오케스트레이터 경로)이면 기본 모델 유지(opus).
    complexity?: TaskComplexity,
  ): LaunchConfig {
    const mcpConfigPath = this.generateMCPConfig(
      agent.id,
      agent.model,
      projectDir,
      marbloProjectId,
    );
    const skillPath = this.generateSkillFile(agent.id, agent.role, projectDir);
    const skillContent =
      skillPath && fs.existsSync(skillPath)
        ? fs.readFileSync(skillPath, "utf-8")
        : "";

    const { command, args, env, claudeSessionId } = this.buildCLICommand(
      agent.model,
      agent.command,
      mcpConfigPath,
      projectDir,
      marbloProjectId,
      agent.id,
      resumeSessionId,
      pinClaudeSession,
      complexity,
    );

    return {
      model: agent.model,
      command,
      args,
      env,
      mcpConfigPath,
      skillContent,
      initialPrompt,
      claudeSessionId,
    };
  }

  /**
   * Whether the given agent's isolated home contains any saved sessions
   * for the given CLI. Used by reconnect to decide whether `resume --last`
   * (or equivalent) is safe to pass — running it against an empty
   * sessions dir errors out on some CLIs.
   *
   * Codex stores at `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl`.
   * Gemini stores at `<HOME>/.gemini/tmp/<projectHash>/checkpoint-*.json`
   * (but the existence of `.gemini/tmp/` with any subdir is enough signal
   * for `--resume latest` to find something).
   */
  hasSavedSession(agentId: string, model: ModelType): boolean {
    if (model === "gpt") {
      const sessionsRoot = path.join(
        CONFIG_DIR,
        `codex-home-${agentId}`,
        "sessions",
      );
      return this.hasAnyFileBelow(sessionsRoot, ".jsonl");
    }
    if (model === "gemini") {
      const geminiTmp = path.join(
        CONFIG_DIR,
        `gemini-home-${agentId}`,
        ".gemini",
        "tmp",
      );
      return this.hasAnyFileBelow(geminiTmp, null);
    }
    if (model === "antigravity") {
      // A안 (격리 포기) 적용 후 agy 는 사용자 본인 ~/.gemini/antigravity-cli
      // 를 그대로 사용. 워커별 conversation UUID 는 saveAgyConversationLabel
      // 로 별도 매핑 파일(marblo-agy-labels.json)에 영속화된다. 이 파일에
      // 해당 agentId 엔트리가 있고 + 그 UUID 의 .pb 가 실제 존재해야 resume
      // 가능 → getAgyConversationId 가 그 둘을 한번에 검증한다.
      return getAgyConversationId(agentId) !== null;
    }
    return false;
  }

  private hasAnyFileBelow(root: string, suffix: string | null): boolean {
    try {
      if (!fs.existsSync(root)) return false;
      const stack = [root];
      while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile()) {
            if (!suffix || entry.name.endsWith(suffix)) return true;
          }
        }
      }
    } catch {
      // best-effort
    }
    return false;
  }

  /**
   * Clean up generated config files for an agent.
   */
  cleanup(agentId: string): void {
    const files = this.generatedFiles.get(agentId) || [];
    for (const filePath of files) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    this.generatedFiles.delete(agentId);
  }

  /**
   * Clean up all generated config files.
   */
  cleanupAll(): void {
    for (const [agentId] of this.generatedFiles) {
      this.cleanup(agentId);
    }
  }

  // --- Private: Model-specific config generators ---

  private generateClaudeConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
  ): string {
    const config = {
      mcpServers: {
        marblo: {
          command: mcpEntry.command,
          args: mcpEntry.args,
          env: mcpEntry.env || {},
        },
      },
    };

    const configPath = path.join(CONFIG_DIR, `claude-mcp-${agentId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    this.trackFile(agentId, configPath);
    return configPath;
  }

  private generateGeminiConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
  ): string {
    // Per-agent isolation strategy for Gemini CLI (verified against v0.43):
    //
    // 1) `GEMINI_CLI_HOME=<parent>` env redirect (not HOME override).
    //    gemini's internal homedir() reads GEMINI_CLI_HOME first; everything
    //    else in the process (~/Library/..., shell completions) stays on
    //    user's real $HOME. Whole-HOME override broke the auth flow even
    //    when oauth_creds was hard-copied — gemini's auth handshake never
    //    completes in a foreign $HOME tree.
    //
    // 2) HARD-COPY user's ~/.gemini/* into <parent>/.gemini/ (not symlink).
    //    Symlinks make gemini's atomic-rename writes orphan the original
    //    and the spinner never resolves. Plain copy keeps gemini happy and
    //    keeps token refreshes inside the isolated dir (acceptable — user's
    //    next native gemini run will refresh independently).
    //
    // 3) FORCE settings.security.auth.selectedType = "oauth-personal".
    //    Empty settings.json triggers the interactive "How would you like
    //    to authenticate for this project?" dialog, which --yolo can NOT
    //    auto-dismiss. Result: agent hangs forever on "Waiting for
    //    authentication..." spinner with no path forward. Pinning the
    //    auth type makes performInitialAuth use cached creds straight away.
    const geminiHome = path.join(CONFIG_DIR, `gemini-home-${agentId}`);
    const dotGemini = path.join(geminiHome, ".gemini");
    fs.mkdirSync(dotGemini, { recursive: true });

    // Hard-copy user's ~/.gemini/* (oauth_creds.json, installation_id,
    // google_accounts.json, projects.json, state.json, GEMINI.md, etc.)
    // so cached credentials and global instructions are available.
    //
    // Repair pre-existing broken state: older builds of this file created
    // symlinks here. Symlinks break gemini's auth (atomic-rename writes
    // orphan the target), so on encountering one we MUST unlink and
    // hard-copy fresh. Plain files left from a previous successful spawn
    // are kept — overwriting them would discard runtime state like
    // refreshed tokens.
    const userGeminiDir = path.join(os.homedir(), ".gemini");
    if (fs.existsSync(userGeminiDir)) {
      const copyRecursive = (src: string, dst: string) => {
        const stat = fs.lstatSync(src);
        if (stat.isDirectory()) {
          fs.mkdirSync(dst, { recursive: true });
          for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dst, child));
          }
        } else {
          // copyFileSync resolves symlinks — good, we want plain copies.
          fs.copyFileSync(src, dst);
        }
      };
      for (const entry of fs.readdirSync(userGeminiDir)) {
        if (entry === "settings.json") continue; // we write our own
        const dst = path.join(dotGemini, entry);
        if (fs.existsSync(dst)) {
          let isSymlink = false;
          try {
            isSymlink = fs.lstatSync(dst).isSymbolicLink();
          } catch {
            // lstat can throw for a dangling symlink — treat as broken.
            isSymlink = true;
          }
          if (!isSymlink) continue; // already a hard copy, leave alone
          try {
            fs.unlinkSync(dst);
          } catch {
            continue; // can't repair — skip rather than crash
          }
        }
        try {
          copyRecursive(path.join(userGeminiDir, entry), dst);
        } catch {
          // best-effort — some files may be unreadable (e.g. weird perms)
        }
      }
    }

    // Preserve user's non-MCP settings (theme, model defaults, etc.) and
    // merge with the auth type pin + our MCP entry.
    const userSettingsPath = path.join(userGeminiDir, "settings.json");
    let preserved: Record<string, unknown> = {};
    if (fs.existsSync(userSettingsPath)) {
      try {
        preserved = JSON.parse(
          fs.readFileSync(userSettingsPath, "utf-8"),
        ) as Record<string, unknown>;
        delete (preserved as Record<string, unknown>).mcpServers;
      } catch {
        // best-effort
      }
    }

    const preservedSecurity = ((preserved as Record<string, unknown>)
      .security ?? {}) as Record<string, unknown>;
    const preservedAuth = (preservedSecurity.auth ?? {}) as Record<
      string,
      unknown
    >;
    const config = {
      ...preserved,
      security: {
        ...preservedSecurity,
        auth: {
          // Default to Google OAuth; respect user's pin if they set a
          // different one (e.g. gemini-api-key, vertex-ai).
          selectedType: preservedAuth.selectedType ?? "oauth-personal",
          ...preservedAuth,
        },
      },
      mcpServers: {
        marblo: {
          command: mcpEntry.command,
          args: mcpEntry.args,
          env: mcpEntry.env || {},
        },
      },
    };

    const settingsPath = path.join(dotGemini, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2), "utf-8");

    this.trackFile(agentId, settingsPath);
    return settingsPath;
  }

  private generateAntigravityConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
  ): string {
    // Antigravity (agy) CLI — agy 1.0.2 / v1.20+ 기준.
    //
    // ★ 격리 포기 (2026-05-27). agy 의 macOS Keychain 엔트리는 HOME 기준으로
    //   키잉돼 있어서 HOME / --gemini_dir override 하면 keyring lookup 이
    //   실패하고 OAuth 재인증 (invalid_grant) 로 빠진다. 사용자 본인
    //   ~/.gemini 를 그대로 쓰게 두는 게 유일한 안정 경로.
    //
    // ★ MCP 통합 (2026-05-27 추가). agy 의 공식 MCP 설정 경로:
    //     ~/.gemini/antigravity-cli/mcp_config.json
    //   여기에 marblo MCP 항목을 머지한다. 다른 MCP 서버 항목은 그대로 보존.
    //   per-agent 변수 (MARBLO_AGENT_ID/PROJECT/BRIDGE_PORT/PATH) 는 ${VAR}
    //   substitution 으로 박아둬서, 동시에 여러 agy PTY 가 떠도 각자 자기
    //   env 값으로 치환된다 (agy v1.20+ 가 MCP 자식 스폰 시 변환).
    //
    //   제약: 단일 Marblo 인스턴스 가정. 여러 Marblo 윈도우가 같은 글로벌
    //   파일에 동시 write 하면 마지막 writer 가 이김 (단, marblo entry 자체는
    //   거의 idempotent 라 실제 충돌은 드묾). 다중 인스턴스 격리는 별도 트랙.
    const globalConfigDir = path.join(
      os.homedir(),
      ".gemini",
      "antigravity-cli",
    );
    fs.mkdirSync(globalConfigDir, { recursive: true });
    const globalConfigPath = path.join(globalConfigDir, "mcp_config.json");

    // per-agent 로 달라야 하는 변수는 ${VAR} substitution 사용.
    // 상수성 변수 (Firebase, MARBLO_SKILLS_DIR) 는 literal 로 박는다.
    const SUBSTITUTE_KEYS = new Set([
      "PATH",
      "MARBLO_AGENT_ID",
      "MARBLO_PROJECT",
      "MARBLO_BRIDGE_PORT",
    ]);
    const marbloEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(mcpEntry.env || {})) {
      marbloEnv[key] = SUBSTITUTE_KEYS.has(key) ? `\${${key}}` : value;
    }

    let existing: Record<string, unknown> = {};
    let parseError: unknown = null;
    if (fs.existsSync(globalConfigPath)) {
      try {
        existing = JSON.parse(
          fs.readFileSync(globalConfigPath, "utf-8"),
        ) as Record<string, unknown>;
      } catch (err) {
        parseError = err;
      }
    }

    if (parseError) {
      // 사용자의 손상된 JSON 을 함부로 덮어쓰지 않는다 — 로그만 남기고
      // sentinel 만 생성해서 cleanup contract 충족. 사용자가 파일을 손보면
      // 다음 spawn 부터 정상 머지.
      console.warn(
        `[agy] ${globalConfigPath} parse failed (${parseError}); leaving file untouched, MCP disabled for this agent.`,
      );
    } else {
      const existingServers = (existing.mcpServers ?? {}) as Record<
        string,
        unknown
      >;
      const merged = {
        ...existing,
        mcpServers: {
          ...existingServers,
          marblo: {
            command: mcpEntry.command,
            args: mcpEntry.args,
            env: marbloEnv,
          },
        },
      };
      fs.writeFileSync(
        globalConfigPath,
        JSON.stringify(merged, null, 2),
        "utf-8",
      );
      // NOTE: do NOT trackFile() globalConfigPath — it's user-shared.
      // cleanup() would clobber other agents' / other MCP servers' state.
    }

    // 우리 CONFIG_DIR 의 sentinel 만 트래킹 → cleanup contract 만족.
    // sentinel 에 globalConfigPath 를 기록해서 디버그 시 어디로 머지했는지
    // 추적 가능.
    const sentinelDir = path.join(CONFIG_DIR, `antigravity-home-${agentId}`);
    fs.mkdirSync(sentinelDir, { recursive: true });
    const sentinelPath = path.join(sentinelDir, "marblo-sentinel.json");
    fs.writeFileSync(
      sentinelPath,
      JSON.stringify(
        {
          agentId,
          globalConfigPath,
          mergeFailed: !!parseError,
          createdAt: Date.now(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    this.trackFile(agentId, sentinelPath);
    return sentinelPath;
  }

  private generateGPTConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
    projectDir: string,
  ): string {
    // Codex CLI reads config from `$CODEX_HOME/config.toml` (TOML, not JSON)
    // with `[mcp_servers.<name>]` sections. Each agent gets an ISOLATED
    // CODEX_HOME so its config.toml can hardcode the per-agent
    // MARBLO_AGENT_ID — Codex passes only the env declared in
    // `[mcp_servers.<name>.env]` to the spawned MCP child, so we cannot
    // rely on inherited process env to vary MARBLO_AGENT_ID across agents.
    //
    // We preserve the user's model / reasoning preferences from their
    // real ~/.codex/config.toml (sans any existing [mcp_servers.*] and
    // any [features] block — the latter so user-enabled experimental
    // toggles like `goals=true` don't leak into Marblo agents and surface
    // unstable-feature warnings) and symlink auth.json so Codex stays
    // authenticated.
    const codexHome = path.join(CONFIG_DIR, `codex-home-${agentId}`);
    fs.mkdirSync(codexHome, { recursive: true });

    // Preserve user's non-MCP Codex config so model/reasoning prefs survive.
    const userCodexDir = path.join(os.homedir(), ".codex");
    const userConfigPath = path.join(userCodexDir, "config.toml");
    let preserved = "";
    if (fs.existsSync(userConfigPath)) {
      try {
        const raw = fs.readFileSync(userConfigPath, "utf-8");
        // Strip:
        //  - [mcp_servers.*]   — per-agent config injects only marblo.
        //  - [features]        — user-toggled experimental flags must not
        //                        leak into the agent (unstable-feature warns).
        //  - [projects.*]      — Marblo re-emits a fresh trust entry for the
        //                        agent's projectDir below. Keeping the
        //                        user's entries here risks a TOML duplicate
        //                        key error when the user has already
        //                        trusted the same dir from their own CLI
        //                        use (codex refuses to load the config and
        //                        the agent dies on spawn).
        preserved = raw
          .replace(/\[mcp_servers\.[\s\S]*?(?=\n\[(?!mcp_servers)|$)/g, "")
          .replace(/\[features\][\s\S]*?(?=\n\[|$)/g, "")
          .replace(/\[projects\.[\s\S]*?(?=\n\[(?!projects)|$)/g, "")
          .trimEnd();
      } catch {
        // Best-effort — ignore unreadable user config.
      }
    }

    // Symlink auth.json so Codex inherits the user's authentication.
    const userAuth = path.join(userCodexDir, "auth.json");
    const targetAuth = path.join(codexHome, "auth.json");
    if (fs.existsSync(userAuth) && !fs.existsSync(targetAuth)) {
      try {
        fs.symlinkSync(userAuth, targetAuth);
      } catch {
        try {
          fs.copyFileSync(userAuth, targetAuth);
        } catch {
          /* ignore */
        }
      }
    }

    this.generateCodexTfPrompts(agentId, codexHome, projectDir);

    // Auto-trust the agent's working directory so Codex doesn't show its
    // "Do you trust the contents of this directory?" interactive dialog
    // on first run. Without this, the dialog blocks the TUI before any
    // readiness pattern matches → Marblo's 10s prompt-fallback fires
    // mid-dialog → codex receives the prompt as keystroke noise and
    // exits cleanly (code 0), leaving an unusable agent.
    //
    // We resolve symlinks (`realpath`) because macOS reports `/tmp` to
    // codex as `/private/tmp`, and the trust check is exact-string.
    // Wildcard parents (e.g. `/Users/foo` covering everything under it)
    // don't grant trust to subdirs in current Codex versions — only an
    // exact match does.
    const trustEntries: string[] = [];
    if (projectDir) {
      const seen = new Set<string>();
      for (const candidate of [projectDir, this.safeRealpath(projectDir)]) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        trustEntries.push(
          `[projects.${JSON.stringify(candidate)}]`,
          'trust_level = "trusted"',
          "",
        );
      }
    }

    // Build TOML for the Marblo MCP entry. JSON.stringify produces valid
    // TOML for strings / arrays / numbers; we use it to escape values.
    const envEntries = Object.entries(mcpEntry.env || {})
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n");

    const tomlSections = [
      preserved,
      "",
      ...trustEntries,
      "[mcp_servers.marblo]",
      `command = ${JSON.stringify(mcpEntry.command)}`,
      `args = ${JSON.stringify(mcpEntry.args)}`,
      "tool_timeout_sec = 60",
    ];
    if (envEntries) {
      tomlSections.push("", "[mcp_servers.marblo.env]", envEntries);
    }
    const toml = tomlSections.join("\n") + "\n";

    const configPath = path.join(codexHome, "config.toml");
    fs.writeFileSync(configPath, toml, "utf-8");
    this.trackFile(agentId, configPath);
    this.trackFile(agentId, targetAuth);
    // Return the file path; buildCLICommand derives CODEX_HOME from dirname.
    return configPath;
  }

  private generateCodexTfPrompts(
    agentId: string,
    codexHome: string,
    projectDir: string,
  ): void {
    const promptDir = path.join(codexHome, "prompts");
    const skills = discoverTfSkillDirs(projectDir);
    if (skills.length === 0) return;

    fs.mkdirSync(promptDir, { recursive: true });
    for (const skill of skills) {
      let raw = "";
      try {
        raw = fs.readFileSync(skill.skillPath, "utf-8");
      } catch {
        continue;
      }

      const description =
        frontmatterValue(raw, "description") ||
        `Run the Marblo /${skill.name} workflow`;
      const argumentHint = frontmatterValue(raw, "argument-hint");
      const body = stripFrontmatter(raw);
      const prompt = [
        "---",
        `description: ${yamlString(description)}`,
        ...(argumentHint ? [`argument-hint: ${yamlString(argumentHint)}`] : []),
        "---",
        "",
        `You are executing the Marblo /${skill.name} workflow inside Codex CLI.`,
        "Follow the workflow below exactly. Use Marblo MCP tools for task, agent, and activity operations.",
        "If the workflow mentions Claude-specific slash command mechanics, interpret the included instructions directly in Codex.",
        "",
        "User arguments:",
        "$ARGUMENTS",
        "",
        `# Marblo /${skill.name} workflow`,
        "",
        body,
        "",
      ].join("\n");

      const promptPath = path.join(promptDir, `${skill.name}.md`);
      fs.writeFileSync(promptPath, prompt, "utf-8");
      this.trackFile(agentId, promptPath);
    }
  }

  private safeRealpath(p: string): string | null {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  }

  private generateCustomConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
  ): string {
    // Generic MCP config — same structure, custom CLI may or may not use it
    const config = {
      mcpServers: {
        marblo: {
          command: mcpEntry.command,
          args: mcpEntry.args,
          env: mcpEntry.env || {},
        },
      },
    };

    const configPath = path.join(CONFIG_DIR, `custom-mcp-${agentId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    this.trackFile(agentId, configPath);
    return configPath;
  }

  // --- Private: Build CLI command with MCP config injection ---

  private buildCLICommand(
    model: ModelType,
    baseCommand: string,
    mcpConfigPath: string,
    projectDir: string,
    marbloProjectId?: string,
    agentId?: string,
    resumeSessionId?: string,
    pinFreshClaudeSession = false,
    complexity?: TaskComplexity,
  ): {
    command: string;
    args: string[];
    env: Record<string, string>;
    claudeSessionId?: string;
  } {
    const env = getMCPServerEnv(projectDir, marbloProjectId, agentId);
    // Normalize resume signals: "new" means force-fresh, "latest" means
    // "pick the most recent" (CLI-specific syntax), anything else is a
    // concrete session id.
    const wantResume = resumeSessionId && resumeSessionId !== "new";
    const resumeIsLatest = resumeSessionId === "latest";

    // NOTE: Initial prompts are NOT passed via CLI flags (e.g. -p) because
    // that runs non-interactively and exits. Instead, prompts are sent via
    // stdin after the CLI starts, keeping the session interactive.
    switch (model) {
      case "claude": {
        // Pin the session id up front so cost tracking can attribute tokens
        // deterministically (see claudeSessionArgs). A fresh launch gets
        // `--session-id <uuid>` when pinning is opted in (agent path); a
        // concrete resume gets `--resume <uuid>`; an unresolved "latest" stays
        // unpinned (caller resolves it before we get here, else the legacy
        // detector recovers it).
        const { args: sessionArgs, sessionId } = claudeSessionArgs(
          resumeSessionId,
          crypto.randomUUID(),
          pinFreshClaudeSession,
        );
        // complexity 기반 모델 핀(--model). 미지정(오케 경로)이면 기본 모델 상속.
        const { claudeModel } = modelTierForComplexity(model, complexity);
        return {
          command: baseCommand || resolveClaudeBinary().command,
          args: [
            "--dangerously-skip-permissions",
            ...(claudeModel ? ["--model", claudeModel] : []),
            "--mcp-config",
            mcpConfigPath,
            ...sessionArgs,
          ],
          env,
          claudeSessionId: sessionId,
        };
      }

      case "gemini": {
        // Per-agent isolation via GEMINI_CLI_HOME (NOT HOME override).
        // Gemini's internal homedir() reads GEMINI_CLI_HOME and uses it
        // as the parent of `.gemini`. Whole-HOME override broke gemini's
        // auth handshake even when oauth_creds was hard-copied — verified
        // with node-pty repro against gemini-cli v0.43.0.
        //
        // mcpConfigPath = `<geminiHome>/.gemini/settings.json`,
        // so geminiHome (the GEMINI_CLI_HOME value) is two levels up.
        const geminiHome = path.dirname(path.dirname(mcpConfigPath));
        // --yolo: auto-approve tool calls. Without it gemini shows
        // interactive approval prompts mid-session.
        // GEMINI_CLI_TRUST_WORKSPACE=true: equivalent to the removed
        // --skip-trust flag (per gemini-cli docs/cli/trusted-folders.md).
        // settings.security.auth.selectedType is pinned in
        // generateGeminiConfig so --yolo's "How would you like to
        // authenticate" dialog never appears.
        const geminiArgs: string[] = ["--yolo"];
        if (wantResume) {
          // gemini-cli 의 `--resume` 은 "latest" sentinel 만 의미있게 처리한다
          // (concrete UUID 는 호출자가 latest 로 normalize 해서 들어옴 —
          // main.ts reconnect 의 gemini 분기는 hasSavedSession 통과 시
          // "latest" 로 고정). 양쪽 분기를 명시적으로 "latest" 로 통일.
          geminiArgs.push("--resume", "latest");
        }
        return {
          command: baseCommand || "gemini",
          args: geminiArgs,
          env: {
            ...env,
            GEMINI_CLI_HOME: geminiHome,
            GEMINI_CLI_TRUST_WORKSPACE: "true",
          },
        };
      }

      case "gpt": {
        // Codex CLI (Rust): reads config from $CODEX_HOME/config.toml — point
        // it at our per-agent dir (created by generateGPTConfig) so the
        // [mcp_servers.marblo] entry is loaded.
        //
        // The legacy `--full-auto` flag was removed in modern Codex; the
        // current equivalent is two TOML overrides via `-c key=value`:
        //   approval_policy="never"      — don't prompt for tool approvals
        //   sandbox_mode="danger-full-access" — let the agent edit anything
        // Together these mirror Claude Code's --dangerously-skip-permissions
        // and let Marblo agents run unattended.
        //
        // Resume: `codex resume` is a SUBCOMMAND, not a flag — it must
        // come BEFORE the global `-c` overrides. `codex resume --last`
        // continues the most recent session in this CODEX_HOME (which is
        // per-agent, so "most recent" = "this agent's last session").
        // A concrete UUID becomes the positional arg `codex resume <UUID>`.
        const codexArgs: string[] = [];
        if (wantResume) {
          codexArgs.push("resume");
          if (resumeIsLatest) codexArgs.push("--last");
          else codexArgs.push(resumeSessionId!);
        }
        codexArgs.push(
          "-c",
          'approval_policy="never"',
          "-c",
          'sandbox_mode="danger-full-access"',
        );
        // complexity 기반 reasoning effort(모델은 사용자 config 유지). 미지정이면
        // override 안 함. complex→high, standard→medium, simple→low.
        const { codexReasoning } = modelTierForComplexity(model, complexity);
        if (codexReasoning) {
          codexArgs.push("-c", `model_reasoning_effort="${codexReasoning}"`);
        }
        // Reject `baseCommand === "gpt"` — that's the model slug accidentally
        // saved to the Firestore agent doc by older builds of Layout.tsx, and
        // it shadows macOS's /usr/sbin/gpt (GUID Partition Table utility)
        // which exits with "gpt: illegal option -- c" on our flag set. The
        // user's intent is the Codex CLI; honor that even with stale docs.
        const codexCommand =
          !baseCommand || baseCommand === "gpt" ? "codex" : baseCommand;
        return {
          command: codexCommand,
          args: codexArgs,
          env: { ...env, CODEX_HOME: path.dirname(mcpConfigPath) },
        };
      }

      case "antigravity": {
        // Antigravity (agy) CLI — agy 1.0.2 기준.
        //
        // ★ 격리 포기 (2026-05-27). agy 의 macOS Keychain 엔트리는 HOME
        //   기준으로 키잉돼 있어 HOME 또는 --gemini_dir 둘 중 하나라도
        //   override 하면 keyring lookup 이 실패하고 OAuth 재인증 flow 로
        //   빠진다. 라이브 검증 — token exchange invalid_grant.
        //
        //   결정: 사용자 본인 ~/.gemini 를 그대로 쓰게 한다. 환경/플래그
        //   override 없이 그냥 `agy` 를 부른다. 워커 간 conversation/state
        //   충돌은 별도 트래킹.
        //
        // MCP: agy v1 은 MCP 미통합. mcpConfigPath 는 generateAntigravityConfig
        //   의 sentinel 일 뿐, agy 가 읽지 않는다.
        //
        // Resume:
        //   resumeSessionId = concrete UUID → --conversation <UUID> (정확)
        //   resumeSessionId = 'latest'       → --continue (가장 최근)
        //   ※ agent-manager 의 antigravity conversation watcher 가 spawn
        //     35s 후 새 .pb basename 을 캡처해 onSessionDetected 로
        //     Firestore 에 저장하므로, 다음 reconnect 부터는 UUID 가
        //     들어와 정확한 resume 가능.
        // --dangerously-skip-permissions: agy 도 Claude 와 동일한 플래그명으로
        //   모든 tool permission 요청을 자동 승인한다 — agy --help 기준
        //   "Auto-approve all tool permission requests without prompting".
        //   이게 없으면 워커가 매 tool 호출마다 대화형 승인 프롬프트를 띄워
        //   무인(헤드리스 PTY) 실행이 멈춘다. Claude 의
        //   --dangerously-skip-permissions / Codex 의 approval_policy="never" /
        //   Gemini 의 --yolo 와 같은 "기본 욜로모드" 역할.
        //   ※ agy 에는 --yolo 플래그가 없다 (Gemini CLI 와 다름).
        const agyArgs: string[] = ["--dangerously-skip-permissions"];
        if (wantResume) {
          if (resumeIsLatest) {
            agyArgs.push("--continue");
          } else {
            agyArgs.push("--conversation", resumeSessionId!);
          }
        }
        // Reject `baseCommand === "antigravity"` — that's the model slug
        // accidentally saved to the Firestore agent doc by some build paths
        // (`agent.command = agent.model`). Treat it as "no explicit override"
        // and fall back to the real CLI binary `agy`. Mirrors the same
        // defensive logic for gpt → codex below.
        const agyCommand =
          !baseCommand || baseCommand === "antigravity" ? "agy" : baseCommand;
        return {
          command: agyCommand,
          args: agyArgs,
          env: {
            ...env,
            // 미래 agy 가 MCP 를 채널로 받게 되면 활용 — 현재는 no-op.
            MCP_CONFIG_PATH: mcpConfigPath,
          },
        };
      }

      case "custom":
        return {
          command: baseCommand,
          args: [],
          env: { ...env, MCP_CONFIG_PATH: mcpConfigPath },
        };

      default:
        return { command: baseCommand, args: [], env };
    }
  }

  private trackFile(agentId: string, filePath: string): void {
    const files = this.generatedFiles.get(agentId) || [];
    files.push(filePath);
    this.generatedFiles.set(agentId, files);
  }
}
