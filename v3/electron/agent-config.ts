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

    const { command, args, env } = this.buildCLICommand(
      agent.model,
      agent.command,
      mcpConfigPath,
      projectDir,
      marbloProjectId,
      agent.id,
      resumeSessionId,
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
  ): { command: string; args: string[]; env: Record<string, string> } {
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
      case "claude":
        // Claude Code accepts `--resume <UUID>` as a flag; "latest" is
        // resolved to a UUID by the caller via resolveSessionId before we
        // get here, so we only emit --resume when we have a concrete id.
        return {
          command: baseCommand || "claude",
          args: [
            "--dangerously-skip-permissions",
            "--mcp-config",
            mcpConfigPath,
            ...(wantResume && !resumeIsLatest
              ? ["--resume", resumeSessionId!]
              : []),
          ],
          env,
        };

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
          geminiArgs.push("--resume", resumeIsLatest ? "latest" : "latest");
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
        // Antigravity (agy) CLI — Google I/O 2026 release.
        // v1 integration: spawn `agy` with no MCP integration. Antigravity's
        // MCP discovery path is not yet publicly documented as of the v2.0
        // launch (2026-05-19) — the agent runs standalone, useful for general
        // TUI work but not yet wired to Marblo TaskForce. MCP_CONFIG_PATH is
        // exposed via env on a best-effort basis in case future versions
        // adopt the same convention as `custom`.
        //
        // Auth: OAuth browser flow on first run (similar to gemini).
        // Resume: no `--resume`/`--last` flag documented yet — fresh session
        // every spawn until Antigravity ships session management.
        return {
          command: baseCommand || "agy",
          args: [],
          env: { ...env, MCP_CONFIG_PATH: mcpConfigPath },
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
