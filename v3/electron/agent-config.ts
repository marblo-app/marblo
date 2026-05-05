import fs from "fs";
import path from "path";
import os from "os";
import { ModelType } from "./agent-manager";

export interface LaunchConfig {
  model: ModelType;
  command: string;
  args: string[];
  env: Record<string, string>;
  mcpConfigPath: string;
  skillContent: string;
  initialPrompt?: string;
}

interface MCPServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const SKILLS_DIR = path.resolve(__dirname, "..", "skills");
const CONFIG_DIR = path.resolve(os.tmpdir(), "marblo-agent-configs");

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
    path.join(os.homedir(), ".npm/bin"),
    path.join(os.homedir(), ".local/bin"),
    path.join(os.homedir(), ".cargo/bin"),
  ];

  const pathSet = new Set(basePath.split(":"));
  for (const p of extraPaths) {
    pathSet.add(p);
  }
  return Array.from(pathSet).join(":");
}

function getMCPServerEnv(
  projectDir: string,
  marbloProjectId?: string,
  agentId?: string
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

function buildMCPServerEntry(
  projectDir: string,
  marbloProjectId?: string,
  agentId?: string
): MCPServerEntry {
  return {
    command: "node",
    args: [getMCPServerPath()],
    env: getMCPServerEnv(projectDir, marbloProjectId, agentId),
  };
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
    marbloProjectId?: string
  ): string {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    const mcpEntry = buildMCPServerEntry(projectDir, marbloProjectId, agentId);

    switch (model) {
      case "claude":
        return this.generateClaudeConfig(agentId, mcpEntry);
      case "gemini":
        return this.generateGeminiConfig(agentId, mcpEntry);
      case "gpt":
        return this.generateGPTConfig(agentId, mcpEntry);
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
    marbloProjectId?: string
  ): LaunchConfig {
    const mcpConfigPath = this.generateMCPConfig(
      agent.id,
      agent.model,
      projectDir,
      marbloProjectId
    );
    const skillPath = this.generateSkillFile(agent.id, agent.role, projectDir);
    const skillContent =
      skillPath && fs.existsSync(skillPath)
        ? fs.readFileSync(skillPath, "utf-8")
        : "";

    const { command, args, env } = this.buildCLICommand(
      agent.model,
      agent.command,
      mcpConfigPath,
      projectDir,
      marbloProjectId,
      agent.id
    );

    return {
      model: agent.model,
      command,
      args,
      env,
      mcpConfigPath,
      skillContent,
      initialPrompt,
    };
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
    mcpEntry: MCPServerEntry
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
    mcpEntry: MCPServerEntry
  ): string {
    // Gemini CLI reads MCP config from `~/.gemini/settings.json` with a
    // top-level `mcpServers` map, same shape as Claude Code. Like Codex,
    // we need per-agent isolation because the spawned MCP child only
    // sees the env declared in the config block — process env doesn't
    // propagate, so each agent has to pin its own MARBLO_AGENT_ID.
    //
    // Strategy mirrors generateGPTConfig: write `<isolated-home>/.gemini/
    // settings.json`, preserve the user's non-MCP settings, and let
    // buildCLICommand point HOME at <isolated-home> so Gemini reads our
    // copy. (Gemini follows XDG-ish home conventions; HOME override is
    // the universal lever.)
    const geminiHome = path.join(CONFIG_DIR, `gemini-home-${agentId}`);
    const dotGemini = path.join(geminiHome, ".gemini");
    fs.mkdirSync(dotGemini, { recursive: true });

    // Preserve user's non-MCP settings so model preferences / theme /
    // auth pointers survive. Strip any existing mcpServers entries and
    // replace with ours.
    const userSettingsPath = path.join(
      os.homedir(),
      ".gemini",
      "settings.json"
    );
    let preserved: Record<string, unknown> = {};
    if (fs.existsSync(userSettingsPath)) {
      try {
        const raw = fs.readFileSync(userSettingsPath, "utf-8");
        preserved = JSON.parse(raw) as Record<string, unknown>;
        delete (preserved as Record<string, unknown>).mcpServers;
      } catch {
        // best-effort
      }
    }

    const config = {
      ...preserved,
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

    // Symlink auth-related files (oauth_creds.json, GEMINI.md, etc.) so
    // Gemini stays authenticated and inherits any user instructions.
    const userGeminiDir = path.join(os.homedir(), ".gemini");
    if (fs.existsSync(userGeminiDir)) {
      try {
        for (const entry of fs.readdirSync(userGeminiDir)) {
          if (entry === "settings.json") continue; // we wrote our own
          const src = path.join(userGeminiDir, entry);
          const dst = path.join(dotGemini, entry);
          if (fs.existsSync(dst)) continue;
          try {
            fs.symlinkSync(src, dst);
          } catch {
            // Ignore symlink errors (e.g. on Windows without privilege)
          }
        }
      } catch {
        // best-effort
      }
    }

    this.trackFile(agentId, settingsPath);
    return settingsPath;
  }

  private generateGPTConfig(agentId: string, mcpEntry: MCPServerEntry): string {
    // Codex CLI reads config from `$CODEX_HOME/config.toml` (TOML, not JSON)
    // with `[mcp_servers.<name>]` sections. Each agent gets an ISOLATED
    // CODEX_HOME so its config.toml can hardcode the per-agent
    // MARBLO_AGENT_ID — Codex passes only the env declared in
    // `[mcp_servers.<name>.env]` to the spawned MCP child, so we cannot
    // rely on inherited process env to vary MARBLO_AGENT_ID across agents.
    //
    // We preserve the user's model / reasoning preferences from their
    // real ~/.codex/config.toml (sans any existing [mcp_servers.*]) and
    // symlink auth.json so Codex stays authenticated.
    const codexHome = path.join(CONFIG_DIR, `codex-home-${agentId}`);
    fs.mkdirSync(codexHome, { recursive: true });

    // Preserve user's non-MCP Codex config so model/reasoning prefs survive.
    const userCodexDir = path.join(os.homedir(), ".codex");
    const userConfigPath = path.join(userCodexDir, "config.toml");
    let preserved = "";
    if (fs.existsSync(userConfigPath)) {
      try {
        const raw = fs.readFileSync(userConfigPath, "utf-8");
        // Strip existing [mcp_servers.*] sections — naive but effective.
        // Matches a section header through to (next non-mcp section | EOF).
        preserved = raw
          .replace(/\[mcp_servers\.[\s\S]*?(?=\n\[(?!mcp_servers)|$)/g, "")
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

    // Build TOML for the Marblo MCP entry. JSON.stringify produces valid
    // TOML for strings / arrays / numbers; we use it to escape values.
    const envEntries = Object.entries(mcpEntry.env || {})
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n");

    const tomlSections = [
      preserved,
      "",
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

  private generateCustomConfig(
    agentId: string,
    mcpEntry: MCPServerEntry
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
    agentId?: string
  ): { command: string; args: string[]; env: Record<string, string> } {
    const env = getMCPServerEnv(projectDir, marbloProjectId, agentId);

    // NOTE: Initial prompts are NOT passed via CLI flags (e.g. -p) because
    // that runs non-interactively and exits. Instead, prompts are sent via
    // stdin after the CLI starts, keeping the session interactive.
    switch (model) {
      case "claude":
        return {
          command: baseCommand || "claude",
          args: [
            "--dangerously-skip-permissions",
            "--mcp-config",
            mcpConfigPath,
          ],
          env,
        };

      case "gemini": {
        // Gemini CLI reads `~/.gemini/settings.json`, so point HOME at our
        // per-agent isolated home (created by generateGeminiConfig) — that
        // dir already contains a `.gemini/settings.json` with the Marblo
        // MCP entry plus the user's preserved non-MCP settings and
        // symlinked auth/config files. Same isolation rationale as Codex
        // (CODEX_HOME): the MCP child only sees env declared in the
        // settings block, so each agent needs its own settings file
        // bearing its own MARBLO_AGENT_ID.
        //
        // mcpConfigPath here is `<geminiHome>/.gemini/settings.json`, so
        // <geminiHome> is two levels up.
        const geminiHome = path.dirname(path.dirname(mcpConfigPath));
        return {
          command: baseCommand || "gemini",
          args: [],
          env: { ...env, HOME: geminiHome },
        };
      }

      case "gpt":
        // Codex CLI reads its config from $CODEX_HOME/config.toml — point it
        // at our per-agent dir (created by generateGPTConfig) so the
        // [mcp_servers.marblo] entry is loaded and Marblo MCP becomes
        // callable. Without this, Codex only sees the user's global
        // ~/.codex/config.toml and never finds Marblo's MCP.
        return {
          command: baseCommand || "codex",
          args: ["--full-auto"],
          env: { ...env, CODEX_HOME: path.dirname(mcpConfigPath) },
        };

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
