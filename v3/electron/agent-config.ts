import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile, execFileSync } from "child_process";
import { ModelType } from "./agent-manager";
import {
  cmpSemver,
  envProfileForModel,
  getModel,
  harnessForModel,
  LOCAL_OLLAMA_ENV_PROFILE,
  meetsMinCli,
  modelsByHarness,
  vendorEnvSecretRef,
  vendorQuotaDeadEntry,
  type EffortLevel,
  type HarnessId,
  type VendorId,
} from "./model-registry";
import {
  entryRung,
  isApprovalGatedEffort,
  type LadderTier,
} from "./model-ladder";
import { maskEnvForLogging } from "./config-redaction";
import { grokAuthBroker } from "./grok-auth-broker";
import { getVendorSecret } from "./vendor-secrets";
import { CODEX_ORCH_REQUIRED_MCP_TOOLS } from "./mcp-server/tool-surface";
import { ADVANCE_SIGNAL_ENV } from "./mcp-server/advance-guards";
import {
  shouldDisableWorkerSkills,
  toolSurfaceEnv,
  workerClaudeSettings,
} from "./prefix-diet";
import { toolSupportForLocalModelId } from "./local-models";
import {
  injectCodexVendorEnvKey,
  renderCodexVendorProviderToml,
  resolveCodexVendorProviderOverride,
  type CodexVendorProviderOverride,
} from "./codex-vendor-provider";
import {
  startCodexChatBridgeSync,
  type CodexChatBridgeHandle,
} from "./codex-chat-bridge";
import {
  buildCodexModelCatalog,
  renderCodexModelCatalogJson,
} from "./codex-model-catalog";

/**
 * System prompt for small local chat-only models. It intentionally omits the
 * MCP/agent tool-use loop; measured 0.5b models imitate tool_use JSON when the
 * tool schema and force-tool instructions are present.
 */
export const LOCAL_CHAT_ONLY_SYSTEM_PROMPT =
  "You are a helpful local assistant running on the user's machine. " +
  "Reply clearly in the user's language. Do not call tools or emit tool-call JSON — answer directly.";

/**
 * 스폰 프롬프트/주입 프로파일.
 *
 *   full                 클라우드·프론티어 워커. 종전 그대로 전부 주입.
 *   local-tool-use       로컬 대형(30B+). MCP 표면 최소(local-light) + 완료규약
 *                        compact + 역할 스킬 **전문** 주입.
 *   local-tool-use-lite  로컬 경량(25B ≤ x < 30B). 도구는 주되 긴 컨텍스트를
 *                        뺀다 — 역할 스킬 전문 대신 짧은 브리프, MCP 표면은
 *                        local-lite(5툴). ★티켓 X8ZzPLey1Uk7uFm8q3bv 에서 26B 급이
 *                        "스킬+41툴+완료규약 full" 조합에 과부하로 측정됐다.
 *                        임계만 25B 로 내리면 그 실패 조건을 그대로 복원하게 되므로
 *                        이 티어가 주입량을 갈라 준다.
 *   chat-only            로컬 소형. 툴 스키마 자체를 안 싣는다(`--tools ""`).
 */
export type AgentPromptProfile =
  | "full"
  | "local-tool-use"
  | "local-tool-use-lite"
  | "chat-only";

/** 도구를 싣는 로컬 프로파일인가(lite 포함). */
export function isLocalToolProfile(profile: AgentPromptProfile): boolean {
  return profile === "local-tool-use" || profile === "local-tool-use-lite";
}

/**
 * 핀된 로컬 모델 → 주입 프로파일. 티어 판정 자체는 local-models 가 하고
 * (카탈로그 override 포함) 여기서는 프로파일로만 옮긴다.
 *
 * 테스트가 임계·프로파일 매핑을 고정할 수 있게 export 한다.
 */
export function localProfileForPinnedModel(
  agentModel: ModelType,
  pinnedModelId: string | undefined,
): AgentPromptProfile {
  if (!pinnedModelId?.trim()) return "full";
  const registryRow = getModel(pinnedModelId);
  const isLocal =
    agentModel === "local" ||
    registryRow?.provider === "local";
  if (!isLocal) return "full";
  switch (toolSupportForLocalModelId(pinnedModelId.trim())) {
    case "chat-only":
      return "chat-only";
    case "tool-use-lite":
      return "local-tool-use-lite";
    default:
      return "local-tool-use";
  }
}

/**
 * lite 티어가 역할 스킬 **전문** 대신 받는 짧은 브리프.
 *
 * 역할 스킬(`generateEnglishRoleSkillContent`)은 수 KB 짜리 자율 루프 문서다.
 * lite 는 dispatch 로 배정받은 한 건을 끝내는 티어라 그 루프 전체가 필요 없고,
 * 그 길이가 정확히 26B 급이 과부하로 측정된 축이다. 그래서 "무슨 역할인지 +
 * 어떤 툴로 보고하는지"만 남긴다 — MCP 표면(local-lite)에 실제로 존재하는
 * 5개 툴만 언급한다(없는 툴을 지시하면 가짜 JSON 을 유발한다).
 */
export function localLiteRoleBrief(role: string): string {
  const safeRole = (role || "").trim() || "worker";
  return [
    `You are the Marblo ${safeRole} agent working on ONE assigned ticket.`,
    "Work in the current repository. Keep changes scoped to that ticket.",
    "Available MCP tools (these are the only ones you have):",
    "- get_task(task_id) — read the ticket body when you need the spec.",
    "- add_activity(task_id, message) — log progress and decisions.",
    "- submit_for_review(task_id, pr_url?, summary?) — report normal completion.",
    '- update_task_status(task_id, status, comment) — report "FAILED" or "BLOCKED".',
    "- ask_orchestrator(task_id, question) — ask when evidence is missing.",
    "Never guess when you are missing evidence: ask_orchestrator instead of the user.",
    "Call a tool by actually invoking it. Never write tool-call JSON as message text.",
  ].join("\n");
}

/** claude argv 에 붙이는 대화모드 플래그(유닛 테스트·스폰 경로 공유). */
export function localChatOnlyClaudeArgExtras(): string[] {
  return [
    "--tools",
    "",
    "--bare",
    "--system-prompt",
    LOCAL_CHAT_ONLY_SYSTEM_PROMPT,
    "--disable-slash-commands",
  ];
}

export interface ResolvedCli {
  /** Absolute path to the binary, or the bare name if resolution failed. */
  command: string;
  /** Parsed "X.Y.Z" version string, or "" if unknown. */
  version: string;
}

let _claudeResolved: ResolvedCli | null = null;

/**
 * Narrow dependency seam for unit/integration harnesses.  Production always
 * resolves the managed CLI from disk; tests that assert model policy inject a
 * known compatible CLI instead of inheriting the developer/runner install.
 */
let _claudeBinaryResolverForTesting: (() => ResolvedCli) | null = null;

export function setClaudeBinaryResolverForTesting(
  resolver: (() => ResolvedCli) | null,
): void {
  _claudeBinaryResolverForTesting = resolver;
  _claudeResolved = null;
}

interface ClaudeBinaryCandidate {
  command: string;
  source: string;
  native: boolean;
}

interface ProbedClaudeBinary extends ResolvedCli {
  source: string;
  native: boolean;
  realpath: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

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
 * after a managed update to re-probe. External CLI upgrades made outside the
 * harness are otherwise seen after app restart or explicit reset.
 */
export function resolveClaudeBinary(): ResolvedCli {
  if (_claudeBinaryResolverForTesting) {
    return _claudeBinaryResolverForTesting();
  }
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
  // (~/.local/bin) self-updates; homebrew / npm-global come next. Windows uses
  // different conventions and binaries carry a .exe / .cmd extension, so the
  // bare-name POSIX candidates would never realpath-resolve there.
  const candidates: ClaudeBinaryCandidate[] =
    os.platform() === "win32"
      ? [
          {
            // Native Windows installer drops claude.exe under ~/.local/bin.
            command: path.join(home, ".local", "bin", "claude.exe"),
            source: "native-local",
            native: true,
          },
          {
            // npm -g install: claude.cmd shim under %APPDATA%\npm.
            command: path.join(
              process.env.APPDATA || path.join(home, "AppData", "Roaming"),
              "npm",
              "claude.cmd",
            ),
            source: "npm-global",
            native: false,
          },
        ]
      : [
          {
            command: path.join(home, ".local/bin/claude"),
            source: "native-local",
            native: true,
          },
          {
            command: "/opt/homebrew/bin/claude",
            source: "homebrew-arm",
            native: false,
          },
          {
            command: "/usr/local/bin/claude",
            source: "homebrew-intel",
            native: false,
          },
          {
            command: path.join(home, ".npm-global/bin/claude"),
            source: "npm-global",
            native: false,
          },
        ];
  const parseVer = (s: string): number[] => {
    const m = s.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  };
  const cmp = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

  const logSkip = (
    candidate: ClaudeBinaryCandidate,
    reason: string,
    detail?: string,
  ) => {
    console.warn("[claude-resolver] candidate skipped", {
      command: candidate.command,
      source: candidate.source,
      reason,
      ...(detail ? { detail } : {}),
    });
  };

  let best: ProbedClaudeBinary | null = null;
  let bestVer = [0, 0, 0];
  for (const c of candidates) {
    let real = "";
    try {
      real = fs.realpathSync(c.command);
    } catch (error) {
      logSkip(c, "realpath_failed", errorMessage(error));
      continue;
    }
    if (isBlocked(real)) {
      logSkip(c, "blocked_shadow_path", real);
      continue;
    }

    let out = "";
    try {
      // .cmd/.bat shims (npm-global on Windows) can't be exec'd directly —
      // they must go through cmd.exe. Plain executables (.exe / POSIX) run as-is.
      out = /\.(cmd|bat)$/i.test(c.command)
        ? execFileSync("cmd.exe", ["/c", c.command, "--version"], {
            timeout: 5000,
            encoding: "utf-8",
          }).trim()
        : execFileSync(c.command, ["--version"], {
            timeout: 5000,
            encoding: "utf-8",
          }).trim();
    } catch (error) {
      logSkip(c, "version_exec_failed", errorMessage(error));
      continue;
    }

    const version = out.match(/\d+\.\d+\.\d+/)?.[0] || "";
    if (!version) {
      logSkip(c, "unparseable_version", out || "<empty>");
      continue;
    }

    const ver = parseVer(version);
    const compare = cmp(ver, bestVer);
    if (!best || compare > 0 || (compare === 0 && c.native && !best.native)) {
      best = {
        command: c.command,
        version,
        source: c.source,
        native: c.native,
        realpath: real,
      };
      bestVer = ver;
    }
  }
  if (best) {
    _claudeResolved = { command: best.command, version: best.version };
  } else if (os.platform() === "win32") {
    // node-pty can't spawn a bare "claude" on Windows (it throws "File not
    // found" — no PATH/PATHEXT resolution), so a PATH-only install would be
    // unreachable. Resolve it to an absolute path via `where`, preferring a real
    // .exe over a .cmd shim (node-pty can't spawn .cmd directly either).
    let resolved: ResolvedCli = { command: "claude", version: "" };
    try {
      const hits = execFileSync("where", ["claude"], {
        timeout: 5000,
        encoding: "utf-8",
      })
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const exe = hits.find((h) => /\.exe$/i.test(h)) || hits[0];
      if (exe) {
        let version = "";
        try {
          version =
            execFileSync(exe, ["--version"], {
              timeout: 5000,
              encoding: "utf-8",
            })
              .trim()
              .match(/\d+\.\d+\.\d+/)?.[0] || "";
        } catch {
          /* version best-effort */
        }
        resolved = { command: exe, version };
      }
    } catch {
      /* `where` found nothing — keep bare "claude" */
    }
    _claudeResolved = resolved;
  } else {
    _claudeResolved = { command: "claude", version: "" };
  }
  console.info("[claude-resolver] resolved claude binary", {
    command: _claudeResolved.command,
    version: _claudeResolved.version || "unknown",
    source: best?.source ?? "path-fallback",
    realpath: best?.realpath ?? "",
    native: best?.native ?? false,
  });
  return _claudeResolved;
}

// ── spawn-node 바이너리 견고화 (marblo_mcp_dies_broken_node_binary) ────────
//
// MCP 자식과 일부 에이전트 자식은 `command:"node"` 로 PATH 의 첫 node 를 잡아
// 떴다. 2026-06-19 brew 가 icu4c 74→78 로 올리면서 homebrew node(22.6.0)가
// dyld 로드 불가가 됐고, PATH 첫 node 가 그 깨진 바이너리였던 탓에 spawn 즉시
// 죽어 marblo MCP 가 침묵 -32000 으로 끊겼다. resolveClaudeBinary 와 같은 결
// — PATH 순서를 믿지 않고 "알려진 정상 node 절대경로"를 직접 골라 실행가능성
// 까지 검증한다.
//
// 최우선 후보는 Electron 번들 node(ELECTRON_RUN_AS_NODE=1 + process.execPath):
// 앱이 떠 있다는 건 이 바이너리가 이미 정상이라는 뜻이라 "항상 존재·버전 일치"
// 가 보장된다. 그게 어떤 이유로든 검증 실패하면 검증된 절대경로 node 로, 마지막
// 으로 bare "node" 로 폴백한다(여기까지 오면 preflight 가 not-ok 로 기록되어
// 하네스 배너가 뜬다).

export interface ResolvedNode {
  /** spawn 할 바이너리 절대경로(Electron 바이너리 run-as-node, 또는 node 경로). */
  command: string;
  /** `command` 를 node 인터프리터로 동작시키기 위해 반드시 주입해야 하는 env
   *  (Electron 번들이면 ELECTRON_RUN_AS_NODE=1, 진짜 node 면 빈 객체). */
  env: Record<string, string>;
  /** 진단용 출처 키. */
  source: string;
  /** 검증으로 확인한 node 버전("X.Y.Z") 또는 "". */
  version: string;
}

export interface NodeSpawnPreflight {
  /** 실행 가능한 node 를 골랐으면 true. */
  ok: boolean;
  command: string;
  source: string;
  version: string;
  /** ok=false 일 때만 채워지는 행동가능 메시지(하네스 배너용). */
  error?: string;
}

interface NodeBinaryCandidate {
  command: string;
  source: string;
  /** 이 후보를 node 로 실행하는 데 필요한 추가 env. */
  env: Record<string, string>;
}

let _nodeResolved: ResolvedNode | null = null;
let _nodePreflight: NodeSpawnPreflight | null = null;

/** 후보를 실제로 한 번 실행해 "정상 동작하는 node 인지" 검증한다. 깨진 dyld
 *  바이너리는 여기서 throw → not-ok 로 배제된다. process.versions.node 를
 *  찍게 해 실행가능성과 버전을 동시에 확인한다. */
function verifyNodeCandidate(
  command: string,
  extraEnv: Record<string, string>,
): { ok: boolean; version: string; error?: string } {
  try {
    const out = execFileSync(
      command,
      ["-e", "process.stdout.write(process.versions.node)"],
      {
        timeout: 5000,
        encoding: "utf-8",
        env: { ...process.env, ...extraEnv },
      },
    ).trim();
    const version = out.match(/\d+\.\d+\.\d+/)?.[0] || "";
    if (!version) {
      return { ok: false, version: "", error: "node가 버전을 보고하지 않음" };
    }
    return { ok: true, version };
  } catch (error) {
    return { ok: false, version: "", error: errorMessage(error) };
  }
}

/**
 * spawn 에 쓸 node 바이너리를 결정적으로 고른다. PATH 순서를 신뢰하지 않고
 * 알려진 정상 경로를 직접 검증한다. 메모이즈되며, 환경이 바뀌면
 * resetNodeResolution 후 재호출한다.
 */
export function resolveNodeBinary(): ResolvedNode {
  if (_nodeResolved) return _nodeResolved;
  const home = os.homedir();
  // 최우선: Electron 번들 node. process.execPath 는 항상 존재하고(앱이 떠 있음)
  // 버전이 앱과 일치한다. 그 다음 검증된 절대경로 node 후보들.
  const candidates: NodeBinaryCandidate[] = [
    {
      command: process.execPath,
      source: "electron-bundle",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    },
    { command: "/opt/homebrew/bin/node", source: "homebrew-arm", env: {} },
    { command: "/usr/local/bin/node", source: "homebrew-intel", env: {} },
    {
      command: path.join(home, ".local/bin/node"),
      source: "local-bin",
      env: {},
    },
    { command: path.join(home, ".volta/bin/node"), source: "volta", env: {} },
    {
      command: path.join(
        home,
        ".nvm/versions/node",
        process.version,
        "bin/node",
      ),
      source: "nvm-current",
      env: {},
    },
  ];

  const skips: string[] = [];
  for (const c of candidates) {
    // Electron 번들은 항상 존재하므로 access 체크를 건너뛴다. 나머지는 실행
    // 비트가 없으면(=설치 안 됨) 빠르게 스킵한다.
    if (c.source !== "electron-bundle") {
      try {
        fs.accessSync(c.command, fs.constants.X_OK);
      } catch {
        skips.push(`${c.source}:absent`);
        continue;
      }
    }
    const probe = verifyNodeCandidate(c.command, c.env);
    if (!probe.ok) {
      skips.push(`${c.source}:${probe.error ?? "verify_failed"}`);
      console.warn("[node-resolver] candidate skipped", {
        command: c.command,
        source: c.source,
        error: probe.error,
      });
      continue;
    }
    _nodeResolved = {
      command: c.command,
      env: c.env,
      source: c.source,
      version: probe.version,
    };
    _nodePreflight = {
      ok: true,
      command: c.command,
      source: c.source,
      version: probe.version,
    };
    console.info("[node-resolver] resolved spawn node", {
      command: c.command,
      source: c.source,
      version: probe.version,
    });
    return _nodeResolved;
  }

  // 어떤 후보도 검증을 통과하지 못함 — Electron 번들까지 실패한 극단 상황.
  // bare "node" 로라도 시도하되, preflight 를 not-ok 로 남겨 하네스 배너를 띄운다.
  _nodeResolved = {
    command: "node",
    env: {},
    source: "path-fallback",
    version: "",
  };
  _nodePreflight = {
    ok: false,
    command: "node",
    source: "path-fallback",
    version: "",
    error: `실행 가능한 node 바이너리를 찾지 못했습니다 (시도: ${
      skips.join(", ") || "none"
    }). 터미널에서 \`brew reinstall node\` 후 앱을 재시작하세요.`,
  };
  console.error("[node-resolver] no working node binary found", { skips });
  return _nodeResolved;
}

/** spawn-node 의 실제 실행 검증 결과를 반환한다(하네스 preflight 배너용).
 *  최초 호출 시 resolveNodeBinary 를 트리거해 검증을 수행한다. */
export function preflightNodeSpawn(): NodeSpawnPreflight {
  if (!_nodePreflight) resolveNodeBinary();
  return _nodePreflight!;
}

/** 메모이즈된 node 결정을 비운다(node 재설치/환경 변경 후 재검증). */
export function resetNodeResolution(): void {
  _nodeResolved = null;
  _nodePreflight = null;
}

/**
 * Clear the memoized claude resolution (e.g. after a harness update). This is
 * the only in-process re-interpretation path; without it, an external CLI
 * upgrade is picked up on the next app process start.
 */
export function resetClaudeResolution(): void {
  _claudeResolved = null;
  _harnessCliResolved.clear();
  resetNodeResolution();
}

const _harnessCliResolved = new Map<ModelType, ResolvedCli>();

// Binary name each model launches with. "gpt" is Codex; "antigravity" is the
// `agy` CLI. local/custom have no managed binary.
const MODEL_BINARY: Partial<Record<ModelType, string>> = {
  gemini: "gemini",
  gpt: "codex",
  grok: "grok",
  antigravity: "agy",
};

/**
 * 핀이 없을 때 grok argv 에 붙는 `-m` 값.
 *
 * ★"핀을 안 붙이고 CLI 기본에 맡긴다" 가 아니라 **우리가 명시적으로 못박는** 값이다
 * (그래야 cost_logs·라우팅 그래프가 어느 모델이 돌았는지 안다). 대가로 세대가
 * 올라가면 사람이 여기를 고쳐야 하고, 안 고치면 조용히 낡는다 — 실제로 `grok models`
 * 의 default 가 grok-4.6 으로 바뀐 뒤에도 한동안 grok-4.5 로 남아 있었다.
 * 2026-08-20 `grok models` 실측(Default model: grok-4.6)에 맞춰 갱신했다.
 */
const GROK_DEFAULT_MODEL = "grok-4.6";

/**
 * 이 하네스가 스폰하는 CLI 이름 — 에이전트 doc 의 `command` 필드에 넣을 값.
 *
 * ★`MODEL_BINARY` 를 단일소스로 재사용한다. 이 표가 없던 동안 UI 쪽(퀵레인 생성
 * 모달)이 자기 리터럴 표("claude"/"codex"/"agy")를 따로 들고 있었고, 그래서 신규
 * 하네스(grok)가 레지스트리에 들어와도 UI 에는 나타날 방법이 없었다. `claude` 가
 * `MODEL_BINARY` 에 없는 것은 누락이 아니라 사실이다 — claude 는 `resolveClaudeCli`
 * 가 별도로 해석하는 경로라 여기 이름만 돌려준다.
 */
export function harnessCommandName(harness: ModelType): string {
  return MODEL_BINARY[harness] ?? harness;
}

function candidateBinaryNames(binary: string): string[] {
  if (os.platform() !== "win32" || path.extname(binary)) return [binary];
  const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const extensions = ["", ".exe", ".cmd", ".bat", ".ps1", ...pathext];
  return [...new Set(extensions)].map((ext) => `${binary}${ext}`);
}

function execCliVersion(command: string): string {
  if (os.platform() === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return execFileSync("cmd.exe", ["/c", command, "--version"], {
      timeout: 5000,
      encoding: "utf-8",
    }).trim();
  }
  if (os.platform() === "win32" && /\.ps1$/i.test(command)) {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        command,
        "--version",
      ],
      {
        timeout: 5000,
        encoding: "utf-8",
      },
    ).trim();
  }
  return execFileSync(command, ["--version"], {
    timeout: 5000,
    encoding: "utf-8",
  }).trim();
}

function ptyCommandForCli(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (os.platform() === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return { command: "cmd.exe", args: ["/c", command, ...args] };
  }
  if (os.platform() === "win32" && /\.ps1$/i.test(command)) {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        command,
        ...args,
      ],
    };
  }
  return { command, args };
}

function isHarnessCommandName(command: string, harness: ModelType): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  const base = path.basename(trimmed).toLowerCase();
  const expected = harnessCommandName(harness).toLowerCase();
  if (base === expected) return true;
  return os.platform() === "win32" && base === `${expected}.exe`;
}

// ── 오케스트레이터 부팅 모델 추상화 ─────────────────────────────────
//
// 워커는 이미 멀티모델(getLaunchConfig 모델분기 + MODEL_BINARY + resolveHarnessCli)
// 을 타지만, 오케스트레이터만 model/command 가 "claude" 로 하드코딩돼 단락돼 있었다.
// 이 단락을 env 로 풀어 codex/local 오케를 "실험 가능"하게만 한다 — codex/local
// 오케의 실제 정상동작(PTY readiness, 프롬프트/헌법 분기, 세션파서)은 별도 백로그
// (IUj7YTFqJVZvi9AbtTPf) 몫이다. 여기서는 launchConfig 가 선택된 모델로 *구성되기만*
// 하면 된다.
//
// ★기본값 claude = 현 동작 0 변화가 절대 기준. 미설정/빈값/미지원 → "claude".

/** 오케스트레이터 부팅 모델의 안전 기본값. 불확실한 모든 상황의 귀결. */
export const DEFAULT_ORCHESTRATOR_MODEL: ModelType = "claude";

/**
 * 오케스트레이터를 어떤 모델로 부팅할지 env 로 결정한다(순수 함수 — process.env
 * 만 읽음). MARBLO_ORCHESTRATOR_MODEL 을 유효 ModelType 으로 매핑한다.
 *
 *   - 미설정/빈값          → "claude" (기본, 현 동작 0 변화)
 *   - "codex"             → "gpt" (기존 내부 네이밍으로 정규화)
 *   - claude/gpt/antigravity/local/custom → 그대로
 *   - 그 외 알 수 없는 값  → "claude" 폴백 + console.warn
 *
 * gemini 는 소프트 제거된 모델이라 의도적으로 받지 않는다(미지원 값으로 취급 →
 * claude 폴백). 새 오케 모델을 실험하려면 이 허용 목록에 추가하면 된다.
 */
export function resolveOrchestratorModel(): ModelType {
  const raw = (process.env.MARBLO_ORCHESTRATOR_MODEL || "")
    .trim()
    .toLowerCase();
  if (!raw) return DEFAULT_ORCHESTRATOR_MODEL;
  // "codex" 는 사용자/문서에서 흔히 쓰는 별칭 — 내부 ModelType "gpt" 로 정규화.
  const normalized = raw === "codex" ? "gpt" : raw;
  const allowed: ModelType[] = [
    "claude",
    "gpt",
    "grok",
    "antigravity",
    "local",
    "custom",
  ];
  if ((allowed as string[]).includes(normalized)) {
    return normalized as ModelType;
  }
  console.warn(
    `[orchestrator-model] unsupported MARBLO_ORCHESTRATOR_MODEL=${JSON.stringify(
      raw,
    )} → falling back to ${JSON.stringify(DEFAULT_ORCHESTRATOR_MODEL)}`,
  );
  return DEFAULT_ORCHESTRATOR_MODEL;
}

/**
 * 오케스트레이터를 띄울 때 getLaunchConfig 의 agent.command(=buildCLICommand 의
 * baseCommand)로 넘길 바이너리 이름을 모델에서 도출한다. 기존 워커 매핑(MODEL_BINARY)
 * 을 그대로 재사용한다 — 새 분기 로직을 만들지 않는다.
 *
 *   - claude       → "claude" (★현행 리터럴 그대로. buildCLICommand 의 claude
 *                     분기는 baseCommand 가 truthy 면 그대로 쓰므로, 이 값이
 *                     기본 경로의 byte-identical 동등성을 보장한다.)
 *   - gpt/antigravity/gemini → MODEL_BINARY (codex/agy/gemini)
 *   - local/custom → 관리 바이너리가 없으므로 모델명을 그대로 넘긴다
 *                     (buildCLICommand 의 custom/default 분기가 baseCommand 를
 *                     그대로 command 로 사용 — 실험용 경로).
 */
export function orchestratorCommandForModel(model: ModelType): string {
  if (model === "claude") return "claude";
  return MODEL_BINARY[model] || model;
}

// ── 최상위 모델 견고화 (SPAWN-MODEL-ALLOCATION-V2 §3) ──────────────
//
// 티어별 Claude 모델 id 를 env 주입 + CLI 버전가드 + 그레이스풀 폴백을 거쳐
// 결정한다. 모델 "사실"(id·alias·능력등급·단가·minCli)은 전부 model-registry.ts
// 가 갖고, 여기 남는 건 **정책**(어느 난도에 무엇을 쓸까)뿐이다.
//
// ★2026-07-25 변경(라우팅 P1-4): 세 티어 모두 레지스트리를 경유해 **구체 id 로
// 핀** 한다. 종전엔 standard 가 `"opus"` 리터럴이었는데, claude CLI 업데이트만으로
// alias `opus` 의 의미가 opus-4.x → claude-opus-5 로 바뀌면서 "표준작업 비용
// 무변동" 이라는 원 설계 의도가 아무도 모르게 깨져 있었다(설계문서 §1.3-①).
// 사장님 결정 = **standard 는 Opus 5 유지**. 그래서 되돌리는 게 아니라 지금 상태를
// `claude-opus-5` 로 명시 고정하고, 다시는 조용히 움직이지 못하게 막는다.

// ★컴파일타임 가드: 레지스트리의 **하네스** 축(HarnessId)과 런타임의 모델 축
// (ModelType)이 같은 집합인지 양방향으로 못박는다. 새 하네스를 한쪽에만 추가하면
// 여기서 타입에러가 난다 — 레지스트리에 있는데 스폰이 모르는(또는 그 반대인)
// 바이너리가 조용히 생기는 것을 막는다.
//
// ★축분리(USbdRV4k) 후에도 이 단언은 그대로다. 쪼개진 쪽은 **벤더**(VendorId)이고
// 그건 ModelType 과 무관하게 늘어난다 — 벤더가 늘어도 스폰 switch 는 안 늘어나는
// 것이 축분리의 목적이므로, 벤더 축에는 이런 단언을 걸지 않는다.
const _harnessCoversModelType: HarnessId = null as unknown as ModelType;
const _modelTypeCoversHarness: ModelType = null as unknown as HarnessId;
void _harnessCoversModelType;
void _modelTypeCoversHarness;

/** 불확실한 모든 상황의 안전 귀결(§8.3). "최상위를 못 쓰는 것"은 허용,
 * "spawn 자체가 깨지는 것"은 불허 — 그래서 늘 검증된 opus 로 떨어진다.
 * 이건 "버전가드 미달/미지모델일 때의 안전 바닥"이지 "기본 선택값"이 아니다
 * (기본 선택값은 DEFAULT_TOP_CLAUDE_MODEL).
 *
 * ★여기만 alias 인 것은 의도다. 폴백은 "CLI 버전을 신뢰할 수 없는 구간에서
 * CLI 가 아는 최선으로 떨어진다"가 목적이라 이동표적인 편이 옳다. 반대로 주
 * 선택값(핀)은 절대 alias 를 쓰지 않는다 — model-registry.ts 상단 규율 참조. */
export const FALLBACK_TOP_CLAUDE_MODEL = "opus";

/**
 * complex 티어의 *기본 선택값*(env MARBLO_TOP_CLAUDE_MODEL 미설정 시). "어려운
 * 작업 → 최신 하이 모델" 정책(티켓 XL3NhdW)에 따라 최신 Claude 5 계열
 * (fable → claude-fable-5)을 기본으로 자동 선호한다. 단 이 값은 그대로 채택되는
 * 게 아니라 resolveTopClaudeModelDetailed 의 CLI 버전가드(MARBLO_FABLE5_MIN_CLI,
 * 기본 2.1.170)를 통과해야만 실제 fable5 로 스폰되고, 미달이면 FALLBACK_TOP_
 * CLAUDE_MODEL(opus)로 그레이스풀 폴백(구조화 로그)된다. 즉:
 *   - CLI 자격 O → complex claude = fable5 (최신 하이)
 *   - CLI 자격 X → complex claude = opus (안전 폴백, 로그 남김)
 * ★이 env 의 적용 범위는 complex 티어 한정이다. standard 는 별도 핀
 *   (DEFAULT_STANDARD_CLAUDE_MODEL / MARBLO_STANDARD_CLAUDE_MODEL), simple 은
 *   resolveSimpleClaudeModel(기본 sonnet5). 세 티어가 서로 간섭하지 않는다.
 * opus 로 되돌리려면 MARBLO_TOP_CLAUDE_MODEL=opus 를 명시하면 된다
 * (레지스트리를 거쳐 claude-opus-5 로 핀된다). */
export const DEFAULT_TOP_CLAUDE_MODEL = "fable";

/** Fable5 최소 요구 claude CLI 버전(버전가드 기본 임계값). env 로 덮어쓸 수 있다.
 * 레지스트리의 `claude-fable-5.minCli` 와 같은 값이며, env 가 이를 덮어쓴다. */
const DEFAULT_FABLE5_MIN_CLI = "2.1.170";

/**
 * standard 티어 claude 모델의 **명시 핀**(env MARBLO_STANDARD_CLAUDE_MODEL 미설정 시).
 * ★사장님 결정(2026-07-25) = Opus 5 유지. alias `"opus"` 가 아니라 구체 id 를 쓰는
 * 것이 요점이다 — alias 였기 때문에 조용한 세대 승격이 일어났다(설계문서 §1.3-①).
 */
export const DEFAULT_STANDARD_CLAUDE_MODEL = "claude-opus-5";

/** claude 계열 모델 id alias. 프로바이더 정규화(normalizeModel, dispatch-scoring)
 * 와는 다른 층 — 이건 claude 내부의 _모델 id_ alias 다. "fable" → "claude-fable-5".
 *
 * ★단일소스화: 이 표는 이제 model-registry.ts 에서 **파생**된다(직접 편집 금지).
 * 신규 alias 는 레지스트리 항목의 `aliases` 에 추가하면 여기 자동 반영된다.
 * 하위호환을 위해 형태(Record<alias, id>)는 그대로 유지한다. */
export const CLAUDE_MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  modelsByHarness("claude").flatMap((m) =>
    m.aliases.map((a) => [a, m.id] as const),
  ),
);

/**
 * 한 번의 launch 가 강제할 **구체 모델 핀**. 티어 정책(complexity)보다 우선한다.
 *
 * 종전엔 이 자리가 `claudeModelOverride?: string` 하나뿐이었다 — fable5 런타임
 * 강등 재시작(§3.4-3)이 유일한 사용처였기 때문이다. 이제 사용자가 dispatch/셀렉터
 * 로 모델을 직접 지정할 수 있게 되면서 codex 축(모델 + reasoning effort)이 필요해져
 * 객체로 일반화했다. 필드가 비어 있으면 종전대로 complexity 티어 정책이 돈다.
 */
export interface LaunchModelPin {
  /** claude CLI 의 `--model` 값(구체 id 또는 폴백 alias). */
  claudeModel?: string;
  /** codex CLI 의 `-c model=…` 값. 미지정이면 사용자 config 의 모델을 그대로 쓴다. */
  codexModel?: string;
  /** codex CLI 의 `-c model_reasoning_effort=…` 값. complexity 파생값을 덮는다. */
  codexEffort?: string;
  /** Grok/Kimi 등 native CLI 의 모델 선택 플래그에 그대로 넘길 구체 id. */
  nativeModel?: string;
}

export interface TopModelFallback {
  /** 폴백 사유 코드(텔레메트리/로그 키).
   *  - fable5_version_guard : Fable5 전용 버전가드(하위호환 유지 코드)
   *  - min_cli_unverified   : 그 외 모델의 minCli 미검증 구간
   *  - unknown_top_model    : 레지스트리에 없는 모델 id */
  reason: "fable5_version_guard" | "min_cli_unverified" | "unknown_top_model";
  /** 요청된 모델 id(alias 정규화 후). */
  requested: string;
  /** 설치된 claude CLI 버전(또는 "unknown"). */
  installed: string;
  /** 선택된 claude command(진단용, 실제 resolver 경로에서만 채워짐). */
  command?: string;
  /** 폴백된 모델 id. */
  fallbackTo: string;
  /** Fable5 버전가드일 때 요구 최소 버전. */
  required?: string;
}

export interface TopModelResolution {
  /** 실제로 사용할 claude 모델 id. */
  model: string;
  /** 폴백이 일어났으면 그 상세, 아니면 null. */
  fallback: TopModelFallback | null;
}

/** semver 비교. 구현은 model-registry 로 옮겼고(레지스트리의 minCli 게이트가
 * 쓰므로) 여기선 기존 호출자를 위해 재수출한다. */
export { cmpSemver };

/** 폴백을 조용히 넘기지 않는다(§8.1) — 구조화 콘솔 로그. 윈도우가 있는 호출자
 * (agent-manager/bridge)는 이 위에 추가로 텔레메트리 이벤트를 쏜다. */
function logTopModelFallback(f: TopModelFallback): void {
  console.warn("[model-policy] top-model fallback", {
    reason: f.reason,
    requested: f.requested,
    installed: f.installed,
    command: f.command ?? "unknown",
    ...(f.required ? { required: f.required } : {}),
    fallbackTo: f.fallbackTo,
  });
}

/**
 * ★티어 공용 Claude 모델 resolver. 요청된 alias/id 를 레지스트리로 **구체 id 에
 * 핀** 하되, 그 id 가 "검증된 CLI 범위" 밖이면 alias 로 안전 폴백한다.
 *
 *   1. alias 정규화 — "fable" → "claude-fable-5", "opus" → "claude-opus-5".
 *   2. 레지스트리에 없는 id → unknown_top_model 폴백(미지 모델로 spawn 이 깨지는
 *      것보다 최상위를 못 쓰는 편이 낫다, §8.3).
 *   3. `minCli` 미검증 구간 → 폴백. minCli 의 의미는 "이 아래면 미지원" 이 아니라
 *      **"이 아래는 미검증"** 이다(model-registry.ts 참조). 폴백 대상이 alias 라
 *      결과적으로 종전 동작 그대로여서, 이 게이트는 보수적이어도 손해가 없다.
 *
 * 종전 대비 실질 차이는 반환값이 alias 가 아니라 구체 id 라는 점 하나다
 * (`"opus"` → `"claude-opus-5"`). 서빙되는 모델은 §1.1 CLI 프로브 기준 동일하고,
 * 이제는 CLI 가 alias 해석을 바꿔도 우리 선택이 따라 움직이지 않는다.
 *
 * 순수 함수(env + resolveClaudeBinary 만 읽음)라 단위테스트가 쉽다.
 *
 * @param requested alias 또는 구체 id(대소문자·공백 무관).
 * @param installedVersion 설치된 claude CLI 버전 주입(테스트용). 미지정이면
 *   resolveClaudeBinary().version(실제 설치본)을 쓴다.
 */
export function resolveClaudeModelPinned(
  requested: string,
  installedVersion?: string,
): TopModelResolution {
  const raw = requested.trim().toLowerCase();
  const entry = getModel(raw);
  const resolvedCli =
    installedVersion === undefined ? resolveClaudeBinary() : null;
  const version = installedVersion ?? resolvedCli?.version ?? ""; // "X.Y.Z"

  const bail = (
    reason: TopModelFallback["reason"],
    required?: string,
  ): TopModelResolution => {
    const fallback: TopModelFallback = {
      reason,
      requested: entry?.id ?? raw,
      installed: version || "unknown",
      ...(resolvedCli ? { command: resolvedCli.command } : {}),
      ...(required ? { required } : {}),
      fallbackTo: FALLBACK_TOP_CLAUDE_MODEL,
    };
    logTopModelFallback(fallback);
    return { model: FALLBACK_TOP_CLAUDE_MODEL, fallback };
  };

  if (!entry) return bail("unknown_top_model");

  // Fable5 만 별도 env 로 임계값을 튜닝할 수 있고 폴백 사유 코드도 따로 쓴다
  // (기존 텔레메트리 소비자 하위호환).
  const isFable5 = entry.id === "claude-fable-5";
  const minCliOverride = isFable5
    ? (process.env.MARBLO_FABLE5_MIN_CLI || DEFAULT_FABLE5_MIN_CLI).trim()
    : undefined;
  const required = minCliOverride ?? entry.minCli;

  if (!meetsMinCli(entry.id, version, minCliOverride)) {
    return bail(
      isFable5 ? "fable5_version_guard" : "min_cli_unverified",
      required,
    );
  }
  return { model: entry.id, fallback: null };
}

/**
 * complex 티어의 최상위 Claude 모델(env MARBLO_TOP_CLAUDE_MODEL, 기본 "fable").
 * 폴백 메타까지 반환하는 상세판 — 텔레메트리/사용자 표식용.
 */
export function resolveTopClaudeModelDetailed(
  installedVersion?: string,
): TopModelResolution {
  return resolveClaudeModelPinned(
    process.env.MARBLO_TOP_CLAUDE_MODEL || DEFAULT_TOP_CLAUDE_MODEL,
    installedVersion,
  );
}

/** §3 resolver 의 모델 id 만 필요한 호출자용 얇은 래퍼. */
export function resolveTopClaudeModel(): string {
  return resolveTopClaudeModelDetailed().model;
}

/**
 * ★standard 티어의 명시 핀(env MARBLO_STANDARD_CLAUDE_MODEL, 기본
 * `claude-opus-5`). 이 함수의 존재 자체가 P1-4 의 수리다 — 종전엔 여기가
 * `"opus"` 리터럴이라 CLI 가 alias 뜻을 바꾸면 표준작업 전체가 조용히 따라
 * 움직였다.
 */
export function resolveStandardClaudeModelDetailed(
  installedVersion?: string,
): TopModelResolution {
  return resolveClaudeModelPinned(
    process.env.MARBLO_STANDARD_CLAUDE_MODEL || DEFAULT_STANDARD_CLAUDE_MODEL,
    installedVersion,
  );
}

/** standard 티어 모델 id 만 필요한 호출자용 얇은 래퍼. */
export function resolveStandardClaudeModel(installedVersion?: string): string {
  return resolveStandardClaudeModelDetailed(installedVersion).model;
}

/**
 * ★티어별 Codex effort 의 **기본값은 사다리에서 읽는다**(P3-1).
 *
 * 종전엔 여기 `"high"`/`"low"`/`"medium"` 리터럴 세 개가 박혀 있어서, 사다리를
 * 데이터로 만들어도 라이브 스폰은 그 데이터를 안 보는 죽은 표가 될 수 있었다.
 * 지금은 `MODEL_LADDERS.gpt` 의 티어 진입 칸이 곧 기본 effort 다 —
 * 사다리 데이터와 라이브 동작이 갈라질 수 없다.
 *
 * 현행 진입 칸 effort 는 low/medium/high(설계상 의도) 이므로 이 변경으로
 * 스폰 인자는 한 바이트도 바뀌지 않는다(무회귀). `model-ladder-live.test.ts`
 * 가 그 동일성을 못박는다.
 */
function ladderEffortForTier(tier: LadderTier): EffortLevel {
  const rung = entryRung("gpt", tier);
  // gpt 사다리는 buildLadder 검증을 통과했으므로 진입 칸에 effort 가 반드시 있다.
  // 그래도 undefined 를 그냥 넘기지 않는 이유: 사다리가 나중에 바뀌어도 여기서
  // 조용히 "effort 없음"이 되면 codex 가 CLI 기본 effort 로 떨어져 티어 정책이
  // 사라진다(조용한 성능/비용 변동).
  if (!rung?.effort) {
    throw new Error(
      `[model-policy] gpt 사다리의 ${tier} 진입 칸에 effort 가 없습니다 — model-ladder.ts 를 확인하세요.`,
    );
  }
  return rung.effort;
}

/**
 * env 로 들어온 effort 를 검증한다.
 *
 * ★승인 게이트 집행 지점(사장님 결정 2026-07-25): `max`/`ultra` 는 사용자
 * 승인 없이는 쓸 수 없다. env 는 티켓별 승인 레코드를 볼 수 없는 전역 스위치라
 * **여기서는 무조건 거부**하고 티어 기본값으로 떨어뜨린다(조용히 열리지 않게
 * 경고 로그를 남긴다). 고비용 칸을 실제로 쓰려면 티켓 단위 승인 왕복
 * (`request_model_escalation` → `resolve_model_escalation`)을 거쳐야 한다.
 *
 * `xhigh` 는 통과시킨다 — 5.5 계열에도 있던 기존 칸이고 게이트 대상이 아니다.
 */
function validateCodexEffortEnv(
  raw: string | undefined,
  envKey: string,
  fallback: EffortLevel,
): string {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return fallback;
  if (isApprovalGatedEffort(value)) {
    console.warn("[model-policy] refusing gated codex effort from env", {
      envKey,
      requested: value,
      fallbackTo: fallback,
      why: "max/ultra 는 티켓 단위 사용자 승인(request_model_escalation)이 필요하다",
    });
    return fallback;
  }
  return ["low", "medium", "high", "xhigh"].includes(value) ? value : fallback;
}

/** complex 에서 쓸 Codex 최상위 reasoning effort. env MARBLO_TOP_CODEX_REASONING,
 * 기본 = 사다리의 complex 진입 칸 effort(현행 "high"). 유효하지 않거나 승인
 * 게이트 대상(max/ultra)이면 그 기본값으로 폴백. */
export function resolveTopCodexReasoning(): string {
  return validateCodexEffortEnv(
    process.env.MARBLO_TOP_CODEX_REASONING,
    "MARBLO_TOP_CODEX_REASONING",
    ladderEffortForTier("complex"),
  );
}

/** 기본 cheap Claude 모델 — simple 기본 물리 스폰에서 사용. */
export const DEFAULT_SIMPLE_CLAUDE_MODEL = "sonnet";

/** simple(저난도) 에서 쓸 cheap Claude 모델. env MARBLO_SIMPLE_CLAUDE_MODEL,
 * 기본 "sonnet". 빈 값이면 기본으로 폴백.
 *
 * ★다른 티어와 마찬가지로 레지스트리를 경유해 구체 id 로 핀된다
 * ("sonnet" → "claude-sonnet-5"). 서빙 모델은 §1.1 프로브 기준 동일하다. */
export function resolveSimpleClaudeModelDetailed(
  installedVersion?: string,
): TopModelResolution {
  const raw = (
    process.env.MARBLO_SIMPLE_CLAUDE_MODEL || DEFAULT_SIMPLE_CLAUDE_MODEL
  ).trim();
  return resolveClaudeModelPinned(
    raw || DEFAULT_SIMPLE_CLAUDE_MODEL,
    installedVersion,
  );
}

/** simple 티어 모델 id 만 필요한 호출자용 얇은 래퍼. */
export function resolveSimpleClaudeModel(installedVersion?: string): string {
  return resolveSimpleClaudeModelDetailed(installedVersion).model;
}

/** simple 에서 쓸 cheap Codex reasoning effort. env MARBLO_SIMPLE_CODEX_REASONING,
 * 기본 = 사다리의 simple 진입 칸 effort(현행 "low"). 유효하지 않거나 승인
 * 게이트 대상(max/ultra)이면 그 기본값으로 폴백. */
export function resolveSimpleCodexReasoning(): string {
  return validateCodexEffortEnv(
    process.env.MARBLO_SIMPLE_CODEX_REASONING,
    "MARBLO_SIMPLE_CODEX_REASONING",
    ladderEffortForTier("simple"),
  );
}

// 작업 complexity → 프로바이더별 모델/레벨. 품질 우선 정책: 기본(standard)은
// 최상위(claude=Opus5, gpt-5.5=medium)를 유지하고, 작은 작업(simple)만 한 단계 낮추며,
// 어려운 작업(complex)은 최상위를 쓴다. complexity 가 undefined 면 override 하지 않아
// 기본 모델을 상속한다(오케스트레이터 등). claude=--model, gpt(codex)=model_reasoning_effort.
//   claude:  simple → claude-sonnet-5,  standard → claude-opus-5,  complex → claude-fable-5
//   gpt:     simple → low,              standard → medium,          complex → high
//
// ★2026-07-25(라우팅 P1-4): claude 세 티어가 전부 레지스트리를 경유해 **구체 id**
// 를 반환한다. 종전엔 standard 가 `"opus"` 리터럴이라, CLI 업데이트로 alias 뜻이
// 바뀌자 표준작업 모델 세대가 아무도 모르게 올라갔다(설계문서 §1.3-①). 사장님
// 결정은 "Opus5 유지" 이므로 되돌리지 않고 `claude-opus-5` 로 명시 핀한다.
// 서빙 모델은 §1.1 CLI 프로브 기준 종전과 동일 — 바뀐 건 그 선택이 이제
// 이동표적(alias)이 아니라 커밋에 남는 사실이라는 점이다.
// simple 모델은 dispatch_task 기본 물리 스폰에서 비용 폭발을 막는 cheap tier 로
// 쓰인다(§B v2).
export type TaskComplexity = "simple" | "standard" | "complex";

// ★컴파일타임 가드: 난도 축(TaskComplexity)과 사다리의 티어 축(LadderTier)이 같은
// 집합인지 양방향으로 못박는다. model-ladder.ts 가 순환 의존을 피하려고 유니온을
// 따로 선언했으므로, 한쪽에만 티어를 추가하면 여기서 타입에러가 난다
// (레지스트리 ModelProvider↔ModelType 가드와 같은 방식).
const _tierCoversComplexity: LadderTier = null as unknown as TaskComplexity;
const _complexityCoversTier: TaskComplexity = null as unknown as LadderTier;
void _tierCoversComplexity;
void _complexityCoversTier;

export function modelTierForComplexity(
  model: ModelType,
  complexity: TaskComplexity | undefined,
  // 설치된 claude CLI 버전 주입(테스트용). 미지정이면 실제 설치본을 읽는다.
  // ★테스트가 이걸 주입해야 결정적이다 — 주입 없이 짠 기존 유닛이 CLI 업그레이드
  //   만으로 깨졌던 게 이 티켓이 고치는 문제의 테스트판이다.
  installedVersion?: string,
): { claudeModel?: string; codexReasoning?: string } {
  if (!complexity) return {}; // override 없음 → 기본 상속
  if (model === "claude") {
    if (complexity === "simple")
      return { claudeModel: resolveSimpleClaudeModel(installedVersion) }; // env, 기본 sonnet5
    if (complexity === "complex")
      return {
        claudeModel: resolveTopClaudeModelDetailed(installedVersion).model,
      }; // env/버전가드/폴백(§3)
    return { claudeModel: resolveStandardClaudeModel(installedVersion) }; // ★standard = Opus5 명시 핀
  }
  if (model === "gpt") {
    if (complexity === "simple")
      return { codexReasoning: resolveSimpleCodexReasoning() }; // env, 기본=사다리 simple 진입(low)
    if (complexity === "complex")
      return { codexReasoning: resolveTopCodexReasoning() }; // env, 기본=사다리 complex 진입(high)
    // standard 는 전용 env 가 없다(종전과 동일) — 사다리 standard 진입 칸의
    // effort 를 그대로 쓴다. 종전 리터럴 "medium" 과 같은 값이다.
    return { codexReasoning: ladderEffortForTier("standard") };
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
    for (const dir of getEnrichedPath().split(path.delimiter)) {
      if (!dir) continue;
      for (const name of candidateBinaryNames(binary)) {
        const candidate = path.join(dir, name);
        try {
          const real = fs.realpathSync(candidate);
          if (isStray(real)) continue;
          const out = execCliVersion(candidate);
          const v = out.match(/\d+\.\d+\.\d+/)?.[0];
          if (v) {
            resolved = { command: candidate, version: v };
            break;
          }
        } catch {
          // Missing / non-executable / stray — keep scanning.
        }
      }
      if (resolved.command !== (binary || model)) break;
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
    "grok",
    "antigravity",
    "gemini",
  ] as ModelType[]) {
    out[model] = resolveHarnessCli(model).version;
  }
  return out;
}

// ── ★provider ≠ harness 분기 지점 (USbdRV4k, 서베이 §4.5.1) ──────────────
//
// 스폰 경로가 두 축을 나눠 쓰는 자리는 정확히 둘이다:
//
//   1. **바이너리**는 `harness` 가 고른다   → harnessForLaunch()
//   2. **백엔드**는 `provider`(벤더)가 고른다 → applyVendorEnv()
//
// 오늘 레지스트리의 모든 행이 `harness === 옛 provider` 이고 `envProfile` 이 없어서
// 두 함수 다 **항등**이다(claude/codex 스폰 회귀 0 —
// tests/unit/provider-harness-axis.test.ts 가 이 항등성을 강제한다). env-swap
// 벤더(GLM/MiniMax)가 행으로 들어오면 그때 여기서만 갈린다 — switch 는 안 늘어난다.

/**
 * 벤더 프로파일이 **덮어쓸 수 없는** env 키 프리픽스. 우리 배선(MCP 브리지 토큰·
 * Firebase config)이 벤더 데이터로 갈아치워지면 에이전트가 보드에서 통째로
 * 사라진다 — 레지스트리 행 하나로 그런 일이 나지 않게 막는다.
 */
const VENDOR_ENV_PROTECTED_PREFIXES = ["MARBLO_", "VITE_FIREBASE_"] as const;

/** 벤더 프로파일이 덮어쓸 수 없는 개별 키(프로세스·하네스 배선). */
const VENDOR_ENV_PROTECTED_KEYS = new Set([
  "PATH",
  "HOME",
  "CODEX_HOME",
  "GEMINI_CLI_HOME",
  "MCP_CONFIG_PATH",
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
]);

function isProtectedVendorEnvKey(key: string): boolean {
  return (
    VENDOR_ENV_PROTECTED_KEYS.has(key) ||
    VENDOR_ENV_PROTECTED_PREFIXES.some((p) => key.startsWith(p))
  );
}

/**
 * 스폰 env 에 벤더 프로파일을 얹는 **순수** 함수.
 *
 * 프로파일이 비면 `base` 를 **그 객체 그대로** 돌려준다 — 새 객체조차 만들지
 * 않으므로 "기존 벤더 스폰 env 무변경" 이 참조 동일성으로 증명된다.
 *
 * 레지스트리를 읽지 않으므로 아직 등록되지 않은 벤더 행(GLM 등)의 프로파일로도
 * 검증할 수 있다 — 축분리가 "표현 가능" 한지는 이 함수로 증명된다.
 *
 * @param base    하네스 분기가 이미 조립한 env(MCP 브리지·CODEX_HOME 등)
 * @param profile 벤더 프로파일(`ModelRegistryEntry.envProfile`)
 * @param label   로그용 식별자(모델 id / 벤더)
 */
export function mergeVendorEnv(
  base: Record<string, string>,
  profile: Readonly<Record<string, string>> | undefined,
  label?: { model?: string; vendor?: string },
): Record<string, string> {
  const keys = Object.keys(profile ?? {});
  if (keys.length === 0) return base;

  const merged = { ...base };
  const injected: string[] = [];
  const rejected: string[] = [];
  for (const key of keys) {
    if (isProtectedVendorEnvKey(key)) {
      rejected.push(key);
      continue;
    }
    merged[key] = profile![key];
    injected.push(key);
  }
  if (rejected.length) {
    console.warn("[agent-config] 벤더 프로파일의 보호 키 무시", {
      model: label?.model ?? "unknown",
      vendor: label?.vendor ?? "unknown",
      rejected: rejected.sort(),
    });
  }
  console.log("[agent-config] 벤더 env 주입", {
    model: label?.model ?? "unknown",
    vendor: label?.vendor ?? "unknown",
    injectedKeys: injected.sort(),
    env: maskEnvForLogging(merged),
  });
  return merged;
}

/**
 * 벤더 프로파일의 시크릿 자리표시자(`${ZAI_API_KEY}`)를 실제 값으로 채운다.
 *
 * 시크릿은 레지스트리에 **키 이름**으로만 있고, 값은 두 소스에서 온다:
 *
 *   1. `process.env` — main.ts 가 부팅 때 `v3/.env` 로 dotenv 로드한 개발 경로.
 *   2. 앱 안전저장소(`vendor-secrets`, OS 키체인 암호화) — 설정 UI 가 등록한 값.
 *
 * ★우선순위는 1 > 2 다. 셸/`.env` 로 **명시한** 값을 GUI 저장소가 조용히 덮으면
 * 개발자가 어떤 크레덴셜로 붙었는지 알 수 없어진다(BYOK 의 `syncApiKeysToEnv` 도
 * 같은 방향이다). 대신 그 승부는 숨기지 않는다 — 설정 UI 가 키마다 출처를 표시한다.
 *
 * 2번 소스가 생기기 전엔 Finder 로 띄운 **패키지앱에 키를 넣을 방법이 아예 없어서**
 * GLM/MiniMax 가 빌드앱에서 못 켜졌다(R3UBmo5q). 저장소를 못 여는 프로세스
 * (앱 ready 전, 순수 node 스크립트)에서는 1번만 보므로 종전 동작 그대로다.
 *
 * 값은 이 함수 밖으로 나가지 않는다(반환 env 는 스폰 프로세스로만 가고, 로그에는
 * 키 이름과 마스킹된 형태만 남는다).
 */
export function resolveVendorEnvProfile(profile: Record<string, string>): {
  resolved: Record<string, string>;
  /** 자리표시자는 있는데 **양쪽 소스 모두** 비어 있는 키 이름들(값 아님). */
  missing: string[];
} {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, value] of Object.entries(profile)) {
    const ref = vendorEnvSecretRef(value);
    if (!ref) {
      resolved[key] = value;
      continue;
    }
    const secret = process.env[ref]?.trim() || getVendorSecret(ref);
    if (!secret) {
      missing.push(ref);
      continue;
    }
    resolved[key] = secret;
  }
  return { resolved, missing: [...new Set(missing)].sort() };
}

/**
 * ★`ready:false` 의 사유. 티켓 zlJW7D3Kz8HzqXjXJCqE 전에는 사유가 하나뿐이라
 * (크레덴셜 미설정) 값을 안 실어도 호출자가 안전하게 "키 등록하세요" 라고
 * 말할 수 있었다. 이제 **독립된 두 번째 사유**(벤더 쿼터 쿨다운)가 생겼고,
 * 그 둘을 같은 `false` 로 뭉개면 호출자가 "쿼터가 죽었을 뿐인데 키가 없다"고
 * 오독한다 — 실측 사고(MiniMax Token Plan 429)가 정확히 이 오독의 다른
 * 얼굴이었다. **새 사유가 생길 때마다 이 유니온에 추가하고, `ready:false`
 * 를 렌더링하는 모든 호출자가 이 필드를 보고 갈라 쓰는지 확인한다.**
 */
export type VendorNotReadyReason = "missing-credentials" | "quota-cooldown";

/** 이 모델을 벤더 백엔드로 붙일 준비가 됐는지(값은 절대 담지 않는다). */
export interface VendorEnvReadiness {
  /** 이 모델의 벤더. 레지스트리에 없으면 undefined. */
  vendor?: VendorId;
  /** 벤더 프로파일이 있는 행인가(= env-swap 벤더인가). */
  hasProfile: boolean;
  /** 필요한 시크릿 env **키 이름**들. */
  requiredEnvKeys: string[];
  /** 그중 아직 설정되지 않은 키 이름들. */
  missingEnvKeys: string[];
  /** 스폰 시 프로파일이 실제로 얹히는가. */
  ready: boolean;
  /** `ready===false` 일 때만 있다. 크레덴셜 부재와 쿼터 쿨다운을 가른다 —
   * 호출자가 이 필드를 안 보고 무조건 "키 등록" 문구를 그리면 그게 결함이다. */
  notReadyReason?: VendorNotReadyReason;
  /** `notReadyReason==="quota-cooldown"` 일 때만: 언제 풀리는지(epoch-ms). */
  quotaCooldownUntil?: number;
}

/**
 * 벤더 크레덴셜 준비 상태. `verify:models` 런북과 테스트가 "무슨 env 를 넣어야
 * 켜지나" 를 **값 없이** 물어보는 창구다.
 *
 * ★크레덴셜 all-or-nothing 규약은 그대로다 — 이 함수는 **부분 크레덴셜을
 * 허용하지 않는다.** 쿼터 쿨다운은 크레덴셜과 무관한 완전히 별개의 사유로
 * `ready:false` 를 추가할 뿐, missing-credential 판정 자체(`missing.length
 * === 0`)는 한 글자도 안 바뀐다 — 쿨다운 검사는 크레덴셜이 이미 전부 있을
 * 때만 도달한다(아래 순서).
 */
export function vendorEnvReadiness(pinnedModelId?: string): VendorEnvReadiness {
  const entry = getModel(pinnedModelId ?? "");
  const vendor = entry?.provider;
  const quotaDead = vendor ? vendorQuotaDeadEntry(vendor) : null;
  const profile = envProfileForModel(pinnedModelId);
  const hasProfile = Object.keys(profile).length > 0;
  if (!hasProfile) {
    // 프로파일이 없는 행은 CLI 자기 로그인으로 붙는다 — 크레덴셜 축은
    // 이 함수의 소관이 아니다. 그래도 쿼터 쿨다운은 벤더 축이라 여전히 본다
    // (예: 네이티브 벤더도 자기 쿼터가 죽을 수 있다).
    if (quotaDead) {
      return {
        ...(vendor ? { vendor } : {}),
        hasProfile: false,
        requiredEnvKeys: [],
        missingEnvKeys: [],
        ready: false,
        notReadyReason: "quota-cooldown",
        quotaCooldownUntil: quotaDead.deadUntil,
      };
    }
    return {
      ...(vendor ? { vendor } : {}),
      hasProfile: false,
      requiredEnvKeys: [],
      missingEnvKeys: [],
      ready: true,
    };
  }
  const { missing } = resolveVendorEnvProfile(profile);
  const required = [
    ...new Set(
      Object.values(profile)
        .map((v) => vendorEnvSecretRef(v))
        .filter((k): k is string => Boolean(k)),
    ),
  ].sort();
  if (missing.length > 0) {
    // ★크레덴셜 부재가 항상 먼저다 — 부분 크레덴셜 상태에서 "쿼터 쿨다운"
    // 사유가 그 사실을 가리면 안 된다(키 자체가 없다는 게 더 시급한 사실).
    return {
      ...(vendor ? { vendor } : {}),
      hasProfile: true,
      requiredEnvKeys: required,
      missingEnvKeys: missing,
      ready: false,
      notReadyReason: "missing-credentials",
    };
  }
  if (quotaDead) {
    return {
      ...(vendor ? { vendor } : {}),
      hasProfile: true,
      requiredEnvKeys: required,
      missingEnvKeys: [],
      ready: false,
      notReadyReason: "quota-cooldown",
      quotaCooldownUntil: quotaDead.deadUntil,
    };
  }
  return {
    ...(vendor ? { vendor } : {}),
    hasProfile: true,
    requiredEnvKeys: required,
    missingEnvKeys: [],
    ready: true,
  };
}

/**
 * 핀된 모델의 벤더 프로파일을 스폰 env 에 얹는다(레지스트리 조회 + 시크릿 해석 +
 * `mergeVendorEnv`). 프로파일이 없는 행(anthropic/openai)은 `base` 를 **그 객체
 * 그대로** 돌려준다 — 기존 벤더 스폰 env 는 한 바이트도 안 바뀐다.
 *
 * ★시크릿이 하나라도 없으면 **프로파일 전체를 얹지 않는다**(부분 주입 금지).
 * `ANTHROPIC_BASE_URL` 만 얹히고 토큰이 빠지면 claude CLI 가 **우리 Anthropic
 * 크레덴셜을 그대로 들고** 남의 엔드포인트로 붙는다 — 유출이고, 실패 원인도
 * "왜 인증이 안 되지" 로 오독된다. 전부-아니면-전무가 유일하게 안전하다.
 *
 * 그래도 **스폰은 계속된다**(throw 하지 않는다). 키가 없는 상태에서 GLM 을 지정하면
 * claude 가 Anthropic 에 `--model glm-4.7` 을 물어보고 그 CLI 의 정상 에러로
 * 끝나는데, 그 편이 "티켓이 스폰 실패로 멈추는 것" 보다 낫고 원인도 아래 경고
 * 한 줄로 즉시 드러난다(§8.3 "spawn 이 깨지는 것은 불허" 불변식).
 *
 * @param pinnedModelId 이 launch 가 실제로 쓰는 구체 모델 id(없으면 no-op)
 */
export function applyVendorEnv(
  base: Record<string, string>,
  pinnedModelId?: string,
): Record<string, string> {
  const profile = envProfileForModel(pinnedModelId);
  if (Object.keys(profile).length === 0) return base;

  const vendor = getModel(pinnedModelId ?? "")?.provider;
  const { resolved, missing } = resolveVendorEnvProfile(profile);
  if (missing.length > 0) {
    // ★키 **이름**만 남긴다. 값은 로그에 절대 나가지 않는다.
    console.warn("[agent-config] 벤더 크레덴셜 미설정 — 프로파일 미주입", {
      model: pinnedModelId ?? "unknown",
      vendor: vendor ?? "unknown",
      missingEnvKeys: missing,
      effect: `${
        vendor ?? "벤더"
      } 대신 하네스 기본 백엔드로 스폰된다(부분 주입 금지)`,
      fix:
        `설정 → API 키 → "벤더 API 키" 에서 ${missing.join(
          ", ",
        )} 를 등록하세요` +
        `(개발 환경이라면 v3/.env 에 넣고 앱 재시작해도 됩니다)`,
    });
    return base;
  }
  return mergeVendorEnv(base, resolved, {
    model: pinnedModelId,
    vendor,
  });
}

/**
 * 이 launch 가 스폰할 **바이너리**(하네스)를 정한다.
 *
 * 에이전트 문서의 `model` 은 종전부터 하네스 축이었다(claude/gpt/antigravity…).
 * 핀된 모델이 레지스트리에 있으면 그 행의 `harness` 가 최종 권위다 — env-swap
 * 벤더는 `{provider:"zai", harness:"claude"}` 라서, 벤더 이름이 무엇이든 claude
 * 바이너리로 접힌다. 모르는 모델·핀 없음이면 입력을 그대로 돌려준다.
 *
 * 오늘 레지스트리의 모든 행이 harness === 기존 ModelType 이라 **항상 항등**이다.
 */
export function harnessForLaunch(
  model: ModelType,
  pinnedModelId?: string,
): ModelType {
  if (model === "local" && pinnedModelId?.trim()) return "claude";
  if (!pinnedModelId) return model;
  const harness = harnessForModel(pinnedModelId);
  if (!harness || harness === model) return model;
  console.warn("[agent-config] 핀 모델의 하네스가 에이전트 모델과 다르다", {
    agentModel: model,
    pinnedModel: pinnedModelId,
    harness,
    note: "바이너리는 하네스를 따른다(축분리 USbdRV4k)",
  });
  return harness;
}

export interface LaunchConfig {
  model: ModelType;
  command: string;
  args: string[];
  env: Record<string, string>;
  mcpConfigPath: string;
  skillContent: string;
  initialPrompt?: string;
  promptProfile: AgentPromptProfile;
  /**
   * For Claude only: the session id this launch is PINNED to (via the
   * `--session-id` flag on a fresh launch, or the `--resume` UUID on a resume).
   * Lets the caller wire cost tracking deterministically — no racy post-launch
   * "which new JSONL appeared?" scan. Undefined for non-Claude models, and for
   * the rare unresolved `--resume latest` claude case (caller falls back to
   * detection). See claudeSessionArgs.
   */
  claudeSessionId?: string;
  /**
   * Grok only: the session id this launch is addressable by — the freshly
   * minted uuid we pinned with `--session-id`, or the concrete uuid we handed
   * `--resume`. Undefined for a `--continue` ('latest') resume, where grok
   * picks the session itself. Grok's cost tracking does NOT need this (it
   * re-resolves the newest file under the per-agent GROK_HOME each tick); it
   * exists so the launch path can name the exact session directory
   * (`<GROK_HOME>/sessions/<encodeURIComponent(cwd)>/<id>/`) in logs when a
   * live resume has to be debugged. See grokSessionArgs.
   */
  grokSessionId?: string;
  /**
   * Claude only: how the `--model` value was resolved when complexity ===
   * "complex" (the only tier that runs the §3 resolver). Carries any
   * graceful fallback (Fable5 version-guard miss, unknown model) so the
   * spawn path can emit telemetry / surface a user-facing marker. Undefined
   * for non-complex / non-claude launches and for runtime-downgrade
   * relaunches (which pass an explicit override, not the resolver).
   */
  modelResolution?: TopModelResolution;
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

/**
 * Decide Grok Build's session-related CLI args and the resulting session id.
 *
 * Contract verified LIVE against grok 0.2.112 on this machine (isolated
 * GROK_HOME, headless `-p` turns):
 *
 *   `--session-id <uuid>`   pins a NEW conversation to that uuid and names the
 *                           session directory after it
 *                           (`<GROK_HOME>/sessions/<encodeURIComponent(cwd)>/<uuid>/`).
 *                           Reusing an existing id is FATAL
 *                           ("Session ID … is already in use") — so this is
 *                           only ever emitted on a freshly minted uuid.
 *   `--resume <uuid>`       resumes that exact session. ★cwd-INDEPENDENT: grok
 *                           searches the whole GROK_HOME and reports
 *                           "found locally (originally in <dir>)". Unknown id
 *                           is FATAL (falls through to a remote registry
 *                           lookup → 404 → exit), exactly like the codex
 *                           `resume <unknown-id>` 즉사 전례 — so grok must never
 *                           be handed another CLI's uuid.
 *   `--continue`            resumes the most recent session FOR THE CURRENT
 *                           WORKING DIRECTORY. Fatal on an empty cwd
 *                           ("No session found for current directory"), hence
 *                           the hasSavedSession() gate before we emit it.
 *
 * So, mirroring the Claude path:
 *
 *   fresh / "new"        → `--session-id <newSessionId>`, id = newSessionId
 *   resume concrete UUID → `--resume <uuid>`,             id = uuid
 *   resume "latest"      → `--continue`,                  id = undefined
 *
 * Unlike Claude the fresh pin is unconditional (no `pinFreshSession` opt-in).
 * Claude needs the opt-in because the orchestrator pushes its own `--resume`
 * onto argv afterwards and the two flags would collide; the orchestrator does
 * no such thing for grok (orchestrator-manager only appends `--resume` when
 * `launchConfig.model === "claude"`), so pinning is always safe here and buys
 * a deterministic, addressable session directory from turn one.
 *
 * ★Session keying uses the REAL cwd, not grok's normalized main checkout —
 * verified live in a git worktree, whose session landed under the worktree's
 * own encoded path. (The main-checkout normalization that
 * `writeGrokHomeFiles` compensates for is a FOLDER-TRUST rule, not a session
 * one.) `--continue` therefore stays scoped to the worktree the agent runs in.
 */
export function grokSessionArgs(
  resumeSessionId: string | undefined,
  newSessionId: string,
): { args: string[]; sessionId?: string } {
  const wantResume = !!resumeSessionId && resumeSessionId !== "new";
  const resumeIsLatest = resumeSessionId === "latest";
  if (wantResume && !resumeIsLatest) {
    return { args: ["--resume", resumeSessionId!], sessionId: resumeSessionId };
  }
  if (wantResume && resumeIsLatest) {
    return { args: ["--continue"], sessionId: undefined };
  }
  return { args: ["--session-id", newSessionId], sessionId: newSessionId };
}

interface MCPServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const SKILLS_DIR = path.resolve(__dirname, "..", "skills");
export const CONFIG_DIR = path.resolve(os.tmpdir(), "marblo-agent-configs");
const ANTIGRAVITY_MCP_CONFIG_RELATIVE_PATHS = [
  // Antigravity 2.0 shared config for IDE + CLI.
  [".gemini", "config", "mcp_config.json"],
  // Older agy CLI builds read this dedicated per-CLI config path.
  [".gemini", "antigravity-cli", "mcp_config.json"],
] as const;
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

/**
 * Root of the per-agent Grok Build session tree
 * (`<GROK_HOME>/sessions/<url-encoded-cwd>/<session-uuid>/updates.jsonl`).
 * Mirrors the isolated GROK_HOME that `writeGrokConfig` creates above, so the
 * tree belongs to exactly one agent. Used by the cost tracker to locate the
 * agent's ACP update stream — the only file grok writes billable tokens into.
 */
export function grokSessionsDir(agentId: string): string {
  return path.join(CONFIG_DIR, `grok-home-${agentId}`, "sessions");
}

// MCP server entry point (compiled JS in dist-mcp/).
//
// 패키지 앱에서 dist-mcp 는 asar 밖 extraResource(Contents/Resources/dist-mcp)
// 로 배포되고(electron-builder.yml extraResources), MCP 서버는 별도 외부 node
// 프로세스로 spawn 되어 app.asar 내부를 아예 못 읽는다. 따라서 패키지 시엔 반드시
// process.resourcesPath/dist-mcp 를 가리켜야 한다. 과거엔 path.resolve(__dirname,
// "..") 만 써서 패키지 시 app.asar/dist-mcp/index.js 를 반환 → MODULE_NOT_FOUND
// (-32000) 로 marblo MCP 연결이 죽었다 (dev 는 __dirname=v3/dist-electron 이라
// v3/dist-mcp 로 맞아 dev 만 동작).
//
// app.isPackaged 대신 __dirname 판별을 쓰는 이유: 이 파일은 cost-tracker 등을
// 통해 electron 이 없는 per-agent MCP 프로세스에서도 import 되므로 `import { app }
// from "electron"` 자체가 위험하다(그 컨텍스트에선 app 이 undefined). __dirname
// 판별은 어떤 프로세스에서도 안전하고, dev 경로 결과는 그대로 유지된다.
function getMCPServerPath(): string {
  if (__dirname.includes("app.asar")) {
    return path.join(process.resourcesPath, "dist-mcp", "index.js");
  }
  return path.resolve(__dirname, "..", "dist-mcp", "index.js");
}

function getAntigravityConfigHome(): string {
  return process.env.MARBLO_AGY_CONFIG_HOME || os.homedir();
}

/**
 * Get a rich PATH that includes common binary locations.
 * Electron on macOS doesn't inherit the user's shell PATH when launched from Finder.
 */
function getEnrichedPath(): string {
  const basePath = process.env.PATH || "";
  // PATH separator is platform-specific: ";" on Windows, ":" on POSIX. Using a
  // hardcoded ":" on Windows shreds the inherited PATH (drive-letter colons like
  // C:\... get split apart), producing an unusable PATH that then overrides the
  // good one in the spawned process env — which is why `claude` couldn't be
  // found and the orchestrator failed to start on Windows.
  const sep = path.delimiter;
  const home = os.homedir();
  const extraPaths =
    os.platform() === "win32"
      ? [
          // Windows Electron already inherits the user PATH; just make sure the
          // common CLI install dirs are present. Native installer drops
          // claude.exe under ~/.local/bin; npm -g shims live under %APPDATA%\npm.
          path.join(home, ".local", "bin"),
          path.join(
            process.env.APPDATA || path.join(home, "AppData", "Roaming"),
            "npm",
          ),
        ]
      : [
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
          path.join(home, ".nvm/versions/node", process.version, "bin"),
          // npm global bin locations — covers the default `npm install -g`
          // prefix as well as common user-customized prefixes (~/.npm-global).
          // The Harness store installs Codex / Gemini CLI here, so the
          // spawned agent processes need these on PATH to find them.
          path.join(home, ".npm/bin"),
          path.join(home, ".npm-global/bin"),
          path.join(home, ".local/bin"),
          path.join(home, ".cargo/bin"),
          path.join(home, ".bun/bin"),
          path.join(home, ".deno/bin"),
          path.join(home, ".volta/bin"),
        ];

  const pathSet = new Set(basePath.split(sep));
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
    ].join(sep);
  }
  return Array.from(pathSet).join(sep);
}

export function getMCPServerEnv(
  projectDir: string,
  marbloProjectId?: string,
  agentId?: string,
  marbloContextId?: string,
  // 역할별 tools/list 스코핑(부트 프리픽스 다이어트 A1)의 유일한 입력.
  // 미지정이면 MCP 서버가 전체 툴을 노출한다(fail-open = 종전 동작).
  role?: string,
  promptProfile: AgentPromptProfile = "full",
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
  if (marbloContextId) {
    env.MARBLO_CONTEXT = marbloContextId;
  }
  env.MARBLO_SKILLS_DIR = SKILLS_DIR;

  // Bridge port for MCP → Electron communication
  if (process.env.MARBLO_BRIDGE_PORT) {
    env.MARBLO_BRIDGE_PORT = process.env.MARBLO_BRIDGE_PORT;
  }
  // Per-session bearer token for the bridge's authenticated endpoints. Without
  // this a spawned agent's MCP would 401 on spawn_agent / dispatch_task / etc.
  if (process.env.MARBLO_BRIDGE_TOKEN) {
    env.MARBLO_BRIDGE_TOKEN = process.env.MARBLO_BRIDGE_TOKEN;
  }
  if (process.env.MARBLO_FIREBASE_CUSTOM_TOKEN) {
    env.MARBLO_FIREBASE_CUSTOM_TOKEN = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
  }

  // Agent ID for audit trail logging
  if (agentId) {
    env.MARBLO_AGENT_ID = agentId;
  } else if (process.env.MARBLO_AGENT_ID) {
    env.MARBLO_AGENT_ID = process.env.MARBLO_AGENT_ID;
  }

  // ── ★폐루프 전진 신호 플래그 (티켓 zyHtb4bjBSUWpzQ46avD) ────────────────
  //
  // `advance-guards.ts :: isAdvanceSignalEnabled()` 는 **MCP 서버 프로세스의**
  // process.env 를 읽는다. 그런데 이 함수가 조립하는 env 가 그 자식이 받는 env
  // 전부다 — 여기 없는 키는 셸에 넣든 v3/.env 에 넣든 자식에 도달하지 않는다.
  // 그래서 #1414(폐루프)와 #1416(미션층)이 같은 플래그를 쓰면서도 둘 다 켤 수
  // 없었다. 전달 경로가 없었던 것이지 판정이 틀린 게 아니다.
  //
  // ★allowlist 를 여는 대신 이 키 하나만 명시적으로 추가한다. 목록이 닫혀 있는
  //   것 자체가 설계다(자식이 앱 프로세스의 시크릿을 통째로 물려받지 않는다).
  //
  // ★값의 출처는 **앱 프로세스의 process.env 뿐**이다. 여기서 v3/.env 를 따로
  //   읽지 않는다 — main.ts 가 부팅 때 dotenv 로 v3/.env 를 이미 process.env 에
  //   실으므로(main.ts:467) 셸과 .env 가 자동으로 둘 다 커버되고, 파일을 두 번
  //   읽으면 "앱이 본 값"과 "MCP 가 본 값"이 갈라질 수 있는 자리가 생긴다.
  //   부작용으로 앱 재시작 없이는 못 바꾸게 되는데, 비용이 나가는 스위치에는
  //   그게 오히려 정상이다.
  //
  // ★값은 **가공하지 않는다**. 정규화도 기본값도 여기서 주지 않고 원문 그대로
  //   싣는다 — 정확히 "on" 만 받는 규율(트림+소문자화 후 완전일치)의 단일 판정
  //   지점은 isAdvanceSignalEnabled 하나여야 한다. 전달 경로가 " ON " 을 미리
  //   다듬거나 미설정에 "off" 를 채워 넣으면 판정이 두 곳으로 쪼개진다.
  if (process.env[ADVANCE_SIGNAL_ENV] !== undefined) {
    env[ADVANCE_SIGNAL_ENV] = process.env[ADVANCE_SIGNAL_ENV]!;
  }

  // 부트 프리픽스 다이어트 A1 — 역할별 tools/list 스코핑. 역할이 없으면 아무
  // 키도 안 들어가고 MCP 서버는 종전대로 44개 전부를 노출한다.
  Object.assign(env, toolSurfaceEnv(role));
  if (promptProfile === "local-tool-use") {
    env.MARBLO_TOOL_SURFACE = "local-light";
  } else if (promptProfile === "local-tool-use-lite") {
    // 경량 티어 전용 표면(5툴). 남긴/뺀 툴의 근거는 tool-surface.ts 참조.
    env.MARBLO_TOOL_SURFACE = "local-lite";
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
  marbloContextId?: string,
  role?: string,
  promptProfile: AgentPromptProfile = "full",
): MCPServerEntry {
  // PATH 의 첫 node 를 믿지 않고 검증된 node 를 pin 한다. Electron 번들이면
  // ELECTRON_RUN_AS_NODE=1 가 함께 필요하므로 node.env 를 마지막에 머지해
  // getMCPServerEnv 가 덮어쓰지 못하게 한다(키 충돌은 없지만 안전 우선).
  const node = resolveNodeBinary();
  return {
    command: node.command,
    args: [getMCPServerPath()],
    env: {
      ...getMCPServerEnv(
        projectDir,
        marbloProjectId,
        agentId,
        marbloContextId,
        role,
        promptProfile,
      ),
      ...node.env,
    },
  };
}

// ── 격리 GROK_HOME 한 벌 (config.toml + trusted_folders.toml) ─────────────
//
// ★왜 trusted_folders.toml 까지 써야 하는가 (라이브 실측, grok 0.2.112):
//   격리 GROK_HOME 은 사용자 홈이 아니라 **새 홈**이라 아무 폴더도 신뢰돼 있지
//   않다. grok 은 신뢰되지 않은 폴더에서 로컬 stdio MCP 서버를 **아예 기동하지
//   않는다** — `grok mcp doctor marblo` 가
//     ✗ folder untrusted (repo-local (project-scoped) server not started)
//   로 떨어지고 툴은 0개다. config.toml 에 `[mcp_servers.marblo]` 가 멀쩡히
//   들어있고 `grok inspect` 가 그 서버를 "로드됨"으로 보여줘도 그렇다. 즉 오케는
//   뜨지만 dispatch/보드 툴이 하나도 없는 **무력 오케**가 된다. 신뢰를 주면 같은
//   config 로 `✓ handshake OK / 41 tools discovered` 가 된다.
//
// ★신뢰 키잉 주의: grok 은 git **worktree 를 main 체크아웃으로 정규화**한다.
//   워크트리 자기 경로만 신뢰 등록하면 여전히 `Project trusted: no` 이고,
//   main 체크아웃을 등록해야 신뢰된다(실측). 그래서 후보에 projectDir 뿐 아니라
//   그 realpath 와 **git main 체크아웃**(+realpath)까지 함께 넣는다.
//
// 사용자가 이미 내린 신뢰 결정(~/.grok/trusted_folders.toml)은 그대로 보존한다.
// 같은 폴더가 사용자 파일에 이미 있으면(신뢰 여부 무관) 우리 엔트리를 덧붙이지
// 않는다 — TOML 중복 테이블은 파싱 자체를 깨뜨리고, 사용자가 명시적으로 거부한
// 폴더를 우리가 몰래 뒤집어서도 안 되기 때문이다.
function writeGrokHomeFiles(
  grokHome: string,
  mcpEntry: MCPServerEntry,
  projectDir?: string,
): { configPath: string; written: string[] } {
  const written: string[] = [];
  const userGrokDir = path.join(os.homedir(), ".grok");

  // ── config.toml ────────────────────────────────────────────────────────
  const userConfigPath = path.join(userGrokDir, "config.toml");
  let preserved = "";
  if (fs.existsSync(userConfigPath)) {
    try {
      preserved = fs
        .readFileSync(userConfigPath, "utf-8")
        .replace(/\[mcp_servers\.[\s\S]*?(?=\n\[(?!mcp_servers)|$)/g, "")
        .trimEnd();
    } catch {
      // Best-effort — ignore unreadable user config.
    }
  }

  const envEntries = Object.entries(mcpEntry.env || {})
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join("\n");

  const tomlSections = [
    preserved,
    "",
    "[mcp_servers.marblo]",
    `command = ${JSON.stringify(mcpEntry.command)}`,
    `args = ${JSON.stringify(mcpEntry.args)}`,
    "enabled = true",
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 6000",
  ];
  if (envEntries) {
    tomlSections.push("", "[mcp_servers.marblo.env]", envEntries);
  }

  const configPath = path.join(grokHome, "config.toml");
  fs.writeFileSync(configPath, tomlSections.join("\n") + "\n", "utf-8");
  written.push(configPath);

  // ── trusted_folders.toml ───────────────────────────────────────────────
  const trustPath = path.join(grokHome, "trusted_folders.toml");
  let preservedTrust = "";
  try {
    const userTrustPath = path.join(userGrokDir, "trusted_folders.toml");
    if (fs.existsSync(userTrustPath)) {
      preservedTrust = fs.readFileSync(userTrustPath, "utf-8").trimEnd();
    }
  } catch {
    // Best-effort — a missing/unreadable user trust file just means we write
    // only our own entries.
  }

  const alreadyDecided = new Set(grokTrustedFolderKeys(preservedTrust));
  const candidates: string[] = [];
  const addCandidate = (candidate: string | null | undefined): void => {
    if (!candidate) return;
    const abs = path.resolve(candidate);
    if (alreadyDecided.has(abs) || candidates.includes(abs)) return;
    candidates.push(abs);
  };
  if (projectDir) {
    addCandidate(projectDir);
    addCandidate(safeRealpath(projectDir));
    const mainCheckout = resolveGitMainCheckout(projectDir);
    addCandidate(mainCheckout);
    addCandidate(mainCheckout ? safeRealpath(mainCheckout) : null);
  }

  const decidedAt = Math.floor(Date.now() / 1000);
  const trustSections = candidates.map(
    (folder) =>
      `[folders.${JSON.stringify(
        folder,
      )}]\ntrusted = true\ndecided_at = ${decidedAt}`,
  );
  const trustBody = [preservedTrust, ...trustSections]
    .filter(Boolean)
    .join("\n\n");
  fs.writeFileSync(trustPath, trustBody ? `${trustBody}\n` : "", "utf-8");
  written.push(trustPath);

  return { configPath, written };
}

/** trusted_folders.toml 본문에서 이미 결정된 폴더 경로들을 뽑는다. */
function grokTrustedFolderKeys(toml: string): string[] {
  const keys: string[] = [];
  const re = /^\s*\[folders\.(?:"([^"]*)"|'([^']*)')\]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(toml)) !== null) {
    const raw = m[1] ?? m[2];
    if (raw) keys.push(path.resolve(raw));
  }
  return keys;
}

/**
 * `dir` 이 속한 git **main 체크아웃**(worktree 가 아닌 원본) 경로.
 *
 * linked worktree 는 `.git` 이 파일이고 그 안의 `gitdir:` 가
 * `<main>/.git/worktrees/<name>` 을 가리킨다 — 거기서 `<main>` 을 되짚는다.
 * git 을 스폰하지 않는다(설정 생성 경로라 동기 subprocess 를 피한다).
 */
function resolveGitMainCheckout(dir: string): string | null {
  let cur = path.resolve(dir);
  for (let depth = 0; depth < 64; depth++) {
    const dotGit = path.join(cur, ".git");
    try {
      const stat = fs.lstatSync(dotGit);
      if (stat.isDirectory()) return cur;
      if (stat.isFile()) {
        const match = /^gitdir:\s*(.+)$/m.exec(
          fs.readFileSync(dotGit, "utf-8"),
        );
        if (!match) return cur;
        const gitDir = path.resolve(cur, match[1].trim());
        const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
        const idx = gitDir.indexOf(marker);
        return idx >= 0 ? gitDir.slice(0, idx) : cur;
      }
    } catch {
      // No .git here — keep walking up.
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function safeRealpath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

// ── grok 오케 무력화 방지 게이트 ─────────────────────────────────────────
//
// grok 오케는 marblo MCP 없이는 dispatch·보드 조작이 하나도 안 되는 껍데기다.
// 그런데 그 실패는 **조용하다** — CLI 는 멀쩡히 뜨고, config.toml 엔 서버가
// 들어있고, `grok inspect` 도 "로드됨" 으로 보여준다. 폴더 신뢰가 없으면 grok 이
// 서버를 기동만 안 할 뿐이다(writeGrokHomeFiles 주석 참조). 그래서 "설정 파일에
// 썼는가" 를 자기 자신에게 되묻는 동어반복 검사로는 못 잡는다.
//
// 유일하게 정직한 검사는 **grok 에게 직접 물어보는 것**이다. `grok mcp doctor
// marblo --json` 은 실제로 서버를 기동해 핸드셰이크하고 툴 개수를 돌려준다
// (실측 ~0.45s). 프로덕션과 동일한 `writeGrokHomeFiles` 로 일회용 GROK_HOME 을
// 만들어 검사하므로, 통과하면 진짜 스폰도 같은 결과를 낸다.
export interface GrokMcpProbeResult {
  ok: boolean;
  toolCount: number;
  /** ok 일 때 "" — 아니면 기계 판독용 사유. */
  reason: string;
  /** 사람이 읽는 한 줄(로그/UI 용). 시크릿을 담지 않는다. */
  detail: string;
}

interface GrokDoctorCheck {
  label?: string;
  passed?: boolean;
  detail?: string;
}

interface GrokDoctorServer {
  name?: string;
  healthy?: boolean;
  checks?: GrokDoctorCheck[];
}

const GROK_MCP_PROBE_TIMEOUT_MS = 20_000;

/**
 * 이 프로젝트에서 grok 이 marblo MCP 를 실제로 기동하고 툴을 붙일 수 있는지
 * 라이브로 확인한다. 일회용 GROK_HOME 을 만들고 검사 후 지운다.
 *
 * 필요 툴 개수는 오케가 실제로 쓰는 최소 표면(CODEX_ORCH_REQUIRED_MCP_TOOLS)을
 * 하한으로 쓴다 — doctor 가 이름이 아니라 개수만 주기 때문이다. 서버가 그 이름들을
 * 실제로 노출하는지는 MCP 표면 테스트가 따로 못박는다.
 */
export async function probeGrokMarbloMcp(
  projectDir: string,
): Promise<GrokMcpProbeResult> {
  const probeHome = path.join(
    CONFIG_DIR,
    `grok-mcp-probe-${crypto.randomUUID()}`,
  );
  try {
    fs.mkdirSync(probeHome, { recursive: true });
    writeGrokHomeFiles(
      probeHome,
      buildMCPServerEntry(projectDir, undefined, "grok-mcp-probe"),
      projectDir,
    );

    const grokCli = resolveHarnessCli("grok").command;
    const stdout = await execFileCapture(
      grokCli,
      ["mcp", "doctor", "marblo", "--json"],
      {
        cwd: projectDir,
        env: { ...process.env, GROK_HOME: probeHome },
        timeout: GROK_MCP_PROBE_TIMEOUT_MS,
      },
    );

    let servers: GrokDoctorServer[] = [];
    try {
      servers =
        (JSON.parse(stdout) as { servers?: GrokDoctorServer[] }).servers ?? [];
    } catch {
      return {
        ok: false,
        toolCount: 0,
        reason: "doctor-unparsable",
        detail: `grok mcp doctor 출력을 해석하지 못했습니다 (grok CLI ${grokCli})`,
      };
    }

    const marblo = servers.find((s) => s.name === "marblo");
    if (!marblo) {
      return {
        ok: false,
        toolCount: 0,
        reason: "server-not-configured",
        detail: "grok 이 marblo MCP 서버를 인식하지 못했습니다",
      };
    }

    const toolCount = grokDoctorToolCount(marblo);
    if (!marblo.healthy) {
      const failed = (marblo.checks ?? []).find((c) => c.passed === false);
      return {
        ok: false,
        toolCount,
        reason: "server-unhealthy",
        detail: failed?.label
          ? `marblo MCP 기동 실패: ${failed.label}${
              failed.detail ? ` (${failed.detail})` : ""
            }`
          : "marblo MCP 기동 실패",
      };
    }
    if (toolCount < CODEX_ORCH_REQUIRED_MCP_TOOLS.length) {
      return {
        ok: false,
        toolCount,
        reason: "insufficient-tools",
        detail: `marblo MCP 툴 ${toolCount}개 — 오케에 필요한 최소 ${CODEX_ORCH_REQUIRED_MCP_TOOLS.length}개 미만`,
      };
    }
    return {
      ok: true,
      toolCount,
      reason: "",
      detail: `marblo MCP 툴 ${toolCount}개 확인`,
    };
  } catch (error) {
    return {
      ok: false,
      toolCount: 0,
      reason: "probe-failed",
      detail: `grok MCP 프로브 실패: ${errorMessage(error)}`,
    };
  } finally {
    try {
      fs.rmSync(probeHome, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup — a leftover probe dir must never fail a launch.
    }
  }
}

/** doctor 의 "<N> tools discovered" 체크에서 개수를 뽑는다. */
function grokDoctorToolCount(server: GrokDoctorServer): number {
  for (const check of server.checks ?? []) {
    const match = /^(\d+)\s+tools?\s+discovered$/i.exec(check.label ?? "");
    if (match) return Number(match[1]);
  }
  return 0;
}

/**
 * execFile 의 stdout 을 돌려준다. **비정상 종료도 던지지 않는다** — `grok mcp
 * doctor` 는 unhealthy 일 때 exit 1 이면서도 진단 JSON 을 정상 출력하기 때문이다
 * (실측). 그 JSON 이야말로 우리가 읽고 싶은 것이다. 진짜 실행 실패(ENOENT,
 * 타임아웃)는 stdout 이 비어 호출부의 파싱 분기가 잡는다.
 */
function execFileCapture(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout) => {
      if (stdout && stdout.trim()) {
        resolve(stdout);
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout ?? "");
    });
  });
}

// ── Per-agent MCP 화이트리스트 (RAM 절감 §성능) ──────────────────────────
// 배경: claude 스폰이 `--mcp-config`만 주고 `--strict-mcp-config`를 안 주면
// Claude 가 per-agent config(marblo 1개)에 사용자 글로벌 ~/.claude.json 의
// MCP 6종(github/playwright/filesystem/context7/crossai-verifier/taskforce)을
// 머지한다 → 에이전트마다 안 쓰는 서버까지 중복 스폰(특히 context7 은 npx
// 래퍼+child 로 2프로세스)되어 플릿 전체 RAM ~7-16GB 낭비.
//
// 해결: claude args 에 `--strict-mcp-config` 를 붙여 글로벌 머지를 차단하되
// (단독이면 marblo 만 남아 기능 박탈 → 회귀), per-agent config 에 "그 역할이
// 실제 쓰는 글로벌 서버만" 명시 주입하는 화이트리스트로 기능 손실 0 을 유지.
//
// ⚠️ 오케스트레이터(role:"orchestrator")도 model:"claude" 경로를 그대로 타므로
//    blanket 으로 깎으면 오케 MCP 능력까지 박탈된다. orchestrator/team_leader 는
//    글로벌 전체를 화이트리스트해 현행을 byte-동등하게 보존하고, 워커 역할만 트림.
//
// codex(격리 CODEX_HOME, mcp_servers strip 후 marblo만)·gemini(settings.json
// marblo만)는 이미 글로벌 머지가 없어 strict-동등 — 이 화이트리스트는 claude
// 전용이다. agy 는 사용자 공유 글로벌 config 머지라 별개 트랙.
//
// marblo 는 역할 무관 항상 별도 주입(태스크 컨트롤 플레인)되므로 목록에서 제외.
const ROLE_MCP_WHITELIST: Record<string, string[]> = {
  backend: ["filesystem"],
  frontend: ["filesystem", "playwright"],
  test: ["playwright", "filesystem"],
  devops: ["github", "filesystem"],
  merge: ["github", "filesystem"],
  flutter: ["filesystem"],
};

// 오케스트레이터급 역할 — 글로벌 전체 보존(현행 능력 유지).
const FULL_MCP_ROLES = new Set(["orchestrator", "team_leader"]);

// 알 수 없는 워커 역할의 보수적 기본값: 명백히 에이전트가 안 쓰는
// crossai-verifier / taskforce / context7 만 제외하고 나머지는 살린다.
const DEFAULT_WORKER_WHITELIST = ["github", "playwright", "filesystem"];

/**
 * 사용자 글로벌 ~/.claude.json 의 top-level mcpServers 를 읽는다.
 * strict 적용 후에도 에이전트가 쓰던 서버를 그대로 재현하기 위한 source-of-truth.
 */
function readGlobalClaudeMcpServers(): Record<string, MCPServerEntry> {
  try {
    const f = path.join(os.homedir(), ".claude.json");
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8")) as {
      mcpServers?: Record<string, MCPServerEntry>;
    };
    return parsed.mcpServers ?? {};
  } catch {
    // 글로벌 config 부재/파손 시엔 빈 집합 — per-agent marblo 만으로도 동작.
    return {};
  }
}

/** 역할별로 화이트리스트할 글로벌 서버 이름 목록을 고른다. */
function whitelistNamesForRole(
  role: string,
  availableNames: string[],
): string[] {
  const r = (role || "").toLowerCase();
  // 오케/리더: 글로벌 전체 보존(현행 byte-동등).
  if (FULL_MCP_ROLES.has(r)) return availableNames;
  if (ROLE_MCP_WHITELIST[r]) return ROLE_MCP_WHITELIST[r];
  return DEFAULT_WORKER_WHITELIST;
}

/**
 * 역할이 실제 쓰는 글로벌 MCP 서버 엔트리만 골라 반환. marblo 는 항상 별도
 * 주입되므로 여기서 제외하며, 글로벌에 정의되지 않은 이름은 조용히 건너뛴다.
 */
function selectWhitelistedGlobalServers(
  role: string,
): Record<string, MCPServerEntry> {
  const global = readGlobalClaudeMcpServers();
  const names = whitelistNamesForRole(role, Object.keys(global));
  const out: Record<string, MCPServerEntry> = {};
  for (const name of names) {
    if (name === "marblo") continue; // per-agent 로 따로 주입
    const entry = global[name];
    if (entry) out[name] = entry;
  }
  return out;
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

interface RoleSkillSpec {
  title: string;
  role: string;
  stack: string[];
  codingRules: string[];
  scopeRules: string[];
  workSummary: string;
  reviewTarget: string;
}

const ROLE_SKILL_SPECS: Record<string, RoleSkillSpec> = {
  backend: {
    title: "Backend Agent Skill (v3)",
    role:
      "You are the Marblo v3 backend development agent. Own Electron main-process APIs, services, data-processing logic, Firebase/Firestore integration, and MCP-server-facing backend behavior.",
    stack: [
      "TypeScript with strict mode",
      "Node.js and Electron main process",
      "Firebase / Firestore",
      "MCP Server based task management",
    ],
    codingRules: [
      "Follow TypeScript strict mode. Do not introduce `any`.",
      "Define explicit interfaces and types for structured data.",
      "Use async/await instead of callback-style control flow.",
      "Handle errors with try/catch and meaningful messages.",
      "Keep Firestore collection/document paths in constants.",
      "Use transactions where races are possible.",
      "Check whether new Firestore queries require indexes.",
      "Use `ipcMain.handle()` for Electron invoke/handle APIs.",
      "Validate data received from renderer processes.",
      "Run long work asynchronously.",
    ],
    scopeRules: [
      "Modify only files under `v3/electron/` unless the task explicitly permits another path.",
      "`v3/src/services/` and `v3/src/types/` are allowed when needed.",
      "Do not modify frontend components under `v3/src/components/`.",
      "Never hardcode API keys or secrets.",
    ],
    workSummary: "Implement backend code changes.",
    reviewTarget:
      "code, PR, or task output for backend defects, coding-rule violations, security issues, performance risks, missing tests, and edge cases",
  },
  frontend: {
    title: "Frontend Agent Skill (v3)",
    role:
      "You are the Marblo v3 frontend development agent. Own React UI, renderer flows, user interaction, presentation logic, and Electron preload API consumption.",
    stack: [
      "TypeScript with strict mode",
      "React",
      "Electron renderer / preload API",
      "Local state stores and UI tests",
    ],
    codingRules: [
      "Follow TypeScript strict mode. Do not introduce `any`.",
      "Keep components focused and consistent with existing UI patterns.",
      "Validate data crossing the Electron preload boundary.",
      "Use accessible controls and testable UI behavior.",
      "Keep state updates predictable and scoped.",
    ],
    scopeRules: [
      "Modify frontend files only when the assigned task calls for frontend work.",
      "Do not change backend or MCP behavior unless the task explicitly asks for it.",
      "Never hardcode API keys or secrets.",
    ],
    workSummary: "Implement frontend/UI changes.",
    reviewTarget:
      "UI, component, PR, or task output for frontend defects, UX regressions, security issues, performance risks, missing tests, and edge cases",
  },
  test: {
    title: "Test Agent Skill (v3)",
    role:
      "You are the Marblo v3 test agent. Own test design, regression coverage, verification, and clear reporting of pass/fail evidence.",
    stack: [
      "TypeScript with strict mode",
      "Vitest unit and integration tests",
      "Playwright component and E2E tests",
      "Electron test harnesses",
    ],
    codingRules: [
      "Add focused tests that cover the requested behavior and important regressions.",
      "Keep fixtures minimal and deterministic.",
      "Report exact commands and outcomes.",
      "Do not weaken assertions to make tests pass.",
      "Surface missing coverage and residual risk.",
    ],
    scopeRules: [
      "Prefer test files and test helpers unless the task explicitly asks for production fixes.",
      "Do not modify unrelated product behavior.",
      "Never hardcode API keys or secrets.",
    ],
    workSummary: "Design, write, or run tests.",
    reviewTarget:
      "test or QA output for correctness, missing coverage, flaky assumptions, security issues, performance risks, and edge cases",
  },
  devops: {
    title: "DevOps Agent Skill (v3)",
    role:
      "You are the Marblo v3 DevOps agent. Own build, release, infrastructure, deployment, CI/CD, and operational configuration work.",
    stack: [
      "Electron build and release tooling",
      "Firebase deployment",
      "CI/CD pipelines",
      "Secret and environment management",
    ],
    codingRules: [
      "Keep build and deployment changes reproducible.",
      "Validate CI/CD changes with the narrowest meaningful command.",
      "Treat credentials and deployment targets as sensitive.",
      "Prefer reversible configuration changes.",
      "Document operational risks in the activity log.",
    ],
    scopeRules: [
      "Modify build, deployment, or infrastructure files only as required by the task.",
      "Do not alter product behavior unless the task explicitly asks for it.",
      "Never hardcode API keys or secrets.",
    ],
    workSummary: "Implement infrastructure, build, or deployment work.",
    reviewTarget:
      "deployment scripts, infrastructure configuration, PR, or task output for reliability, security, rollback, performance, missing tests, and edge cases",
  },
};

function roleSkillSpecFor(role: string): RoleSkillSpec {
  const normalized = role.toLowerCase();
  return (
    ROLE_SKILL_SPECS[normalized] ?? {
      title: `${role || "Worker"} Agent Skill (v3)`,
      role:
        "You are a Marblo v3 worker agent. Follow the assigned task, use MCP task tools for coordination, and keep user-facing conversation in the user's language.",
      stack: [
        "TypeScript with strict mode when editing TypeScript",
        "Node.js / Electron where applicable",
        "MCP Server based task management",
      ],
      codingRules: [
        "Follow the existing codebase patterns.",
        "Keep changes scoped to the assigned task.",
        "Use clear errors and focused verification.",
      ],
      scopeRules: [
        "Respect the scope in the task instructions.",
        "Do not edit unrelated files.",
        "Never hardcode API keys or secrets.",
      ],
      workSummary: "Implement the assigned work.",
      reviewTarget:
        "the assigned review target for defects, rule violations, security issues, performance risks, missing tests, and edge cases",
    }
  );
}

export function generateEnglishRoleSkillContent(role: string): string {
  const spec = roleSkillSpecFor(role);
  const queueRole = role || "worker";
  const bulletList = (items: string[]) =>
    items.map((item) => `- ${item}`).join("\n");

  return [
    `# ${spec.title}`,
    "",
    "## Role",
    "",
    spec.role,
    "",
    "## Technical Stack",
    "",
    bulletList(spec.stack),
    "",
    "## MCP Task Tools",
    "",
    "| Tool | Purpose |",
    "| --- | --- |",
    "| `get_agent_skill(role)` | Read the current role instructions before task work. |",
    "| `get_available_tasks(role)` | List available tasks for this role. |",
    "| `claim_task(task_id, agent_id)` | Claim one TODO task whose dependencies are satisfied. |",
    "| `update_task_status(task_id, status, comment)` | Move task state through CLAIMED, IN_PROGRESS, REVIEW, DONE, BLOCKED, or FAILED. |",
    "| `add_activity(task_id, message)` | Record progress, decisions, questions, and verification evidence. |",
    "| `submit_for_review(task_id, pr_url?)` | Submit completed work for review. |",
    "| `get_task_dependencies(task_id)` | Check whether dependencies are satisfied. |",
    "| `check_feedback(role)` | Check unread PM feedback for this role. |",
    "| `acknowledge_feedback(task_id)` | Mark feedback as read when that tool is available. |",
    "",
    "## State Transitions",
    "",
    "```",
    "TODO -> CLAIMED -> IN_PROGRESS -> REVIEW -> DONE",
    "                              -> BLOCKED",
    "                              -> FAILED",
    "```",
    "",
    "## Secret And Config Guardrails",
    "",
    "- Do not cat, print, or log raw contents from `.env`, `.mcp.json`, firebase-config files, service account JSON, OAuth/Toss/Paddle/API key files, or similar secret-bearing files.",
    "- When configuration checks are needed, report only whether keys exist, file paths, and masked values.",
    "- If a config or env value must be logged, apply `maskConfigForLogging` or `maskEnvForLogging`-style masking.",
    "",
    "## Coding Rules",
    "",
    bulletList(spec.codingRules),
    "",
    "## Scope Rules",
    "",
    bulletList(spec.scopeRules),
    "",
    "## PM Feedback",
    "",
    `At each task step, call check_feedback(role="${queueRole}"). If feedback exists, immediately respond with add_activity and incorporate it before continuing.`,
    "",
    "## Autonomous Work Loop",
    "",
    "1. Call get_agent_skill for this role and follow these instructions.",
    `2. Call get_available_tasks("${queueRole}") to find work.`,
    "3. Claim exactly one task with claim_task(task_id, agent_id).",
    '4. Call add_activity(task_id, "Task claimed. Starting work.").',
    `5. Call check_feedback(role="${queueRole}").`,
    '6. Call update_task_status(task_id, "IN_PROGRESS").',
    `7. ${spec.workSummary} Then call add_activity(task_id, "Implementation complete: [summary]").`,
    '8. Run focused verification. Then call add_activity(task_id, "Verification complete: [commands and result]").',
    `9. Call check_feedback(role="${queueRole}") again.`,
    "10. Call submit_for_review(task_id) when the work is ready.",
    "11. Immediately look for the next available task. Do not idle between tasks.",
    "12. If no task is available, report that to the team lead/orchestrator and stop.",
    "",
    "## Core Rules",
    "",
    "- Work on only one task at a time.",
    "- Record every meaningful step with add_activity.",
    "- Keep user-facing conversation in the user's locale. If the user writes Korean, answer the user in Korean. The agent-to-orchestrator internal protocol can stay in English.",
    "- Preserve tool names and protocol keys exactly: submit_for_review, update_task_status, add_activity, ask_orchestrator.",
    "",
    "## Review Task Branch",
    "",
    `If the assigned task asks you to review another code change, PR, task, or artifact, replace the normal implementation steps with this review flow:`,
    "",
    '1. Call update_task_status(task_id, "IN_PROGRESS").',
    `2. Inspect ${spec.reviewTarget}.`,
    '3. Record findings with add_activity(task_id, "Review result: [APPROVE|REJECT]\\n- issue 1\\n- issue 2 ...").',
    "4. If APPROVE, call submit_for_review(task_id).",
    '5. If REJECT, call update_task_status(task_id, "FAILED", comment="one-line core reason and recommended action").',
    "",
    "## When Blocked",
    "",
    "- Do not guess when evidence is missing. Ask the orchestrator, not the user.",
    '- Preferred path: call ask_orchestrator(task_id, question="Need: ... / Reason: ... / Blocked scope if unanswered: ...", blocking=false).',
    '- Legacy path: call add_activity(task_id, message="[Question] ..."). Use the `[Question]` marker when the message must reach the orchestrator PTY.',
    "- Asking a question must not stop the whole task. Continue all unrelated work that can proceed.",
    '- If the unknown genuinely prevents progress, call update_task_status(task_id, "BLOCKED", comment="what is being waited on").',
    '- You cannot enable max/ultra effort yourself. If needed, call request_model_escalation(task_id, model, effort, reason="what was tried cheaply and why it is insufficient") and continue with the best available model while waiting.',
    "",
    "## Completion Reporting",
    "",
    "When the task is done, you must call one of these MCP tools so the orchestrator is notified automatically:",
    "",
    "- Normal completion / ready for review: submit_for_review(task_id, pr_url?)",
    '- Failure or blockage: update_task_status(task_id, "FAILED"|"BLOCKED", comment="reason")',
    "",
    "Do not finish with only a text reply. The orchestrator only receives automatic completion notifications through these tool calls.",
    "",
  ].join("\n");
}

export class AgentConfigGenerator {
  private generatedFiles: Map<string, string[]> = new Map();
  /** Per-agent Responses→Chat bridges (Upstage Solar). Stopped in cleanup(). */
  private codexChatBridges: Map<string, CodexChatBridgeHandle> = new Map();

  /**
   * Generate model-specific MCP configuration file.
   * Returns the path to the generated config file.
   */
  generateMCPConfig(
    agentId: string,
    model: ModelType,
    projectDir: string,
    marbloProjectId?: string,
    marbloContextId?: string,
    // 역할별 MCP 화이트리스트(claude strict 경로) 선택용. 미지정이면 기본
    // 워커 화이트리스트가 적용된다.
    role?: string,
    promptProfile: AgentPromptProfile = "full",
    /** Pinned concrete model id (codexModel) — drives Codex vendor provider override. */
    pinnedModelId?: string,
  ): string {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    if (promptProfile === "chat-only" && (model === "claude" || model === "local")) {
      return this.generateEmptyClaudeMcpConfig(agentId);
    }

    const mcpEntry = buildMCPServerEntry(
      projectDir,
      marbloProjectId,
      agentId,
      marbloContextId,
      role,
      promptProfile,
    );

    switch (model) {
      case "claude":
      case "local":
        return this.generateClaudeConfig(agentId, mcpEntry, role);
      case "gemini":
        return this.generateGeminiConfig(agentId, mcpEntry);
      case "gpt":
        return this.generateGPTConfig(
          agentId,
          mcpEntry,
          projectDir,
          pinnedModelId,
        );
      case "grok":
        return this.generateGrokConfig(agentId, mcpEntry, projectDir);
      case "antigravity":
        return this.generateAntigravityConfig(agentId, mcpEntry);
      case "custom":
        return this.generateCustomConfig(agentId, mcpEntry);
      default:
        return this.generateClaudeConfig(agentId, mcpEntry);
    }
  }

  /** chat-only 로컬 스폰용 — MCP 서버 0개. */
  private generateEmptyClaudeMcpConfig(agentId: string): string {
    const configPath = path.join(CONFIG_DIR, `claude-mcp-${agentId}.json`);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: {} }, null, 2),
      "utf-8",
    );
    this.trackFile(agentId, configPath);
    return configPath;
  }

  /**
   * Generate role-specific skill file in the project's skills directory.
   * Returns the path to the skill file.
   */
  generateSkillFile(
    agentId: string,
    role: string,
    _projectDir: string,
  ): string {
    const safeRole = role.replace(/[^a-zA-Z0-9_]/g, "");
    if (!safeRole) return "";
    const skillDir = path.join(CONFIG_DIR, "english-role-skills");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, `${agentId}-${safeRole}_agent.md`);
    const content = generateEnglishRoleSkillContent(safeRole);
    const existing = fs.existsSync(skillPath)
      ? fs.readFileSync(skillPath, "utf-8")
      : "";
    if (existing !== content) {
      fs.writeFileSync(skillPath, content, "utf-8");
    }
    this.trackFile(agentId, skillPath);
    return skillPath;
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
    // 명시 모델 핀. 설정된 축은 complexity 기반 resolver 를 덮는다.
    //   claudeModel — 런타임 강등 재시작(§3.4-3) 또는 사용자 지정 모델
    //   codexModel/codexEffort — 사용자 지정 codex 모델·reasoning effort
    // 전부 미설정이면 종전대로 complexity 티어 정책이 돈다.
    modelPin?: LaunchModelPin,
    // Optional MCP context. Quick Lane agents use lane:<id> for board isolation.
    marbloContextId?: string,
  ): LaunchConfig {
    const pinnedForChat =
      modelPin?.claudeModel ?? modelPin?.codexModel ?? modelPin?.nativeModel;
    const promptProfile = localProfileForPinnedModel(agent.model, pinnedForChat);
    // 로컬 소형: MCP+role-skill tool 강제가 JSON 흉내를 유발 → 대화모드.
    const chatOnly = promptProfile === "chat-only";

    const mcpConfigPath = this.generateMCPConfig(
      agent.id,
      agent.model,
      projectDir,
      marbloProjectId,
      marbloContextId,
      agent.role,
      promptProfile,
      modelPin?.codexModel ?? modelPin?.claudeModel ?? modelPin?.nativeModel,
    );
    // chat-only 는 역할 스킬(tool-use 루프)을 아예 주입하지 않는다.
    // lite 는 ★전문 대신 짧은 브리프로 대체한다 — 이 티어의 존재 이유가
    // "도구는 주되 긴 컨텍스트를 뺀다"이고, 역할 스킬 전문이 그 중 가장 큰
    // 덩어리다(26B 급 과부하 측정의 주 원인, 티켓 X8ZzPLey1Uk7uFm8q3bv).
    const liteProfile = promptProfile === "local-tool-use-lite";
    const skillPath =
      chatOnly || liteProfile
        ? ""
        : this.generateSkillFile(agent.id, agent.role, projectDir);
    const skillContent = liteProfile
      ? localLiteRoleBrief(agent.role)
      : skillPath && fs.existsSync(skillPath)
        ? fs.readFileSync(skillPath, "utf-8")
        : "";

    const {
      command,
      args,
      env,
      claudeSessionId,
      grokSessionId,
      modelResolution,
    } = this.buildCLICommand(
      agent.model,
      agent.command,
      mcpConfigPath,
      projectDir,
      marbloProjectId,
      agent.id,
      resumeSessionId,
      pinClaudeSession,
      complexity,
      modelPin,
      marbloContextId,
      chatOnly,
      promptProfile,
    );

    // ── Telegram 폴러 경합 차단 (에이전트 claude 세션) ─────────────────────
    // telegram 플러그인이 유저 전역(~/.claude/settings.json enabledPlugins)으로
    // 켜진 claude 세션은 텔레그램 MCP 폴러(bun server.ts, getUpdates)를 띄우는데,
    // 봇 토큰당 폴러는 단 1개만 허용되고(bot.pid PID락 + 409 Conflict) 플러그인은
    // 살아있는 기존 폴러도 무조건 SIGTERM 으로 뺏는다("replacing stale poller"
    // last-wins). 이런 세션은 --channels 없이 떠서 인바운드를 아무에게도 배달하지
    // 않으면서(claude 코어의 "channel notifications skipped" 경로) 업데이트를
    // 소비·유실만 하는 순수 도둑이다. #301(vw38IB2V) 이후 getUpdates 의 정당한
    // 단독 소유자는 electron main 의 telegram-poller.ts 이므로, Marblo 가 스폰하는
    // 어떤 claude 세션도 플러그인 폴러를 띄워선 안 된다.
    //
    // 현행 claude(2.1.214 실측)는 --strict-mcp-config 가 플러그인 MCP 서버까지
    // 차단해 에이전트 폴러 스폰이 이미 없지만, 그 시맨틱은 과거 한 번 바뀌며
    // 강탈 사고를 낸 전력이 있어(이 티켓의 발단) launch 인자 레벨에서 불변식을
    // 명시 고정한다(belt-and-braces). 부수 효과로 에이전트에 불필요한 telegram
    // 스킬 노출도 사라진다. --settings 인라인 override 는 enabledPlugins 를
    // deep-merge 하므로(실측: superpowers 스킬 14개 생존 + telegram 만 제거)
    // 다른 플러그인엔 무영향이고, 전역 MCP 서버(github/playwright/filesystem/
    // context7)는 애초에 per-agent --mcp-config 화이트리스트로 주입되는 별개
    // 경로라 영향 자체가 불가능하다. 플러그인 캐시(server.ts)를 건드리지 않으므로
    // 플러그인 업데이트에도 revert 되지 않는다. 티켓 pyp7odpPQ6emCWLmUrBz.
    //
    // local(env-swap) 도 같은 claude 바이너리라 워커 설정이 필요하다. chat-only
    // 는 `--bare`+`--tools ""` 대화모드라 스킵(이미 slash 비활성).
    const claudeFamily =
      agent.model === "claude" || agent.model === "local";
    if (claudeFamily && agent.role !== "orchestrator" && !chatOnly) {
      // ── 부트 프리픽스 다이어트 A2/A3 (워커 전용) ──────────────────────────
      // #900 §3.4 의 통제 가능 재고 중 MCP 툴 다음으로 큰 두 덩어리가 auto-memory
      // 인덱스와 스킬 목록 설명문이다. 워커는 티켓 하나만 처리하므로 전역 메모리
      // 인덱스와 90여 개 스킬 카탈로그가 사실상 무용한데도 매 요청 재전송된다.
      //
      // ★`--settings` 는 단일 값 옵션이다. 텔레그램 플러그인 차단
      //   (pyp7odpPQ6emCWLmUrBz)과 반드시 **한 객체로 머지**해야 한다 — 따로 붙이면
      //   마지막 하나만 살아남아 플러그인 폴러 강탈 방어가 조용히 풀린다.
      const settings = workerClaudeSettings(
        { enabledPlugins: { "telegram@claude-plugins-official": false } },
        agent.role,
      );
      args.push("--settings", JSON.stringify(settings));
      if (isLocalToolProfile(promptProfile) || shouldDisableWorkerSkills(agent.role)) {
        // 스킬 카탈로그(전체 SKILL.md frontmatter) 주입 제거. 워커의 역할 지식은
        // MCP `get_agent_skill` + 스폰 프롬프트로 오지 슬래시 커맨드로 오지 않는다.
        args.push("--disable-slash-commands");
      }
    }

    return {
      model: agent.model,
      command,
      args,
      env,
      mcpConfigPath,
      skillContent,
      initialPrompt,
      promptProfile,
      claudeSessionId,
      grokSessionId,
      modelResolution,
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
   * Grok stores at
   * `<GROK_HOME>/sessions/<encodeURIComponent(cwd)>/<session-uuid>/*.jsonl`.
   *
   * `cwd` narrows the grok answer to the directory `grok --continue` actually
   * looks in — it is cwd-scoped and dies outright on a directory with no
   * session ("No session found for current directory", live-verified). Omit it
   * and grok degrades to the codex/gemini fidelity: "this agent's home has SOME
   * session". Ignored by every other harness.
   */
  hasSavedSession(agentId: string, model: ModelType, cwd?: string): boolean {
    if (model === "grok") {
      const sessionsRoot = grokSessionsDir(agentId);
      // Match by DECODING each directory key rather than re-encoding `cwd`:
      // that survives any escaping difference and lets us also accept the
      // realpath (symlinked worktree roots resolve differently per caller).
      const wanted = cwd ? new Set([cwd]) : null;
      if (wanted && cwd) {
        try {
          wanted.add(fs.realpathSync(cwd));
        } catch {
          // cwd may not exist yet — the raw form is still a valid candidate.
        }
      }
      try {
        for (const entry of fs.readdirSync(sessionsRoot, {
          withFileTypes: true,
        })) {
          if (!entry.isDirectory()) continue;
          if (wanted) {
            let decoded: string;
            try {
              decoded = decodeURIComponent(entry.name);
            } catch {
              continue;
            }
            if (!wanted.has(decoded)) continue;
          }
          if (this.hasGrokSessionDir(path.join(sessionsRoot, entry.name))) {
            return true;
          }
        }
      } catch {
        // Missing/unreadable sessions root → no resumable session.
      }
      return false;
    }
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

  /**
   * True when `cwdDir` (a `<GROK_HOME>/sessions/<encoded-cwd>` directory) holds
   * at least one real session. A session is a UUID-named SUBdirectory with
   * transcript `.jsonl` files in it; the loose `prompt_history.jsonl` grok
   * writes directly under the cwd key is NOT one, so a bare
   * "any .jsonl below" test would greenlight `--continue` on a directory that
   * has no resumable session and make grok exit.
   */
  private hasGrokSessionDir(cwdDir: string): boolean {
    try {
      for (const entry of fs.readdirSync(cwdDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (this.hasAnyFileBelow(path.join(cwdDir, entry.name), ".jsonl")) {
          return true;
        }
      }
    } catch {
      // Unreadable → treat as no session.
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
    // grok 크레덴셜 사본 감시를 먼저 놓는다 — 파일이 지워지는 것을 "refresh 됨"
    // 으로 오해할 여지를 없앤다(브로커는 삭제를 전파하지 않지만, 죽은 에이전트를
    // 계속 폴링할 이유도 없다).
    grokAuthBroker.release(agentId);
    const bridge = this.codexChatBridges.get(agentId);
    if (bridge) {
      this.codexChatBridges.delete(agentId);
      void bridge.stop().catch(() => {
        /* ignore */
      });
    }
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
    for (const [agentId, bridge] of this.codexChatBridges) {
      this.codexChatBridges.delete(agentId);
      void bridge.stop().catch(() => {
        /* ignore */
      });
    }
  }

  // --- Private: Model-specific config generators ---

  private generateClaudeConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
    role?: string,
  ): string {
    // strict 경로 전제: 글로벌 머지가 차단되므로, 이 역할이 실제 쓰는 글로벌
    // 서버를 여기에 명시 포함해야 기능이 보존된다(화이트리스트). marblo 는 항상
    // per-agent env 가 박힌 채로 마지막에 주입돼 동일 키가 있어도 우리 것이 이긴다.
    const whitelisted = selectWhitelistedGlobalServers(role ?? "");
    const config = {
      mcpServers: {
        ...whitelisted,
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
    // ★ MCP 통합. agy 의 현재 공유 MCP 설정 경로:
    //     ~/.gemini/config/mcp_config.json
    //   구버전 agy CLI 호환을 위해 기존 전용 경로도 함께 머지한다:
    //     ~/.gemini/antigravity-cli/mcp_config.json
    //   각 파일의 다른 MCP 서버 항목은 그대로 보존.
    //   per-agent 변수 (MARBLO_AGENT_ID/PROJECT/BRIDGE_PORT/PATH) 는 spawn
    //   시점의 resolved env 를 literal 로 박는다. agy 의 MCP child 는 항상
    //   PTY parent env 를 상속/치환하지 않으므로 ${VAR} placeholder 를 쓰면
    //   claim_task 처럼 인자만 쓰는 도구는 동작해도 add_activity 처럼 env
    //   귀속/notify 에 의존하는 도구가 조용히 깨질 수 있다.
    //
    //   제약: 단일 Marblo 인스턴스 가정. 여러 Marblo 윈도우가 같은 글로벌
    //   파일에 동시 write 하면 마지막 writer 가 이김 (단, marblo entry 자체는
    //   거의 idempotent 라 실제 충돌은 드묾). 다중 인스턴스 격리는 별도 트랙.
    const agyConfigHome = getAntigravityConfigHome();
    const globalConfigPaths = ANTIGRAVITY_MCP_CONFIG_RELATIVE_PATHS.map(
      (parts) => path.join(agyConfigHome, ...parts),
    );

    // agy launches MCP servers from this shared global config. Older code used
    // "${VAR}" placeholders for per-agent values, assuming agy would substitute
    // the PTY env when it spawned the MCP child. In practice agy can launch the
    // child from an isolated environment, so placeholders reach the MCP server
    // literally; tools that depend on MARBLO_AGENT_ID/PROJECT/BRIDGE_PORT then
    // fail or become unattributable while argument-only tools still appear to
    // work. Write the resolved spawn-time env instead.
    const marbloEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(mcpEntry.env || {})) {
      marbloEnv[key] = value;
    }

    const mergeResults: Array<{
      globalConfigPath: string;
      mergeFailed: boolean;
      existingServerKeys: string[];
    }> = [];

    for (const globalConfigPath of globalConfigPaths) {
      fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
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
        // 사용자의 손상된 JSON 을 함부로 덮어쓰지 않는다. 다른 config path 는
        // 계속 시도하되, sentinel 에 실패 경로를 남겨 디버그 가능하게 한다.
        console.warn(
          `[agy] ${globalConfigPath} parse failed (${errorMessage(
            parseError,
          )}); leaving file untouched, MCP disabled for this path.`,
        );
        mergeResults.push({
          globalConfigPath,
          mergeFailed: true,
          existingServerKeys: [],
        });
        continue;
      }

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
      const existingServerKeys = Object.keys(existingServers).sort();
      try {
        fs.writeFileSync(
          globalConfigPath,
          JSON.stringify(merged, null, 2),
          "utf-8",
        );
        mergeResults.push({
          globalConfigPath,
          mergeFailed: false,
          existingServerKeys,
        });
        console.info("[agy] merged Marblo MCP config", {
          globalConfigPath,
          command: mcpEntry.command,
          args: mcpEntry.args,
          env: maskEnvForLogging(marbloEnv),
          envKeys: Object.keys(marbloEnv).sort(),
          hasAgentId: !!marbloEnv.MARBLO_AGENT_ID,
          hasProject: !!marbloEnv.MARBLO_PROJECT,
          hasBridgePort: !!marbloEnv.MARBLO_BRIDGE_PORT,
          hasContext: !!marbloEnv.MARBLO_CONTEXT,
          existingServerKeys,
        });
      } catch (err) {
        console.warn(
          `[agy] ${globalConfigPath} write failed (${err}); MCP disabled for this path.`,
        );
        mergeResults.push({
          globalConfigPath,
          mergeFailed: true,
          existingServerKeys,
        });
      }
    }
    // NOTE: do NOT trackFile() global config paths — they're user-shared.
    // cleanup() would clobber other agents' / other MCP servers' state.

    // 우리 CONFIG_DIR 의 sentinel 만 트래킹 → cleanup contract 만족.
    // sentinel 에 globalConfigPaths 를 기록해서 디버그 시 어디로 머지했는지
    // 추적 가능.
    const sentinelDir = path.join(CONFIG_DIR, `antigravity-home-${agentId}`);
    fs.mkdirSync(sentinelDir, { recursive: true });
    const sentinelPath = path.join(sentinelDir, "marblo-sentinel.json");
    fs.writeFileSync(
      sentinelPath,
      JSON.stringify(
        {
          agentId,
          globalConfigPath: globalConfigPaths[0],
          globalConfigPaths,
          mergeFailed: mergeResults.every((result) => result.mergeFailed),
          mergeResults,
          marbloServer: {
            command: mcpEntry.command,
            args: mcpEntry.args,
            env: maskEnvForLogging(marbloEnv),
            envKeys: Object.keys(marbloEnv).sort(),
            hasAgentId: !!marbloEnv.MARBLO_AGENT_ID,
            hasProject: !!marbloEnv.MARBLO_PROJECT,
            hasBridgePort: !!marbloEnv.MARBLO_BRIDGE_PORT,
            hasContext: !!marbloEnv.MARBLO_CONTEXT,
          },
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
    pinnedModelId?: string,
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
    // authenticated — except for OpenAI-compat env-swap vendors (Upstage /
    // DeepSeek), where we force model_providers + apikey auth so a ChatGPT
    // login cannot hijack the request (solar-pro4 400).
    const codexHome = path.join(CONFIG_DIR, `codex-home-${agentId}`);
    fs.mkdirSync(codexHome, { recursive: true });

    const vendorOverride =
      resolveCodexVendorProviderOverride(pinnedModelId) ?? null;

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
        //  - model_provider / [model_providers.*] when we inject a vendor
        //    override (avoid duplicate keys / ChatGPT provider winning).
        preserved = raw
          .replace(/\[mcp_servers\.[\s\S]*?(?=\n\[(?!mcp_servers)|$)/g, "")
          .replace(/\[features\][\s\S]*?(?=\n\[|$)/g, "")
          .replace(/\[projects\.[\s\S]*?(?=\n\[(?!projects)|$)/g, "")
          .trimEnd();
        if (vendorOverride) {
          preserved = preserved
            .replace(/^\s*model_provider\s*=\s*.*$/gm, "")
            // 우리가 벤더 카탈로그를 주입하므로 사용자 값은 반드시 걷어낸다 —
            // TOML 은 최상위 키 중복을 파싱 에러로 처리한다(= 에이전트 즉사).
            .replace(/^\s*model_catalog_json\s*=\s*.*$/gm, "")
            .replace(
              /\[model_providers\.[\s\S]*?(?=\n\[(?!model_providers)|$)/g,
              "",
            )
            .replace(/^\s*preferred_auth_method\s*=\s*.*$/gm, "")
            .replace(/^\s*forced_login_method\s*=\s*.*$/gm, "")
            .trimEnd();
        }
      } catch {
        // Best-effort — ignore unreadable user config.
      }
    }

    // Symlink auth.json so Codex inherits the user's authentication.
    // Vendor override: skip ChatGPT auth.json so API-key + model_provider win.
    const userAuth = path.join(userCodexDir, "auth.json");
    const targetAuth = path.join(codexHome, "auth.json");
    if (
      !vendorOverride &&
      fs.existsSync(userAuth) &&
      !fs.existsSync(targetAuth)
    ) {
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
    if (vendorOverride && fs.existsSync(targetAuth)) {
      try {
        fs.unlinkSync(targetAuth);
      } catch {
        /* ignore */
      }
    }

    const fallbackCommand = this.generateCodexFallbackWrapper(
      agentId,
      codexHome,
      mcpEntry,
    );
    this.generateCodexTfPrompts(
      agentId,
      codexHome,
      projectDir,
      fallbackCommand,
    );

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
      for (const candidate of [projectDir, safeRealpath(projectDir)]) {
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

    // ★codex 가 모르는 벤더 slug 는 폴백 메타데이터로 떨어지고, 그 폴백에는
    //   apply_patch 가 등록되지 않는다(프롬프트는 계속 그 도구를 안내한다) →
    //   `unsupported call: apply_patch` 로 편집이 통째로 실패한다. 벤더 모델의
    //   ModelInfo 를 직접 선언해 그 경로를 막는다. 이 카탈로그는 내장 카탈로그를
    //   **대체**하므로 벤더 오버라이드 에이전트에만 쓴다 — openai gpt 에이전트의
    //   config 에는 이 키가 아예 들어가지 않는다(무회귀).
    let modelCatalogPath: string | undefined;
    if (vendorOverride) {
      const catalog = buildCodexModelCatalog(pinnedModelId);
      if (catalog) {
        modelCatalogPath = path.join(codexHome, "model-catalog.json");
        fs.writeFileSync(
          modelCatalogPath,
          renderCodexModelCatalogJson(catalog),
          "utf-8",
        );
        this.trackFile(agentId, modelCatalogPath);
      } else {
        // ★조용히 넘기지 않는다. 카탈로그 없이 뜬 벤더 에이전트는 apply_patch 가
        //   등록되지 않아 "진단은 맞는데 파일을 안 고치는" 그 증상으로 되돌아간다.
        //   그렇다고 스폰을 막으면 오늘보다 나빠지므로, 사유를 크게 남기고 뜬다.
        console.error(
          "[agent-config] Codex vendor model catalog unavailable — " +
            "apply_patch will NOT be registered for this agent",
          {
            agentId,
            model: pinnedModelId,
            provider: vendorOverride.providerId,
            reason:
              "could not read a reference ModelInfo from the installed codex " +
              "(~/.codex/models_cache.json or the codex binary catalog)",
          },
        );
      }
    }

    const vendorProviderToml = vendorOverride
      ? this.buildCodexVendorProviderToml(
          agentId,
          vendorOverride,
          modelCatalogPath,
        )
      : "";

    // Vendor override MUST come before preserved user tables. A trailing
    // `[tui.model_availability_nux]` (map of model→u32) would otherwise absorb
    // top-level `model_provider = "..."` as a map entry and fail parse
    // (`expected u32`, got `"upstage"`).
    const tomlSections = [
      vendorProviderToml.trimEnd(),
      "",
      preserved,
      "",
      ...trustEntries,
      "[mcp_servers.marblo]",
      `command = ${JSON.stringify(mcpEntry.command)}`,
      `args = ${JSON.stringify(mcpEntry.args)}`,
      "tool_timeout_sec = 60",
      // Defense-in-depth: Codex 의 MCP startup timeout 기본값(~10s)은 marblo MCP
      // 서버가 Firebase 인증 지연(최대 ~10s)을 겪는 경우 경계에 걸린다. 서버가
      // 이제 인증 전에 핸드셰이크를 응답하므로 여유는 충분하나, 콜드 스타트/느린
      // 디스크에서도 Codex 가 서버를 실패 처리하지 않도록 startup 여유를 넓힌다.
      "startup_timeout_sec = 30",
    ];
    if (envEntries) {
      tomlSections.push("", "[mcp_servers.marblo.env]", envEntries);
    }
    const toml = tomlSections.filter((s) => s !== undefined).join("\n") + "\n";

    const configPath = path.join(codexHome, "config.toml");
    fs.writeFileSync(configPath, toml, "utf-8");
    this.trackFile(agentId, configPath);
    if (!vendorOverride) {
      this.trackFile(agentId, targetAuth);
    }
    // Return the file path; buildCLICommand derives CODEX_HOME from dirname.
    return configPath;
  }

  /**
   * Start a Codex chat bridge only for vendors that still need it, then render
   * [model_providers.*] TOML.
   */
  private buildCodexVendorProviderToml(
    agentId: string,
    override: CodexVendorProviderOverride,
    modelCatalogPath?: string,
  ): string {
    let baseUrl = override.upstreamBaseUrl;
    const skipBridge =
      process.env.VITEST === "true" ||
      process.env.MARBLO_CODEX_SKIP_CHAT_BRIDGE === "1";
    if (override.needsChatBridge && !skipBridge) {
      const prev = this.codexChatBridges.get(agentId);
      if (prev) {
        void prev.stop().catch(() => {
          /* ignore */
        });
        this.codexChatBridges.delete(agentId);
      }
      const secret =
        process.env[override.envKey]?.trim() ||
        getVendorSecret(override.envKey);
      // ★폴백 금지. 브리지가 필수인 벤더에서 기동에 실패하면 upstream 으로
      //   조용히 물러서면 안 된다 — 그러면 wire_api="responses" 가 upstream 의
      //   존재하지 않는 /v1/responses 를 때려 `404 page not found` 가 나고,
      //   진짜 실패 지점(브리지 기동 실패)이 완전히 가려진다. 실제로 이 폴백이
      //   #1037 을 "브리지가 404 를 유발한다"는 잘못된 진단으로 몰아갔다.
      //   못 뜨면 여기서 사유 그대로 스폰을 중단한다.
      if (!secret) {
        throw new Error(
          `Codex chat bridge for ${override.providerId} cannot start: ` +
            `missing API key env ${override.envKey}. ` +
            `${override.providerId} exposes only /v1/chat/completions, so the ` +
            `local Responses→Chat bridge is mandatory — set ${override.envKey} ` +
            `and respawn.`,
        );
      }
      try {
        const bridge = startCodexChatBridgeSync({
          upstreamBaseUrl: override.upstreamBaseUrl,
          apiKey: secret,
        });
        this.codexChatBridges.set(agentId, bridge);
        baseUrl = bridge.baseUrl;
        console.log("[agent-config] Codex chat bridge started", {
          agentId,
          provider: override.providerId,
          port: bridge.port,
          baseUrl: bridge.baseUrl,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("[agent-config] Codex chat bridge failed to start", {
          agentId,
          provider: override.providerId,
          error: reason,
        });
        throw new Error(
          `Codex chat bridge for ${override.providerId} failed to start: ` +
            `${reason}. Refusing to fall back to ${override.upstreamBaseUrl} — ` +
            `that upstream has no /v1/responses and would only produce a ` +
            `misleading 404.`,
        );
      }
    }
    return renderCodexVendorProviderToml(override, baseUrl, modelCatalogPath);
  }

  // ★projectDir 를 받는다. grok 의 **폴더 신뢰**가 프로젝트 경로에 의존하기
  // 때문이다 — writeGrokHomeFiles 주석 참조. (config.toml 의 MCP 엔트리 자체는
  // 여전히 경로 무관하다.)
  private generateGrokConfig(
    agentId: string,
    mcpEntry: MCPServerEntry,
    projectDir?: string,
  ): string {
    // Grok Build reads TOML config from $GROK_HOME/config.toml or
    // ~/.grok/config.toml. Each worker gets an isolated config so Marblo MCP
    // env is per-agent, while non-MCP user settings are preserved.
    const grokHome = path.join(CONFIG_DIR, `grok-home-${agentId}`);
    fs.mkdirSync(grokHome, { recursive: true });

    this.propagateGrokAuthAssets(agentId, grokHome);

    const { configPath, written } = writeGrokHomeFiles(
      grokHome,
      mcpEntry,
      projectDir,
    );
    for (const file of written) {
      this.trackFile(agentId, file);
    }
    return configPath;
  }

  // ★심링크 금지 (2026-08-10, grok 로그 실측으로 확정된 근본원인)
  //
  //   종전 구현은 격리홈의 auth.json 을 사용자 ~/.grok/auth.json 로 **심링크**해
  //   "refresh 가 자동으로 공유된다"고 기대했다. 실제로는 그 반대였다 — grok 은
  //   심링크를 realpath 로 풀어 사용자 실파일을 잠그고 쓰고, refresh 가 영구실패
  //   하면 **그 실파일을 지운다**:
  //
  //     resolved_path=~/.grok/auth.json      ← 격리홈인데 실파일로 해석
  //     oidc try_refresh_pure terminal error :: invalid_grant
  //     auth: cleared credentials ... disk_mutation="file deleted (no scopes left)"
  //     auth disk state: entry lost :: Ok → FileMissing
  //
  //   즉 **에이전트 하나의 refresh 실패가 머신 전체 로그인을 삭제**했다(2주간 6회
  //   실측). 그래서 grok 이 반복적으로 미인증으로 빠졌다.
  //
  //   지금은 사설 **복사본**을 깐다. 에이전트가 자기 사본을 지워도 사용자 로그인은
  //   무사하다. 대신 grok 이 refresh 에 성공하면 GrokAuthBroker 가 그 갱신본을
  //   사용자 파일로 되돌려 발행한다(문서 `## Hot Reload` 가 보증하는 계약) — 그래서
  //   회전형 refresh token 도 공유 크레덴셜을 최신으로 유지한다.
  private propagateGrokAuthAssets(agentId: string, grokHome: string): void {
    // If xAI API-key auth is already present, let the CLI use that path. When
    // both mechanisms exist, env auth is explicit for this process and avoids
    // coupling the isolated home to browser-login state.
    //
    // ★XAI_API_KEY 는 종량제 API 키지 SuperGrok 구독 브라우저 인증이 아니다 —
    //   구독 사용자에겐 이 분기가 타지지 않는 것이 정상이다.
    if (process.env.XAI_API_KEY?.trim()) return;

    // 브로커가 검증(파싱·스코프·토큰 존재)·복사·감시를 모두 맡는다. 원본이 없거나
    // 못 쓸 모양이면 아무것도 깔지 않고 grok 이 자기 로그인 flow 로 떨어진다 —
    // 깨진 토큰을 물려주는 것보다 낫다.
    const sourceAuth = path.join(os.homedir(), ".grok", "auth.json");
    const targetAuth = path.join(grokHome, "auth.json");
    try {
      grokAuthBroker.install(agentId, grokHome, sourceAuth);
      this.trackFile(agentId, targetAuth);
    } catch {
      // Fail-safe: auth propagation must never prevent Grok from launching.
    }
  }

  private generateCodexTfPrompts(
    agentId: string,
    codexHome: string,
    projectDir: string,
    fallbackCommand: string,
  ): void {
    const promptDir = path.join(codexHome, "prompts");
    const skills = discoverTfSkillDirs(projectDir);
    const allSkills = new Map(skills.map((skill) => [skill.name, skill]));
    for (const name of ["tf-add", "tf-start", "tf-status"]) {
      if (!allSkills.has(name)) {
        allSkills.set(name, { name, skillPath: "" });
      }
    }

    fs.mkdirSync(promptDir, { recursive: true });
    for (const skill of Array.from(allSkills.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      let raw = "";
      if (skill.skillPath) {
        try {
          raw = fs.readFileSync(skill.skillPath, "utf-8");
        } catch {
          raw = "";
        }
      }

      const description =
        frontmatterValue(raw, "description") ||
        `Run the Marblo /${skill.name} workflow`;
      const argumentHint = frontmatterValue(raw, "argument-hint");
      const body = stripFrontmatter(raw);
      const prompt =
        this.codexTfPromptOverride(skill.name, description, fallbackCommand) ??
        [
          "---",
          `description: ${yamlString(description)}`,
          ...(argumentHint
            ? [`argument-hint: ${yamlString(argumentHint)}`]
            : []),
          "---",
          "",
          `You are executing the Marblo /${skill.name} workflow inside Codex CLI.`,
          "Follow the workflow below exactly. Use Marblo MCP tools for task, agent, and activity operations.",
          "If the workflow mentions Claude-specific slash command mechanics, interpret the included instructions directly in Codex.",
          "If Marblo MCP tools are not visible, do not grep source. Use the fallback CLI shown in the boot health summary.",
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

  private generateCodexFallbackWrapper(
    agentId: string,
    codexHome: string,
    mcpEntry: MCPServerEntry,
  ): string {
    const binDir = path.join(codexHome, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const fallbackPath = path.join(
      path.dirname(getMCPServerPath()),
      "cli-fallback.js",
    );
    const isWindows = os.platform() === "win32";
    const wrapperPath = path.join(
      binDir,
      isWindows ? "marblo-fallback.cmd" : "marblo-fallback",
    );

    if (isWindows) {
      const envLines = Object.entries(mcpEntry.env ?? {}).map(
        ([key, value]) => `set "${key}=${value}"`,
      );
      const content = [
        "@echo off",
        ...envLines,
        `"${mcpEntry.command}" "${fallbackPath}" %*`,
        "",
      ].join("\r\n");
      fs.writeFileSync(wrapperPath, content, "utf-8");
    } else {
      const envLines = Object.entries(mcpEntry.env ?? {}).map(
        ([key, value]) => `export ${key}=${shellQuote(value)}`,
      );
      const content = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        ...envLines,
        `exec ${shellQuote(mcpEntry.command)} ${shellQuote(fallbackPath)} "$@"`,
        "",
      ].join("\n");
      fs.writeFileSync(wrapperPath, content, "utf-8");
      try {
        fs.chmodSync(wrapperPath, 0o700);
      } catch {
        // Best-effort; Codex can still run it via bash <path> if chmod fails.
      }
    }

    this.trackFile(agentId, wrapperPath);
    return wrapperPath;
  }

  private codexTfPromptOverride(
    name: string,
    description: string,
    fallbackCommand: string,
  ): string | null {
    const requiredTools = CODEX_ORCH_REQUIRED_MCP_TOOLS.join(", ");
    const common = [
      "---",
      `description: ${yamlString(description)}`,
      'argument-hint: "task request / plan / filters"',
      "---",
      "",
      `# Marblo /${name} for Codex`,
      "",
      "Use Marblo MCP tools directly. Required Marblo tools:",
      requiredTools,
      "",
      "If those tools are not visible, do not inspect source files to reconstruct behavior.",
      `Use this fallback CLI instead: ${fallbackCommand}`,
      "Pass JSON payloads with a here-doc so shell quoting stays safe.",
      "",
      "User arguments:",
      "$ARGUMENTS",
      "",
    ];

    if (name === "tf-add") {
      return [
        ...common,
        "Workflow:",
        "1. Convert the user arguments into one structured task.",
        "2. Call create_task with title, goal or description, role, priority, acceptance, changes, notes, scope, and project_id only when needed.",
        "3. Report the created task id.",
        '4. If the user explicitly asks to spawn/dispatch an agent, call dispatch_task with that task_id. If they ask for Codex, pass model="codex".',
        "",
        "Fallback equivalents:",
        `${fallbackCommand} create-task --json '<task-json>'`,
        `${fallbackCommand} dispatch-task --json '<dispatch-json>'`,
        "",
      ].join("\n");
    }

    if (name === "tf-start") {
      return [
        ...common,
        "Workflow:",
        "1. Convert the accepted plan or PRD into a single create_tasks_bulk call. Do not create tasks one by one unless bulk creation fails validation.",
        "2. Use aliases or returned task ids to dispatch ready tasks with dispatch_task.",
        '3. Prefer complexity="standard" unless the task is clearly simple or complex. complexity="simple" still creates a physical board-tracked agent on the cheap tier; use use_logical=true only for explicit internal handling. If the user specifies Codex, pass model="codex".',
        "4. Summarize task ids and dispatch results.",
        "",
        "Fallback equivalents:",
        "Bulk creation requires MCP. If MCP is missing, create each validated task with:",
        `${fallbackCommand} create-task --json '<task-json>'`,
        "Then dispatch each created id with:",
        `${fallbackCommand} dispatch-task --json '<dispatch-json>'`,
        "",
      ].join("\n");
    }

    if (name === "tf-status") {
      return [
        ...common,
        "Workflow:",
        "1. Call get_all_tasks, filtered by project/role only if the user asked.",
        "2. Summarize counts by status plus active blockers and recently claimed/in-progress work.",
        "3. Keep the answer concise and avoid dumping completed-task tails unless asked.",
        "",
        "Fallback note:",
        "The fallback CLI intentionally does not reimplement status reads. If MCP is missing, print the boot health diagnostic and ask the user to reconnect Marblo MCP.",
        "",
      ].join("\n");
    }

    return null;
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
    modelPin?: LaunchModelPin,
    marbloContextId?: string,
    /** 로컬 소형: `--tools ""` + bare system (MCP/툴 스키마 비주입). */
    chatOnly = false,
    promptProfile: AgentPromptProfile = "full",
  ): {
    command: string;
    args: string[];
    env: Record<string, string>;
    claudeSessionId?: string;
    grokSessionId?: string;
    modelResolution?: TopModelResolution;
  } {
    const env = getMCPServerEnv(
      projectDir,
      marbloProjectId,
      agentId,
      marbloContextId,
      undefined,
      promptProfile,
    );
    // Normalize resume signals: "new" means force-fresh, "latest" means
    // "pick the most recent" (CLI-specific syntax), anything else is a
    // concrete session id.
    const wantResume = resumeSessionId && resumeSessionId !== "new";
    const resumeIsLatest = resumeSessionId === "latest";

    // NOTE: Initial prompts are NOT passed via CLI flags (e.g. -p) because
    // that runs non-interactively and exits. Instead, prompts are sent via
    // stdin after the CLI starts, keeping the session interactive.
    //
    // ★스폰할 **바이너리**는 하네스 축이 고른다(축분리 USbdRV4k). 벤더는 이
    // switch 를 늘리지 않고 각 분기의 env 로만 갈린다(applyVendorEnv) — 그래야
    // GLM 같은 env-swap 벤더가 `case "zai"` 를 요구하지 않는다(서베이 §4.5.1).
    // 오늘 모든 레지스트리 행이 harness === ModelType 이라 값은 종전과 동일하다.
    const pinnedModelId =
      modelPin?.claudeModel ?? modelPin?.codexModel ?? modelPin?.nativeModel;
    const harness = harnessForLaunch(model, pinnedModelId);
    switch (harness) {
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
        // 결정 우선순위:
        //   1) modelPin.claudeModel — 명시 지정. 두 출처가 이 레일을 공유한다:
        //      런타임 강등 재시작(fable5 실패 → opus, §3.4-3)과 사용자/오케의
        //      모델 지정(dispatch model='opus5', 오케 셀렉터). 둘 다 이미
        //      resolveClaudeModelPinned 의 버전가드를 통과한 값이다.
        //   2) complex → resolveTopClaudeModelDetailed() (env/버전가드/폴백 + 메타)
        //   3) 그 외(simple/standard/미지정) → modelTierForComplexity 리터럴
        let claudeModel: string | undefined;
        let modelResolution: TopModelResolution | undefined;
        if (model === "local" && modelPin?.nativeModel) {
          claudeModel = modelPin.nativeModel;
        } else if (modelPin?.claudeModel) {
          claudeModel = modelPin.claudeModel;
        } else if (complexity === "complex") {
          modelResolution = resolveTopClaudeModelDetailed();
          claudeModel = modelResolution.model;
        } else {
          claudeModel = modelTierForComplexity(harness, complexity).claudeModel;
        }
        // ★foreign command 불신(grok 분기와 같은 규율). `baseCommand` 는 Firestore
        // 에이전트 doc 의 값이라 **다른 하네스의 바이너리**가 실려 올 수 있다:
        // 모델을 바꾼 에이전트의 stale doc(command:"grok"/"codex"), 그리고
        // env-swap 벤더 핀이 `harnessForLaunch` 로 이 분기에 접혀 들어온 경우가
        // 그렇다(하네스는 핀을 따르지만 command 는 doc 값 그대로다). claude argv 는
        // `--dangerously-skip-permissions`/`--model` 을 싣고 있어 남의 바이너리에
        // 넘어가면 즉사한다("unknown option ..." — grok 이 실제로 겪은 3번째 버그).
        // 진짜 claude 커맨드 이름(또는 그 절대경로)만 존중하고, 나머지는 해석된
        // claude 바이너리로 떨어뜨린다. 오케/워커가 넘기는 "claude" 는 종전 그대로다.
        const claudeCommand = isHarnessCommandName(baseCommand, "claude")
          ? baseCommand
          : resolveClaudeBinary().command;
        if (baseCommand && !isHarnessCommandName(baseCommand, "claude")) {
          console.warn("[agent-config] claude 분기의 낯선 command 무시", {
            baseCommand,
            pinnedModel: pinnedModelId ?? null,
            using: claudeCommand,
          });
        }
        return {
          // On Windows node-pty does NOT resolve a bare command via PATH/PATHEXT
          // (it throws "File not found"), so the orchestrator's literal "claude"
          // baseCommand can't be spawned. Use the resolved absolute path (claude.exe)
          // there. POSIX is unchanged: bare "claude" baseCommand spawns as before.
          command:
            os.platform() === "win32"
              ? resolveClaudeBinary().command
              : claudeCommand,
          args: [
            "--dangerously-skip-permissions",
            ...(claudeModel ? ["--model", claudeModel] : []),
            // --strict-mcp-config: 글로벌 ~/.claude.json MCP 머지를 차단한다.
            // 이게 없으면 에이전트마다 안 쓰는 글로벌 서버 6종이 중복 스폰돼
            // 플릿 RAM ~7-16GB 낭비(특히 context7 은 npx 더블스폰). per-agent
            // config(generateClaudeConfig)가 역할별 화이트리스트로 필요한 서버를
            // 명시 포함하므로 기능 손실 0. 반드시 화이트리스트와 세트로 동작.
            "--strict-mcp-config",
            "--mcp-config",
            mcpConfigPath,
            // 로컬 소형 chat-only: 내장/MCP 툴 스키마를 API 에 실지 않는다.
            // 실측(qwen2.5:0.5b): 툴 주입 시 tool_use JSON 흉내, `--tools ""` 면
            // text 응답으로 회복.
            ...(chatOnly ? localChatOnlyClaudeArgExtras() : []),
            ...sessionArgs,
          ],
          // 벤더 프로파일 주입 자리. 오늘은 프로파일을 가진 행이 없어 `env` 가
          // 그대로(참조까지 동일) 나간다 — 기존 Anthropic 스폰 무오염.
          env:
            model === "local"
              ? {
                  ...applyVendorEnv(env, claudeModel),
                  ...LOCAL_OLLAMA_ENV_PROFILE,
                }
              : applyVendorEnv(env, claudeModel),
          claudeSessionId: sessionId,
          modelResolution,
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
        const geminiCommand =
          os.platform() === "win32" &&
          (!baseCommand || baseCommand === "gemini")
            ? resolveHarnessCli("gemini").command
            : baseCommand || "gemini";
        const geminiLaunch = ptyCommandForCli(geminiCommand, geminiArgs);
        return {
          command: geminiLaunch.command,
          args: geminiLaunch.args,
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
        // 모델 핀(-c model=…). 명시 지정이 있을 때만 붙는다 — 없으면 종전대로
        // 사용자 CODEX_HOME config.toml 의 모델을 그대로 쓴다(현행 동작 0 변화).
        // Codex 는 모델 × effort 곱집합이라 두 축이 따로 붙는다(레지스트리 §2).
        if (modelPin?.codexModel) {
          codexArgs.push("-c", `model="${modelPin.codexModel}"`);
        }
        // reasoning effort 우선순위: 명시 지정 > complexity 파생(complex→high,
        // standard→medium, simple→low) > 미지정(CLI 기본값 유지).
        const codexReasoning =
          modelPin?.codexEffort ??
          modelTierForComplexity(harness, complexity).codexReasoning;
        if (codexReasoning) {
          codexArgs.push("-c", `model_reasoning_effort="${codexReasoning}"`);
        }
        // OpenAI-compat env-swap (Upstage/DeepSeek): force model_provider so a
        // ChatGPT login cannot ignore OPENAI_BASE_URL (solar-pro4 400).
        const codexVendorOverride = resolveCodexVendorProviderOverride(
          modelPin?.codexModel,
        );
        if (codexVendorOverride) {
          codexArgs.push(
            "-c",
            `model_provider="${codexVendorOverride.providerId}"`,
          );
        }
        // Reject `baseCommand === "gpt"` — that's the model slug accidentally
        // saved to the Firestore agent doc by older builds of Layout.tsx, and
        // it shadows macOS's /usr/sbin/gpt (GUID Partition Table utility)
        // which exits with "gpt: illegal option -- c" on our flag set. The
        // user's intent is the Codex CLI; honor that even with stale docs.
        const codexCommand =
          os.platform() === "win32" &&
          (!baseCommand || baseCommand === "gpt" || baseCommand === "codex")
            ? resolveHarnessCli("gpt").command
            : !baseCommand || baseCommand === "gpt"
              ? "codex"
              : baseCommand;
        const codexLaunch = ptyCommandForCli(codexCommand, codexArgs);
        let codexEnv = applyVendorEnv(
          { ...env, CODEX_HOME: path.dirname(mcpConfigPath) },
          modelPin?.codexModel,
        );
        if (codexVendorOverride) {
          codexEnv = injectCodexVendorEnvKey(codexEnv, codexVendorOverride);
        }
        return {
          command: codexLaunch.command,
          args: codexLaunch.args,
          // 벤더 프로파일 주입 자리(claude 분기와 동일 규율). CODEX_HOME 은 보호
          // 키라 프로파일이 덮어쓸 수 없다 — 덮이면 MCP 배선이 통째로 날아간다.
          env: codexEnv,
        };
      }

      case "grok": {
        // Grok Build TUI. First launch opens the user's browser for auth
        // (SuperGrok/X account); Marblo only supplies per-agent MCP config via
        // GROK_HOME.
        //
        // `grok --help` (0.2.112) exposes `--permission-mode` values including
        // `bypassPermissions`; that is the native unattended equivalent for
        // tool approvals. `--dangerously-skip-permissions` is Claude-specific,
        // and `--always-approve` is narrower than the permission-mode contract.
        //
        // Keep the model pin in argv, not config.toml: it gives the PTY/badge
        // path an observable launched model while still letting nativeModel
        // override the default.
        //
        // `grok --help` / ~/.grok/docs (0.2.112 live check) define --minimal
        // as scrollback-native rendering: completed blocks are printed into
        // the terminal's native scrollback while the prompt stays pinned. This
        // avoids the alt-screen fullscreen TUI swallowing completed
        // orchestrator/agent dialogue from Marblo's xterm scrollback.
        //
        // Resume (see grokSessionArgs for the live-verified flag contract):
        //   fresh                → --session-id <새 UUID>  (id 를 우리가 못박고
        //                          grokSessionId 로 돌려준다)
        //   resume concrete UUID → --resume <uuid>
        //   resume 'latest'      → --continue (cwd 최근 세션)
        // grok 은 이 배선이 붙기 전까지 resumeSessionId 를 통째로 무시했다 —
        // 다섯 하네스 중 유일하게 매 스폰이 fresh 였다.
        const grokArgs: string[] = [
          "--minimal",
          "--permission-mode",
          "bypassPermissions",
        ];
        const { args: grokSessionFlags, sessionId: grokSessionId } =
          grokSessionArgs(resumeSessionId, crypto.randomUUID());
        grokArgs.push(...grokSessionFlags);
        const grokModel = modelPin?.nativeModel;
        grokArgs.push("-m", grokModel || GROK_DEFAULT_MODEL);
        const resolvedGrokCommand = resolveHarnessCli("grok").command;
        // Stale Firestore docs have carried command:"claude" or
        // command:"grok-4.5" while model/harness is grok. Grok argv includes
        // `-m`, so honoring those stale commands routes Grok flags into the
        // wrong binary (Claude) or an ENOENT model slug. Only a real grok
        // binary name/path is accepted; everything else falls back to the
        // resolved Grok CLI.
        const grokCommand =
          baseCommand && isHarnessCommandName(baseCommand, "grok")
            ? path.isAbsolute(baseCommand)
              ? baseCommand
              : resolvedGrokCommand
            : resolvedGrokCommand;
        const grokLaunch = ptyCommandForCli(grokCommand, grokArgs);
        return {
          command: grokLaunch.command,
          args: grokLaunch.args,
          // ★불변식: fresh 와 resume 이 같은 GROK_HOME(= grokSessionsDir 과 같은
          //   에이전트별 홈)을 봐야 세션 파일이 보인다. mcpConfigPath 는
          //   generateGrokConfig 가 `<CONFIG_DIR>/grok-home-<agentId>/config.toml`
          //   로 쓰므로 그 dirname 이 정확히 그 홈이다 — resume 경로도 같은
          //   config 생성기를 타므로 두 경로가 갈릴 수 없다.
          env: {
            ...env,
            GROK_HOME: path.dirname(mcpConfigPath),
          },
          grokSessionId,
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
        // MCP: generateAntigravityConfig 가 agy 의 글로벌
        //   ~/.gemini/antigravity-cli/mcp_config.json 에 Marblo entry 를
        //   merge 한다. mcpConfigPath 는 sentinel/diagnostic path 로도 넘겨
        //   spawned process logs 에서 어떤 agent config 였는지 추적한다.
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
          os.platform() === "win32" &&
          (!baseCommand ||
            baseCommand === "antigravity" ||
            baseCommand === "agy")
            ? resolveHarnessCli("antigravity").command
            : !baseCommand || baseCommand === "antigravity"
              ? "agy"
              : baseCommand;
        const agyLaunch = ptyCommandForCli(agyCommand, agyArgs);
        return {
          command: agyLaunch.command,
          args: agyLaunch.args,
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
