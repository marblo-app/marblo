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

export type PackageType = "skill" | "mcp" | "plugin";

export interface InstallStrategy {
  /**
   * `git` — clone a repo to ~/.claude/skills/<dest>/
   * `mcp` — add an entry to ~/.claude.json mcpServers
   * `bundled` — installed automatically by bundle-installer (no-op here)
   * `manual` — show instructions only (cannot auto-install)
   */
  kind: "git" | "mcp" | "bundled" | "manual";
  /** For kind=git: repo URL; for kind=mcp: command to run */
  source?: string;
  /** For kind=git: subdirectory under ~/.claude/skills/ */
  dest?: string;
  /** For kind=mcp: env vars to set */
  env?: Record<string, string>;
  /** For kind=mcp: args array */
  args?: string[];
  /** For kind=manual: human-readable instructions */
  instructions?: string;
}

export interface DetectStrategy {
  /** Path under ~/.claude/ that, if exists, indicates the package is installed. */
  path?: string;
  /** mcpServers key in ~/.claude.json that, if present, indicates installed. */
  mcpKey?: string;
}

export interface HarnessPackage {
  id: string;
  name: string;
  description: string;
  type: PackageType;
  category: "required" | "recommended" | "mcp";
  install: InstallStrategy;
  detect: DetectStrategy;
  /** External docs/source link for the user. */
  url?: string;
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
      "TaskForce / 칸반 / 에이전트 관리 MCP 도구 모음. Marblo 앱이 실행 중일 때만 동작.",
    type: "mcp",
    category: "required",
    install: { kind: "bundled" },
    detect: { mcpKey: "marblo" },
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
];
