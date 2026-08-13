/**
 * 프로젝트 kind (dev | assistant) 의 단일 초크포인트.
 *
 * 모델 필드·기본 서피스·MEMORY.md 시드 규칙을 여기 모은다. UI/스토어는
 * 이 파일만 읽는다 — 분기가 흩어지면 하위호환(kind 없는 구문서 = dev)이
 * 조용히 깨진다.
 */
import type { Project, ProjectKind } from "../types/project";
import type { RightTabId } from "./splitWorkspaceLayout";
import { BEGINNER_CHAT_TAB, type BeginnerTabId } from "./beginnerTabs";

export const PROJECT_KINDS = ["dev", "assistant"] as const satisfies readonly ProjectKind[];

/** Firestore/UI 에 kind 가 없을 때 — 기존 프로젝트는 전부 개발용. */
export const DEFAULT_PROJECT_KIND: ProjectKind = "dev";

/** 비서 프로젝트 위키 루트 장기 메모리 파일 이름(카파시 index/log 동형). */
export const ASSISTANT_MEMORY_FILENAME = "MEMORY.md";

/**
 * 비서 프로젝트 생성 시 심는 MEMORY.md 초안.
 * 에이전트/오케가 세션마다 이 파일을 장기 기억 허브로 읽도록 안내한다.
 */
export const ASSISTANT_MEMORY_SEED = `# MEMORY

Long-term memory for this **assistant** project (wiki root).

## How to use

- Keep durable facts, preferences, and decisions here — not ephemeral chat noise.
- Link out to focused notes (\`topics/….md\`) rather than growing this file forever.
- Pair with \`index.md\` (hub) and \`log.md\` (timeline) when the wiki grows
  (Kapasi-style LLM wiki).

## Scratch

- (seeded on project create — safe to edit)
`;

export function isProjectKind(v: unknown): v is ProjectKind {
  return v === "dev" || v === "assistant";
}

/** 구문서·undefined·오타 → `dev`. 유효값만 통과. */
export function normalizeProjectKind(kind: unknown): ProjectKind {
  return isProjectKind(kind) ? kind : DEFAULT_PROJECT_KIND;
}

export function isAssistantProject(
  project: Pick<Project, "kind"> | null | undefined,
): boolean {
  return normalizeProjectKind(project?.kind) === "assistant";
}

/**
 * 엑스퍼트(어드밴스드) 셸 기본 우측 탭.
 * - dev → board (현행)
 * - assistant → code (위키/문서; 대화는 좌측 오케 열)
 */
export function defaultRightTabForKind(kind: unknown): RightTabId {
  return normalizeProjectKind(kind) === "assistant" ? "code" : "board";
}

/**
 * 심플(비기너) 셸 기본 탭 — kind 와 무관하게 대화.
 * assistant 도 채팅-퍼스트(슬랙식); 위키/커넥터는 큐레이트 탭.
 */
export function defaultBeginnerTabForKind(_kind: unknown): BeginnerTabId {
  return BEGINNER_CHAT_TAB;
}

/**
 * 어드밴스드 셸에서 assistant 프로젝트로 전환했을 때 기본 서피스 적용 여부.
 * 보드·시작하기·레인 등 "개발 보드 중심" 탭에 있을 때만 code 로 옮긴다 —
 * 유저가 이미 harness/settings 에 있으면 건드리지 않는다.
 */
export function shouldNudgeAssistantWorkTab(activeTab: RightTabId): boolean {
  return (
    activeTab === "board" ||
    activeTab === "startHere" ||
    activeTab === "lanes" ||
    activeTab === "history"
  );
}

export interface AssistantSurfaceActions {
  activeTab: RightTabId;
  setActiveTab: (tab: RightTabId) => void;
  setFileTreeOpen: (open: boolean) => void;
  /** 문서 그래프 노출 이벤트 디스패치. 테스트에서 stub. */
  revealDocGraph?: () => void;
}

/**
 * assistant 기본 서피스: 우측 code + 파일 사이드바(문서 그래프) 열기.
 * 대화는 좌측 터미널 열(이미 상시). 커넥터는 harness 탭 — 보조 진입.
 */
export function applyAssistantDefaultSurface(
  actions: AssistantSurfaceActions,
): void {
  if (shouldNudgeAssistantWorkTab(actions.activeTab)) {
    actions.setActiveTab("code");
  }
  actions.setFileTreeOpen(true);
  if (actions.revealDocGraph) {
    actions.revealDocGraph();
  } else if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("marblo:reveal-doc-graph"));
  }
}

export interface MemoryFileIo {
  readFile: (rootPath: string, filePath: string) => Promise<string>;
  writeFile: (
    rootPath: string,
    filePath: string,
    content: string,
  ) => Promise<void>;
}

function joinRootFile(_root: string, name: string): string {
  // writeFile 은 root + 상대경로를 받는다 — 파일명은 항상 루트 직속.
  return name;
}

/**
 * assistant 프로젝트 폴더에 MEMORY.md 가 없으면 시드한다(멱등).
 * 기존 파일을 절대 덮어쓰지 않는다. 실패는 삼키고 skipped 로 보고(fail-soft).
 */
export async function ensureAssistantMemoryFile(
  folderPath: string | null | undefined,
  io?: MemoryFileIo,
): Promise<"created" | "exists" | "skipped"> {
  if (!folderPath) return "skipped";
  const fs: MemoryFileIo | null =
    io ??
    (typeof window !== "undefined" && window.electronAPI?.fs
      ? {
          readFile: (r, f) => window.electronAPI.fs.readFile(r, f),
          writeFile: (r, f, c) => window.electronAPI.fs.writeFile(r, f, c),
        }
      : null);
  if (!fs) return "skipped";

  const rel = joinRootFile(folderPath, ASSISTANT_MEMORY_FILENAME);
  try {
    await fs.readFile(folderPath, rel);
    return "exists";
  } catch {
    // missing — create
  }
  try {
    await fs.writeFile(folderPath, rel, ASSISTANT_MEMORY_SEED);
    return "created";
  } catch {
    return "skipped";
  }
}

/**
 * create/update 페이로드에 kind 를 정규화해 넣는다.
 * 생성 경로에서는 항상 명시 kind 를 문서에 남긴다(기본 dev).
 */
export function withNormalizedKind<T extends { kind?: ProjectKind }>(
  data: T,
): T & { kind: ProjectKind } {
  return { ...data, kind: normalizeProjectKind(data.kind) };
}
