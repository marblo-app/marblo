/**
 * Bundle installer — auto-installs Marblo's required harness assets
 * (tf-* slash commands, skills, AND the Marblo MCP server) into the
 * user's `~/.claude/` on app start. Idempotent: writes a version marker
 * and skips re-copy when the marker matches the current bundle version.
 *
 * Marblo MCP global registration uses a port-discovery file at
 * `~/.marblo/bridge-port` (written by BridgeServer on every app launch).
 * The bundled MCP server reads it as a fallback when MARBLO_BRIDGE_PORT
 * env is not set — so an external Claude Code session that has Marblo
 * MCP registered globally will reach the running Marblo automatically.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { app } from "electron";

const BUNDLE_NAME = "marblo-bundled-harness";
const VERSION_MARKER = ".marblo-bundle-version";

interface InstallResult {
  installed: number;
  skipped: number;
  errors: string[];
}

/** Locate the source directory for bundled assets. */
function findBundleSource(): { commands: string; skills: string } | null {
  const candidates: Array<{ commands: string; skills: string }> = [];

  // Production: electron-builder copies bundled-harness/ into resources.
  candidates.push({
    commands: path.join(process.resourcesPath, "bundled-harness", "commands"),
    skills: path.join(process.resourcesPath, "bundled-harness", "skills"),
  });

  // Dev: bundled assets live one directory up from v3 (repo root .claude/).
  // app.getAppPath() points to v3 in dev; .. is the repo root.
  const repoRoot = path.resolve(app.getAppPath(), "..");
  candidates.push({
    commands: path.join(repoRoot, ".claude", "commands"),
    skills: path.join(repoRoot, ".claude", "skills"),
  });

  for (const c of candidates) {
    if (fs.existsSync(c.commands) && fs.existsSync(c.skills)) {
      return c;
    }
  }
  return null;
}

function copyDirRecursive(src: string, dst: string): number {
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
      count += 1;
    }
  }
  return count;
}

/** Find the path to the bundled Marblo MCP entry script. */
function findMarbloMcpEntry(): string | null {
  const candidates: string[] = [];
  // Production: electron-builder copies dist-mcp into resources.
  candidates.push(path.join(process.resourcesPath, "dist-mcp", "index.js"));
  // Dev: dist-mcp is built next to the source by `npm run build:mcp`.
  candidates.push(path.join(app.getAppPath(), "dist-mcp", "index.js"));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Add (or refresh) the Marblo MCP entry in `~/.claude.json` mcpServers.
 * Writes atomically and preserves any other user-configured MCP entries.
 */
function registerMarbloMcpInClaudeJson(mcpEntryPath: string): void {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");
  let cfg: { mcpServers?: Record<string, unknown> } & Record<string, unknown> =
    {};
  if (fs.existsSync(claudeJsonPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8"));
    } catch (err) {
      // Don't clobber a malformed file — bail out so the user can fix it.
      throw new Error(
        `~/.claude.json is not valid JSON (${
          err instanceof Error ? err.message : err
        }). Refusing to overwrite.`
      );
    }
  }
  cfg.mcpServers = (cfg.mcpServers as Record<string, unknown>) ?? {};
  // The MCP server reads MARBLO_BRIDGE_PORT from the discovery file at
  // ~/.marblo/bridge-port if env is unset (see mcp-server/index.ts), so
  // we don't need to inject the port here.
  (cfg.mcpServers as Record<string, unknown>).marblo = {
    command: "node",
    args: [mcpEntryPath],
  };
  const tmp = `${claudeJsonPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf-8");
  fs.renameSync(tmp, claudeJsonPath);
}

/**
 * Run the bundled installer. Skips work when the user already has the
 * current bundle version installed (marker file matches).
 */
export async function installBundledHarness(): Promise<InstallResult> {
  const result: InstallResult = { installed: 0, skipped: 0, errors: [] };
  const userClaudeDir = path.join(os.homedir(), ".claude");
  const userCommandsDir = path.join(userClaudeDir, "commands");
  const userSkillsDir = path.join(userClaudeDir, "skills");
  const markerPath = path.join(userClaudeDir, VERSION_MARKER);

  const appVersion = app.getVersion();
  const targetMarker = `${BUNDLE_NAME}@${appVersion}`;

  // Skip if user has the same version installed.
  try {
    if (fs.existsSync(markerPath)) {
      const existing = fs.readFileSync(markerPath, "utf-8").trim();
      if (existing === targetMarker) {
        result.skipped += 1;
        console.log(
          `[BundleInstaller] Skipping — marker matches (${targetMarker})`
        );
        return result;
      }
    }
  } catch (err) {
    // Marker unreadable — proceed with install.
    console.warn("[BundleInstaller] Could not read version marker:", err);
  }

  const source = findBundleSource();
  if (!source) {
    const msg =
      "Bundle source not found. Skipping (likely running outside of packaged app or repo root).";
    console.warn(`[BundleInstaller] ${msg}`);
    result.errors.push(msg);
    return result;
  }

  fs.mkdirSync(userCommandsDir, { recursive: true });
  fs.mkdirSync(userSkillsDir, { recursive: true });

  // Copy tf-* commands.
  try {
    for (const file of fs.readdirSync(source.commands)) {
      if (!file.startsWith("tf-") || !file.endsWith(".md")) continue;
      const src = path.join(source.commands, file);
      const dst = path.join(userCommandsDir, file);
      fs.copyFileSync(src, dst);
      result.installed += 1;
    }
  } catch (err) {
    const msg = `Failed to copy commands: ${
      err instanceof Error ? err.message : err
    }`;
    console.warn(`[BundleInstaller] ${msg}`);
    result.errors.push(msg);
  }

  // Copy tf-* skills directories.
  try {
    for (const entry of fs.readdirSync(source.skills, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("tf-")) continue;
      const src = path.join(source.skills, entry.name);
      const dst = path.join(userSkillsDir, entry.name);
      result.installed += copyDirRecursive(src, dst);
    }
  } catch (err) {
    const msg = `Failed to copy skills: ${
      err instanceof Error ? err.message : err
    }`;
    console.warn(`[BundleInstaller] ${msg}`);
    result.errors.push(msg);
  }

  // Register Marblo MCP server globally so external Claude Code sessions
  // can use it. The MCP entry script lives in app resources (production)
  // or in the dist-mcp build output (dev). At runtime, the MCP reads
  // ~/.marblo/bridge-port (written by BridgeServer) to find the live app.
  try {
    const mcpEntry = findMarbloMcpEntry();
    if (mcpEntry) {
      registerMarbloMcpInClaudeJson(mcpEntry);
      result.installed += 1;
    } else {
      console.warn(
        "[BundleInstaller] Marblo MCP entry not found — skipping global registration"
      );
    }
  } catch (err) {
    const msg = `Failed to register Marblo MCP: ${
      err instanceof Error ? err.message : err
    }`;
    console.warn(`[BundleInstaller] ${msg}`);
    result.errors.push(msg);
  }

  // Write the version marker only if at least something installed.
  if (result.installed > 0 && result.errors.length === 0) {
    try {
      fs.writeFileSync(markerPath, targetMarker, "utf-8");
    } catch (err) {
      console.warn("[BundleInstaller] Could not write version marker:", err);
    }
  }

  console.log(
    `[BundleInstaller] Installed ${result.installed} files, skipped ${result.skipped}, errors ${result.errors.length}`
  );
  return result;
}
