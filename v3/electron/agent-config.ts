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
            execFileSync(exe, ["--version"], { timeout: 5000, encoding: "utf-8" })
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
  antigravity: "agy",
};

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
// complex 티어가 쓰는 "현재 사용 가능한 최상위 Claude 모델 id"를 env 주입 +
// CLI 버전가드 + 그레이스풀 폴백을 거쳐 결정한다(하드코딩 "opus" 제거).
// ★사용자 결정1: resolver 는 complex 티어에만 적용한다 — standard 는 기존
// "opus" 리터럴을 그대로 유지(표준작업 비용 무변동). 즉 MARBLO_TOP_CLAUDE_MODEL
// 은 complex 작업에만 영향을 준다.

/** 불확실한 모든 상황의 안전 귀결(§8.3). "최상위를 못 쓰는 것"은 허용,
 * "spawn 자체가 깨지는 것"은 불허 — 그래서 늘 검증된 opus 로 떨어진다. */
export const FALLBACK_TOP_CLAUDE_MODEL = "opus";

/** Fable5 최소 요구 claude CLI 버전(버전가드 기본 임계값). env 로 덮어쓸 수 있다. */
const DEFAULT_FABLE5_MIN_CLI = "2.1.170";

/** claude 계열 모델 id alias. 프로바이더 정규화(normalizeModel, dispatch-scoring)
 * 와는 다른 층 — 이건 claude 내부의 _모델 id_ alias 다. "fable" → "claude-fable-5". */
export const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  fable: "claude-fable-5",
};

export interface TopModelFallback {
  /** 폴백 사유 코드(텔레메트리/로그 키). */
  reason: "fable5_version_guard" | "unknown_top_model";
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

/** semver "X.Y.Z" 비교. a<b → 음수, a==b → 0, a>b → 양수. 누락 파트는 0 취급. */
export function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

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
 * 최상위 Claude 모델을 env/버전가드/폴백을 거쳐 결정한다(§3). 폴백 메타까지
 * 반환하는 상세판 — 텔레메트리/사용자 표식용. 순수 함수(env + resolveClaudeBinary
 * 만 읽음)라 단위테스트가 쉽다.
 *
 *   - MARBLO_TOP_CLAUDE_MODEL(기본 "opus")를 읽어 alias 정규화.
 *   - claude-fable-5 면 설치된 claude CLI 버전을 MARBLO_FABLE5_MIN_CLI(기본
 *     2.1.170)와 비교 — 미달/파싱실패 시 opus 로 그레이스풀 폴백 + 구조화 로그.
 *   - opus/sonnet 은 통과. 검증 못 하는 미지 모델은 보수적으로 opus 폴백.
 *
 * @param installedVersion 설치된 claude CLI 버전 주입(테스트용). 미지정이면
 *   resolveClaudeBinary().version(실제 설치본)을 쓴다.
 */
export function resolveTopClaudeModelDetailed(
  installedVersion?: string,
): TopModelResolution {
  const raw = (process.env.MARBLO_TOP_CLAUDE_MODEL || FALLBACK_TOP_CLAUDE_MODEL)
    .trim()
    .toLowerCase();
  const id = CLAUDE_MODEL_ALIASES[raw] || raw; // "fable" → "claude-fable-5"
  const resolvedCli =
    installedVersion === undefined ? resolveClaudeBinary() : null;
  const version = installedVersion ?? resolvedCli?.version ?? ""; // "X.Y.Z"

  if (id === "claude-fable-5") {
    const minCli = (
      process.env.MARBLO_FABLE5_MIN_CLI || DEFAULT_FABLE5_MIN_CLI
    ).trim();
    if (!version || cmpSemver(version, minCli) < 0) {
      const fallback: TopModelFallback = {
        reason: "fable5_version_guard",
        requested: id,
        installed: version || "unknown",
        ...(resolvedCli ? { command: resolvedCli.command } : {}),
        required: minCli,
        fallbackTo: FALLBACK_TOP_CLAUDE_MODEL,
      };
      logTopModelFallback(fallback);
      return { model: FALLBACK_TOP_CLAUDE_MODEL, fallback };
    }
    return { model: "claude-fable-5", fallback: null };
  }

  // opus/sonnet 은 검증된 알려진 id — 통과.
  if (id === "opus" || id === "sonnet") return { model: id, fallback: null };

  // 검증 불가한 미지 모델 → 보수적으로 opus.
  const fallback: TopModelFallback = {
    reason: "unknown_top_model",
    requested: id,
    installed: version || "unknown",
    ...(resolvedCli ? { command: resolvedCli.command } : {}),
    fallbackTo: FALLBACK_TOP_CLAUDE_MODEL,
  };
  logTopModelFallback(fallback);
  return { model: FALLBACK_TOP_CLAUDE_MODEL, fallback };
}

/** §3 resolver 의 모델 id 만 필요한 호출자용 얇은 래퍼. */
export function resolveTopClaudeModel(): string {
  return resolveTopClaudeModelDetailed().model;
}

/** complex 에서 쓸 Codex 최상위 reasoning effort. env MARBLO_TOP_CODEX_REASONING,
 * 기본 "high". 유효값(low/medium/high) 아니면 high 로 폴백. */
export function resolveTopCodexReasoning(): string {
  const r = (process.env.MARBLO_TOP_CODEX_REASONING || "high")
    .trim()
    .toLowerCase();
  return ["low", "medium", "high"].includes(r) ? r : "high";
}

/** 기본 cheap Claude 모델 — simple 물리스폰(isolate)에서 사용. */
export const DEFAULT_SIMPLE_CLAUDE_MODEL = "sonnet";

/** simple(저난도) 에서 쓸 cheap Claude 모델. env MARBLO_SIMPLE_CLAUDE_MODEL,
 * 기본 "sonnet". 빈 값이면 기본으로 폴백. (--model alias/id 를 그대로 전달) */
export function resolveSimpleClaudeModel(): string {
  const m = (
    process.env.MARBLO_SIMPLE_CLAUDE_MODEL || DEFAULT_SIMPLE_CLAUDE_MODEL
  )
    .trim()
    .toLowerCase();
  return m || DEFAULT_SIMPLE_CLAUDE_MODEL;
}

/** simple 에서 쓸 cheap Codex reasoning effort. env MARBLO_SIMPLE_CODEX_REASONING,
 * 기본 "low". 유효값(low/medium/high) 아니면 low 로 폴백. */
export function resolveSimpleCodexReasoning(): string {
  const r = (process.env.MARBLO_SIMPLE_CODEX_REASONING || "low")
    .trim()
    .toLowerCase();
  return ["low", "medium", "high"].includes(r) ? r : "low";
}

// 작업 complexity → 프로바이더별 모델/레벨. 품질 우선 정책: 기본(standard)은
// 최상위(claude=opus, gpt-5.5=medium)를 유지하고, 작은 작업(simple)만 한 단계 낮추며,
// 어려운 작업(complex)은 최상위를 쓴다. complexity 가 undefined 면 override 하지 않아
// 기본 모델을 상속한다(오케스트레이터 등). claude=--model, gpt(codex)=model_reasoning_effort.
//   claude:  simple → resolveSimpleClaudeModel(),  standard → opus(리터럴),  complex → resolveTopClaudeModel()
//   gpt:     simple → resolveSimpleCodexReasoning(),  standard → medium,        complex → resolveTopCodexReasoning()
// ★결정1: complex/simple 만 resolver 를 탄다. env 미설정 시 simple=sonnet/low,
// complex=opus/high 로 떨어져 현행과 byte-identical(무회귀). simple 모델은
// dispatch_task isolate=true(물리 cheap 스폰)일 때 비로소 실제로 쓰인다(§B).
export type TaskComplexity = "simple" | "standard" | "complex";
export function modelTierForComplexity(
  model: ModelType,
  complexity: TaskComplexity | undefined,
): { claudeModel?: string; codexReasoning?: string } {
  if (!complexity) return {}; // override 없음 → 기본 상속
  if (model === "claude") {
    if (complexity === "simple")
      return { claudeModel: resolveSimpleClaudeModel() }; // env, 기본 sonnet
    if (complexity === "complex")
      return { claudeModel: resolveTopClaudeModel() }; // env/버전가드/폴백(§3)
    return { claudeModel: "opus" }; // standard — 현행 리터럴 유지(무변동)
  }
  if (model === "gpt") {
    if (complexity === "simple")
      return { codexReasoning: resolveSimpleCodexReasoning() }; // env, 기본 low
    if (complexity === "complex")
      return { codexReasoning: resolveTopCodexReasoning() }; // env, 기본 high
    return { codexReasoning: "medium" };
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

// MCP server entry point (compiled JS in dist-mcp/)
function getMCPServerPath(): string {
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

function getMCPServerEnv(
  projectDir: string,
  marbloProjectId?: string,
  agentId?: string,
  marbloContextId?: string,
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
  marbloContextId?: string,
): MCPServerEntry {
  // PATH 의 첫 node 를 믿지 않고 검증된 node 를 pin 한다. Electron 번들이면
  // ELECTRON_RUN_AS_NODE=1 가 함께 필요하므로 node.env 를 마지막에 머지해
  // getMCPServerEnv 가 덮어쓰지 못하게 한다(키 충돌은 없지만 안전 우선).
  const node = resolveNodeBinary();
  return {
    command: node.command,
    args: [getMCPServerPath()],
    env: {
      ...getMCPServerEnv(projectDir, marbloProjectId, agentId, marbloContextId),
      ...node.env,
    },
  };
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
    marbloContextId?: string,
    // 역할별 MCP 화이트리스트(claude strict 경로) 선택용. 미지정이면 기본
    // 워커 화이트리스트가 적용된다.
    role?: string,
  ): string {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    const mcpEntry = buildMCPServerEntry(
      projectDir,
      marbloProjectId,
      agentId,
      marbloContextId,
    );

    switch (model) {
      case "claude":
        return this.generateClaudeConfig(agentId, mcpEntry, role);
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
  generateSkillFile(
    agentId: string,
    role: string,
    _projectDir: string,
  ): string {
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
    // claude 런타임 강등 재시작(§3.4-3)용 모델 override. 설정되면 complexity
    // 기반 resolver 대신 이 모델 id 로 --model 을 핀한다(예: fable5 실패 → "opus").
    claudeModelOverride?: string,
    // Optional MCP context. Quick Lane agents use lane:<id> for board isolation.
    marbloContextId?: string,
  ): LaunchConfig {
    const mcpConfigPath = this.generateMCPConfig(
      agent.id,
      agent.model,
      projectDir,
      marbloProjectId,
      marbloContextId,
      agent.role,
    );
    const skillPath = this.generateSkillFile(agent.id, agent.role, projectDir);
    const skillContent =
      skillPath && fs.existsSync(skillPath)
        ? fs.readFileSync(skillPath, "utf-8")
        : "";

    const { command, args, env, claudeSessionId, modelResolution } =
      this.buildCLICommand(
        agent.model,
        agent.command,
        mcpConfigPath,
        projectDir,
        marbloProjectId,
        agent.id,
        resumeSessionId,
        pinClaudeSession,
        complexity,
        claudeModelOverride,
        marbloContextId,
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
          `[agy] ${globalConfigPath} parse failed (${parseError}); leaving file untouched, MCP disabled for this path.`,
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
    claudeModelOverride?: string,
    marbloContextId?: string,
  ): {
    command: string;
    args: string[];
    env: Record<string, string>;
    claudeSessionId?: string;
    modelResolution?: TopModelResolution;
  } {
    const env = getMCPServerEnv(
      projectDir,
      marbloProjectId,
      agentId,
      marbloContextId,
    );
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
        // 결정 우선순위:
        //   1) claudeModelOverride — 런타임 강등 재시작(fable5 실패 → opus, §3.4-3)
        //   2) complex → resolveTopClaudeModelDetailed() (env/버전가드/폴백 + 메타)
        //   3) 그 외(simple/standard/미지정) → modelTierForComplexity 리터럴
        let claudeModel: string | undefined;
        let modelResolution: TopModelResolution | undefined;
        if (claudeModelOverride) {
          claudeModel = claudeModelOverride;
        } else if (complexity === "complex") {
          modelResolution = resolveTopClaudeModelDetailed();
          claudeModel = modelResolution.model;
        } else {
          claudeModel = modelTierForComplexity(model, complexity).claudeModel;
        }
        return {
          // On Windows node-pty does NOT resolve a bare command via PATH/PATHEXT
          // (it throws "File not found"), so the orchestrator's literal "claude"
          // baseCommand can't be spawned. Use the resolved absolute path (claude.exe)
          // there. POSIX is unchanged: bare "claude" baseCommand spawns as before.
          command:
            os.platform() === "win32"
              ? resolveClaudeBinary().command
              : baseCommand || resolveClaudeBinary().command,
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
            ...sessionArgs,
          ],
          env,
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
