import fs from 'fs';
import path from 'path';
import os from 'os';
import { ModelType } from './agent-manager';

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

const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
const CONFIG_DIR = path.resolve(os.tmpdir(), 'marblo-agent-configs');

// MCP server entry point (compiled JS in dist-mcp/)
function getMCPServerPath(): string {
  return path.resolve(__dirname, '..', 'dist-mcp', 'index.js');
}

/**
 * Get a rich PATH that includes common binary locations.
 * Electron on macOS doesn't inherit the user's shell PATH when launched from Finder.
 */
function getEnrichedPath(): string {
  const basePath = process.env.PATH || '';
  const extraPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.nvm/versions/node', process.version, 'bin'),
    path.join(os.homedir(), '.npm/bin'),
    path.join(os.homedir(), '.local/bin'),
    path.join(os.homedir(), '.cargo/bin'),
  ];

  const pathSet = new Set(basePath.split(':'));
  for (const p of extraPaths) {
    pathSet.add(p);
  }
  return Array.from(pathSet).join(':');
}

function getMCPServerEnv(projectDir: string, marbloProjectId?: string, agentId?: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: getEnrichedPath(),
  };

  // Forward Firebase env vars if present
  const firebaseVars = [
    'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID',
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
  ];

  for (const key of firebaseVars) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  // Set Marblo-specific env — prefer explicit projectId, fallback to process.env
  const resolvedProject = marbloProjectId || process.env.MARBLO_PROJECT || '';
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

function buildMCPServerEntry(projectDir: string, marbloProjectId?: string, agentId?: string): MCPServerEntry {
  return {
    command: 'node',
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
  generateMCPConfig(agentId: string, model: ModelType, projectDir: string, marbloProjectId?: string): string {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    const mcpEntry = buildMCPServerEntry(projectDir, marbloProjectId, agentId);

    switch (model) {
      case 'claude':
        return this.generateClaudeConfig(agentId, mcpEntry);
      case 'gemini':
        return this.generateGeminiConfig(agentId, mcpEntry);
      case 'gpt':
        return this.generateGPTConfig(agentId, mcpEntry);
      case 'custom':
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
    const safeRole = role.replace(/[^a-zA-Z0-9_]/g, '');
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
    return '';
  }

  /**
   * Get unified launch configuration for an agent.
   */
  getLaunchConfig(
    agent: { id: string; model: ModelType; role: string; command: string },
    projectDir: string,
    initialPrompt?: string,
    marbloProjectId?: string,
  ): LaunchConfig {
    const mcpConfigPath = this.generateMCPConfig(agent.id, agent.model, projectDir, marbloProjectId);
    const skillPath = this.generateSkillFile(agent.id, agent.role, projectDir);
    const skillContent = skillPath && fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8') : '';

    const { command, args, env } = this.buildCLICommand(agent.model, agent.command, mcpConfigPath, projectDir, marbloProjectId, agent.id);

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

  private generateClaudeConfig(agentId: string, mcpEntry: MCPServerEntry): string {
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
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.trackFile(agentId, configPath);
    return configPath;
  }

  private generateGeminiConfig(agentId: string, mcpEntry: MCPServerEntry): string {
    // Gemini CLI uses settings.json format with mcpServers
    const config = {
      mcpServers: {
        marblo: {
          command: mcpEntry.command,
          args: mcpEntry.args,
          env: mcpEntry.env || {},
        },
      },
    };

    const configPath = path.join(CONFIG_DIR, `gemini-mcp-${agentId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.trackFile(agentId, configPath);
    return configPath;
  }

  private generateGPTConfig(agentId: string, mcpEntry: MCPServerEntry): string {
    // Codex CLI MCP configuration format
    const config = {
      mcpServers: {
        marblo: {
          command: mcpEntry.command,
          args: mcpEntry.args,
          env: mcpEntry.env || {},
        },
      },
    };

    const configPath = path.join(CONFIG_DIR, `codex-mcp-${agentId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.trackFile(agentId, configPath);
    return configPath;
  }

  private generateCustomConfig(agentId: string, mcpEntry: MCPServerEntry): string {
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
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
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
  ): { command: string; args: string[]; env: Record<string, string> } {
    const env = getMCPServerEnv(projectDir, marbloProjectId, agentId);

    // NOTE: Initial prompts are NOT passed via CLI flags (e.g. -p) because
    // that runs non-interactively and exits. Instead, prompts are sent via
    // stdin after the CLI starts, keeping the session interactive.
    switch (model) {
      case 'claude':
        return {
          command: baseCommand || 'claude',
          args: ['--dangerously-skip-permissions', '--mcp-config', mcpConfigPath],
          env,
        };

      case 'gemini':
        return {
          command: baseCommand || 'gemini',
          args: [],
          env: { ...env, GEMINI_MCP_CONFIG: mcpConfigPath },
        };

      case 'gpt':
        return {
          command: baseCommand || 'codex',
          args: ['--full-auto'],
          env,
        };

      case 'custom':
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
