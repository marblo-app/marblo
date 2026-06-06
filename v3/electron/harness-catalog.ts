/**
 * Harness curated catalog — packages users can install with one click.
 *
 * Initial set (P0/P1): bundled-required (always installed by
 * bundle-installer, listed here for visibility), plus optional
 * recommendations (superpowers, gstack) and a few "nice to have" MCPs.
 *
 * Each entry has a stable `id`, display metadata, an `install` strategy,
 * and a `detect` strategy so the UI can show install status.
 *
 * Custom URL-based installs are NOT in the catalog — they go through a
 * separate Custom Install flow with a trust-warning modal (P1).
 */

export type PackageType = "skill" | "mcp" | "plugin" | "cli";

export interface InstallStrategy {
  /**
   * `git`        — clone a repo to ~/.claude/skills/<dest>/
   * `mcp`        — add an entry to ~/.claude.json mcpServers
   * `bundled`    — installed automatically by bundle-installer (no-op here)
   * `manual`     — show instructions only (cannot auto-install)
   * `npm-global` — `npm install -g <package>` for CLI binaries (e.g.
   *                Codex, Gemini). Installs into the user's npm global
   *                prefix; requires Node + npm on PATH.
   * `shell`      — Run a curl-pipe-bash installer script (e.g. Antigravity's
   *                `curl -fsSL https://antigravity.google/cli/install.sh | bash`).
   *                URL in `source` must be HTTPS and from a whitelisted host
   *                (enforced by harness-manager). Same trust level as
   *                `npm-global` — runs upstream code as the user. Use only
   *                when upstream doesn't ship an npm package.
   */
  kind: "git" | "mcp" | "bundled" | "manual" | "npm-global" | "shell";
  /** For kind=git: repo URL; for kind=mcp: command to run; for npm-global:
   *  package name; for shell: HTTPS URL of installer script. */
  source?: string;
  /** For kind=git: subdirectory under ~/.claude/skills/ */
  dest?: string;
  /** For kind=mcp: env vars to set */
  env?: Record<string, string>;
  /** For kind=mcp: args array */
  args?: string[];
  /** For kind=manual: human-readable instructions */
  instructions?: string;
  /** For kind=npm-global: post-install message (e.g. auth instructions) */
  postInstall?: string;
  /**
   * Optional commands to run after a successful install. Best-effort —
   * failures are logged but don't fail the parent install. Used to enable
   * feature flags on freshly-installed CLIs (e.g. `codex features enable goals`).
   */
  postInstallExec?: Array<{ command: string; args: string[] }>;
}

export interface DetectStrategy {
  /** Path under ~/.claude/ that, if exists, indicates the package is installed. */
  path?: string;
  /** mcpServers key in ~/.claude.json that, if present, indicates installed. */
  mcpKey?: string;
  /** Binary name resolvable via PATH (`which <name>`); used for kind=npm-global. */
  binary?: string;
}

export interface HarnessPackage {
  id: string;
  name: string;
  description: string;
  type: PackageType;
  category: "required" | "recommended" | "mcp" | "cli";
  install: InstallStrategy;
  detect: DetectStrategy;
  /** External docs/source link for the user. */
  url?: string;
  /**
   * Marks a package as deprecated / end-of-life. The Harness UI shows a
   * warning badge and suppresses the install / required CTAs, and the
   * auto-updater (`checkAndUpdateHarness`) skips it. `note` should explain
   * why (incl. EOL date) and what replaces it.
   */
  deprecated?: { note: string };
}

export const CATALOG: HarnessPackage[] = [
  // ── Required (auto-installed by bundle-installer) ──────────────
  {
    id: "marblo-tf-commands",
    name: "TaskForce 슬래시 커맨드",
    description:
      "Marblo 워크플로우용 /tf-* 슬래시 커맨드 18종. 앱 설치 시 자동 설치됨.",
    type: "skill",
    category: "required",
    install: { kind: "bundled" },
    detect: { path: "commands/tf-status.md" },
  },
  {
    id: "marblo-mcp",
    name: "Marblo MCP 서버",
    description:
      "TaskForce / 칸반 / 에이전트 관리 MCP 도구 모음. Marblo 대시보드 내부에서 spawn 된 에이전트(Claude / Codex / Gemini)는 per-agent isolated config 로 자동 연결됩니다. 외부 터미널 CLI 세션에는 등록하지 않습니다 — 그쪽은 사용자의 taskforce MCP 등 별도 설정으로 관리하세요.",
    type: "mcp",
    category: "required",
    install: { kind: "bundled" },
    detect: { mcpKey: "marblo" },
  },

  // ── Required CLIs (heterogeneous-agent core) ────────────────────
  // Marblo 오케스트레이터와 워커 에이전트는 모두 `claude` / `codex` /
  // `gemini` 바이너리에 의존. 없으면 spawn 즉시 fast-fail. npm 글로벌
  // 설치라 사용자 동의 후 1-click.
  {
    id: "cli-claude-code",
    name: "Claude Code CLI",
    description:
      "오케스트레이터 및 Claude 에이전트 실행에 필요한 CLI. `npm install -g @anthropic-ai/claude-code`. 설치 후 `claude` 첫 실행 시 OAuth 또는 API 키로 인증.",
    type: "cli",
    category: "required",
    install: {
      kind: "npm-global",
      source: "@anthropic-ai/claude-code",
      postInstall:
        "설치 후 터미널에서 `claude` 한 번 실행해서 Anthropic 계정 OAuth 또는 API 키 인증을 완료하세요. 그 후 Marblo 재시작.",
    },
    detect: { binary: "claude" },
    url: "https://docs.claude.com/en/docs/claude-code",
  },
  {
    id: "cli-codex",
    name: "OpenAI Codex CLI",
    description:
      "Codex (gpt) 에이전트 실행에 필요한 CLI. `npm install -g @openai/codex`. 설치 후 `codex login`으로 인증. /goal 기능은 설치 시 자동 활성화됩니다.",
    type: "cli",
    category: "required",
    install: {
      kind: "npm-global",
      source: "@openai/codex",
      postInstall:
        "설치 후 터미널에서 `codex login` 실행해서 OpenAI 계정 인증을 완료하세요. /goal 기능이 자동 활성화됐으니, 인증 후 Codex 세션에서 `/goal <목표>`로 자율 모드 사용 가능.",
      postInstallExec: [
        { command: "codex", args: ["features", "enable", "goals"] },
      ],
    },
    detect: { binary: "codex" },
    url: "https://github.com/openai/codex",
  },
  // Gemini CLI 는 단종 예정 (2026-06-18 개인 티어 EOL → Antigravity 로 통합).
  // 주력 CLI 는 Claude Code / Codex / Antigravity 3종. 카탈로그에는 남겨두되
  // `deprecated` 플래그로 "단종 예정" 배지·설치 비권장을 표시하고, 자동 업데이트
  // 대상에서 제외한다. 기존에 떠 있던 gemini 에이전트의 런타임 처리(세션 파싱·
  // spawn)는 back-compat 로 코드에 남아있다.
  {
    id: "cli-gemini",
    name: "Google Gemini CLI",
    description:
      "⚠️ 단종 예정 (2026-06-18 개인 티어 EOL). Antigravity (agy) CLI 로 통합됩니다. 신규 설치는 권장하지 않습니다 — 주력은 Claude Code / Codex / Antigravity 3종. 엔터프라이즈 Code Assist 또는 유료 API 키 사용자만 계속 동작합니다.",
    type: "cli",
    category: "required",
    install: {
      kind: "npm-global",
      source: "@google/gemini-cli",
      postInstall:
        "⚠️ Gemini CLI 개인 티어는 2026-06-18 종료됩니다. 신규 설치 대신 Antigravity (agy) CLI 를 사용하세요. 기존 사용자는 엔터프라이즈 Code Assist 또는 유료 API 키로만 계속 동작합니다.",
    },
    detect: { binary: "gemini" },
    url: "https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/",
    deprecated: {
      note: "2026-06-18 개인 티어 EOL — Antigravity CLI(agy)로 대체. 엔터프라이즈 Code Assist / 유료 API 키만 유지.",
    },
  },
  {
    id: "cli-antigravity",
    name: "Google Antigravity (agy) CLI",
    description:
      "Antigravity 2.0 (Google I/O 2026 발표) 의 agy CLI. Marblo 의 4번째 1st-class 에이전트 모델. curl shell 인스톨러로 자동 설치. 첫 실행 시 OAuth 브라우저 인증.",
    type: "cli",
    category: "required",
    install: {
      kind: "shell",
      source: "https://antigravity.google/cli/install.sh",
      postInstall:
        "설치 후 터미널에서 `agy` 한 번 실행해서 OAuth 브라우저 인증을 완료하세요. 바이너리는 `~/.local/bin/agy` 에 설치되고 shell rc 의 PATH 가 업데이트됩니다. 인증 후 Marblo 재시작. 첫 agy 워커 스폰 시 `~/.gemini/antigravity-cli/mcp_config.json` 에 Marblo MCP 항목이 자동 머지됩니다 (기존 MCP 항목 보존).",
    },
    detect: { binary: "agy" },
    url: "https://antigravity.google/docs",
  },

  // ── Recommended skill packs ────────────────────────────────────
  {
    id: "superpowers",
    name: "Superpowers",
    description:
      "Anthropic의 Claude Code 스킬 모음 (TDD, debugging, brainstorming, code review 등).",
    type: "plugin",
    category: "recommended",
    install: {
      kind: "manual",
      instructions:
        "Claude Code 플러그인 시스템으로 설치하세요. 자세한 안내: https://github.com/anthropics/claude-code-plugins",
    },
    detect: { path: "plugins/marketplaces" },
    url: "https://github.com/anthropics/claude-code-plugins",
  },
  {
    id: "gstack",
    name: "gstack",
    description:
      "디자인 / QA / 배포 / 보안 / 회고 등 풀스택 워크플로우 스킬셋.",
    type: "skill",
    category: "recommended",
    install: {
      kind: "git",
      source: "https://github.com/gstack-tools/gstack-skills.git",
      dest: "gstack",
    },
    detect: { path: "skills/gstack" },
    url: "https://github.com/gstack-tools/gstack-skills",
  },

  // ── Useful MCPs ────────────────────────────────────────────────
  {
    id: "mcp-context7",
    name: "context7 (라이브러리 문서)",
    description:
      "라이브러리 / API 최신 문서를 조회하는 MCP. React / Next.js / Tailwind 등.",
    type: "mcp",
    category: "mcp",
    install: {
      kind: "mcp",
      source: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
    detect: { mcpKey: "context7" },
    url: "https://github.com/upstash/context7",
  },
  {
    id: "mcp-filesystem",
    name: "filesystem (파일 시스템)",
    description:
      "Claude가 사용자 지정 디렉터리의 파일을 읽고 쓸 수 있게 하는 공식 MCP.",
    type: "mcp",
    category: "mcp",
    install: {
      kind: "mcp",
      source: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${HOME}/Documents",
      ],
    },
    detect: { mcpKey: "filesystem" },
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "mcp-github",
    name: "github (이슈 / PR / 코드 검색)",
    description:
      "GitHub 이슈 / PR 관리, 저장소 / 코드 / 사용자 검색을 위한 공식 MCP.",
    type: "mcp",
    category: "mcp",
    install: {
      kind: "mcp",
      source: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}",
      },
    },
    detect: { mcpKey: "github" },
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "mcp-playwright",
    name: "playwright (브라우저 자동화)",
    description:
      "에이전트가 헤드리스 Chromium으로 페이지 열기 / 클릭 / 폼 입력 / 스크린샷 / 콘솔 로그 캡처를 직접 수행. 자체 IDE 임베드 브라우저(P2-10) 미루는 동안 90% 대체.",
    type: "mcp",
    category: "mcp",
    install: {
      kind: "mcp",
      source: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    },
    detect: { mcpKey: "playwright" },
    url: "https://github.com/microsoft/playwright-mcp",
  },
];
