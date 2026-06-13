import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * connection-store — 프로젝트↔GitHub repo 연결의 단일 진실원 (연동 T1·기반).
 *
 * 한 프로젝트가 "어떤 로컬 경로 / 어떤 repo / 어떤 harness / 어떤 권한"으로
 * 연결돼 있는지를 기록한다. T2(Harness 탭 UI)와 T3(미션 선택)는 이 모듈의
 * 읽기 인터페이스(getProjectConnection)만 import 해 연결 상태를 소비한다 —
 * 연결 메타를 각자 다시 계산하지 않는다.
 *
 * 설계 결정:
 *  - 저장소: 로컬 단일 JSON 파일 `~/.marblo/connections.json` (projectId 키).
 *    connection 데이터(localPath·connectedHarness·권한)는 이 머신에 종속적이라
 *    교차-에이전트 보드용 Firestore 가 아니라 로컬 파일이 맞다. 저장 루트
 *    `~/.marblo` 는 WorktreeManager 선례를 그대로 따른다.
 *  - 쓰기는 tmp→rename 원자 교체(harness-manager 패턴) — 부분 기록 방지.
 *  - repo URL / default branch 는 가능하면 git 으로 자동 채운다(MCP-first,
 *    OAuth UI 없음). git 호출은 절대 throw 하지 않고 못 구하면 null.
 */

/** 연결이 허용하는 쓰기 강도. read=조회만, write=작업트리 수정,
 * pr=PR 생성까지, commit=직접 커밋까지. */
export type AccessMode = "read" | "write" | "pr" | "commit";

/** GitHub/harness 권한 동의 상태. 'unknown'=아직 확인 안 됨(기본),
 * 'pending'=요청했으나 미확정, 'granted'=권한 확인됨, 'denied'=거부됨. */
export type PermissionsState = "unknown" | "pending" | "granted" | "denied";

/** 프로젝트↔repo 연결의 단일 진실원 레코드. */
export interface ProjectConnection {
  /** 연결의 1차 키 — Marblo 프로젝트 id. */
  projectId: string;
  /** 연결된 로컬 작업 디렉터리(절대경로). */
  localPath: string;
  /** origin remote URL (자동 도출). 못 구하면 null. */
  repoUrl: string | null;
  /** origin 기본 브랜치명(예: "main"; 자동 도출). 못 구하면 null. */
  defaultBranch: string | null;
  /** 연결된 harness id(예: "claude", "codex"). 미연결이면 null. */
  connectedHarness: string | null;
  /** 이 연결에서 사용 가능한 MCP 서버 id 목록(T2/T3 가 채움). */
  availableMcps: string[];
  /** 허용 쓰기 강도. 기본 'read'. */
  accessMode: AccessMode;
  /** 이 연결로 마지막 실행한 epoch ms. 미실행이면 null. */
  lastRunAt: number | null;
  /** GitHub/harness 권한 동의 상태. 기본 'unknown'. */
  permissionsState: PermissionsState;
}

/** upsert 입력 — projectId·localPath 만 필수, 나머지는 부분 지정/자동 채움. */
export interface ProjectConnectionInput {
  projectId: string;
  localPath: string;
  repoUrl?: string | null;
  defaultBranch?: string | null;
  connectedHarness?: string | null;
  availableMcps?: string[];
  accessMode?: AccessMode;
  lastRunAt?: number | null;
  permissionsState?: PermissionsState;
}

/** git 으로 도출한 repo 메타. 못 구한 필드는 null. */
export interface GitRepoMeta {
  repoUrl: string | null;
  defaultBranch: string | null;
}

const DEFAULT_STORE_DIR = path.join(os.homedir(), ".marblo");
const DEFAULT_STORE_FILE = "connections.json";

/** git 호출 타임아웃 — 오프라인/auth-wedge 가 연결 저장을 막지 못하게. */
const GIT_TIMEOUT_MS = 5_000;

type Stored = Record<string, ProjectConnection>;

/**
 * 프로젝트↔repo 연결의 로컬 단일 진실원. 파일 1개(JSON, projectId 키)에
 * 모든 연결을 담는다. 테스트는 `storePath` 를 주입해 격리한다(WorktreeManager
 * 의 worktreesRoot 주입과 동일한 패턴).
 */
export class ConnectionStore {
  private storePath: string;

  constructor(opts?: { storePath?: string }) {
    this.storePath =
      opts?.storePath ?? path.join(DEFAULT_STORE_DIR, DEFAULT_STORE_FILE);
  }

  /** 현재 store 파일 절대경로(진단용). */
  getStorePath(): string {
    return this.storePath;
  }

  /** 전체 레코드 읽기. 파일 없음/깨짐이면 빈 맵(절대 throw 안 함). */
  private readAll(): Stored {
    try {
      const raw = fs.readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Stored;
      }
      return {};
    } catch {
      // 파일 없음(ENOENT) 또는 손상 — 빈 상태로 시작.
      return {};
    }
  }

  /** 전체 레코드를 tmp→rename 으로 원자 교체(harness-manager 패턴). */
  private writeAll(data: Stored): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, this.storePath);
  }

  /**
   * ★T2/T3 가 쓰는 1차 읽기 인터페이스. projectId 의 연결 레코드, 없으면 null.
   */
  get(projectId: string): ProjectConnection | null {
    return this.readAll()[projectId] ?? null;
  }

  /** 모든 연결 레코드(연결된 프로젝트 목록 등에서 사용). */
  list(): ProjectConnection[] {
    return Object.values(this.readAll());
  }

  /**
   * 완전한 연결 레코드를 통째로 저장(있으면 교체). 입력은 ProjectConnection
   * 전체 — 부분 병합/자동채움이 필요하면 connect() 를 쓴다.
   */
  upsert(conn: ProjectConnection): ProjectConnection {
    const all = this.readAll();
    all[conn.projectId] = conn;
    this.writeAll(all);
    return conn;
  }

  /**
   * 저장 훅 — 부분 입력을 기존 레코드와 병합하고, repoUrl/defaultBranch 가
   * 비어 있으면 localPath 의 git 메타로 자동 채워 저장한다(MCP-first, OAuth
   * UI 없음). 기존 값이 명시돼 있거나 입력으로 주어지면 git 도출을 건너뛴다.
   */
  async connect(input: ProjectConnectionInput): Promise<ProjectConnection> {
    const existing = this.get(input.projectId);

    // 병합: 입력 > 기존 > 기본값.
    const merged: ProjectConnection = {
      projectId: input.projectId,
      localPath: input.localPath,
      repoUrl: input.repoUrl ?? existing?.repoUrl ?? null,
      defaultBranch: input.defaultBranch ?? existing?.defaultBranch ?? null,
      connectedHarness:
        input.connectedHarness ?? existing?.connectedHarness ?? null,
      availableMcps: input.availableMcps ?? existing?.availableMcps ?? [],
      accessMode: input.accessMode ?? existing?.accessMode ?? "read",
      lastRunAt: input.lastRunAt ?? existing?.lastRunAt ?? null,
      permissionsState:
        input.permissionsState ?? existing?.permissionsState ?? "unknown",
    };

    // repoUrl 또는 defaultBranch 가 비어 있으면 git 으로 자동 채움.
    if (merged.localPath && (!merged.repoUrl || !merged.defaultBranch)) {
      const meta = await deriveGitRepoMeta(merged.localPath);
      if (!merged.repoUrl) merged.repoUrl = meta.repoUrl;
      if (!merged.defaultBranch) merged.defaultBranch = meta.defaultBranch;
    }

    return this.upsert(merged);
  }

  /** 마지막 실행 시각 갱신. 레코드 없으면 null 반환(no-op). */
  touchLastRun(projectId: string, at: number): ProjectConnection | null {
    const existing = this.get(projectId);
    if (!existing) return null;
    return this.upsert({ ...existing, lastRunAt: at });
  }

  /** 연결 레코드 삭제. 있었으면 true. */
  remove(projectId: string): boolean {
    const all = this.readAll();
    if (!(projectId in all)) return false;
    delete all[projectId];
    this.writeAll(all);
    return true;
  }
}

/**
 * `git` 1회 호출. 절대 reject 하지 않고 { code, stdout } 으로 resolve.
 * (worktree-manager.runGit 와 같은 never-throw choke-point 패턴.)
 */
function runGit(
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout });
    };
    try {
      const proc = spawn("git", args, { cwd });
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish(1);
      }, timeoutMs);
      timer.unref?.();
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.on("close", (code) => finish(code ?? 1));
      proc.on("error", () => finish(1));
    } catch {
      finish(1);
    }
  });
}

/**
 * localPath 의 git 으로 origin repo URL 과 기본 브랜치를 도출한다.
 *  - repoUrl:        `git remote get-url origin` (fs-manager.getGitRemoteUrl 동일)
 *  - defaultBranch:  `git symbolic-ref --short refs/remotes/origin/HEAD` 에서
 *                    `origin/` 접두 제거. 없으면 현재 브랜치로 폴백
 *                    (worktree-manager.resolveBaseRef 동일 전략).
 * 어느 쪽도 못 구하면 해당 필드 null. 절대 throw 안 함.
 */
export async function deriveGitRepoMeta(
  localPath: string,
): Promise<GitRepoMeta> {
  const meta: GitRepoMeta = { repoUrl: null, defaultBranch: null };

  const remote = await runGit(["remote", "get-url", "origin"], localPath);
  if (remote.code === 0) {
    const url = remote.stdout.trim();
    if (url) meta.repoUrl = url;
  }

  const sym = await runGit(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    localPath,
  );
  if (sym.code === 0 && sym.stdout.trim()) {
    // "origin/main" → "main".
    meta.defaultBranch = sym.stdout.trim().replace(/^origin\//, "");
  } else {
    const cur = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], localPath);
    if (cur.code === 0 && cur.stdout.trim()) {
      meta.defaultBranch = cur.stdout.trim();
    }
  }

  return meta;
}

// ─── 기본 싱글톤 + 모듈 레벨 편의 함수 ───────────────────────────────
// 태스크가 명시한 이름(getProjectConnection / upsertProjectConnection)을
// 기본 store 인스턴스 위에 노출한다. main.ts·T2·T3 는 이 함수들만 쓰면 된다.

let _defaultStore: ConnectionStore | null = null;

/** 프로세스 공유 기본 store(~/.marblo/connections.json). */
export function getConnectionStore(): ConnectionStore {
  if (!_defaultStore) _defaultStore = new ConnectionStore();
  return _defaultStore;
}

/** 테스트 훅 — 기본 store 를 주입/리셋(미지정 시 다음 호출에서 재생성). */
export function _setDefaultConnectionStore(
  store: ConnectionStore | null,
): void {
  _defaultStore = store;
}

/** ★단일 진실원 읽기 — projectId 의 연결, 없으면 null. (T2/T3 소비 진입점) */
export function getProjectConnection(
  projectId: string,
): ProjectConnection | null {
  return getConnectionStore().get(projectId);
}

/**
 * 단일 진실원 쓰기 — 부분 입력을 병합·git 자동채움 후 저장. 완전한
 * ProjectConnection 을 그대로 넣어도 동작한다(없는 필드만 자동 채움).
 */
export function upsertProjectConnection(
  conn: ProjectConnectionInput,
): Promise<ProjectConnection> {
  return getConnectionStore().connect(conn);
}

/** 모든 연결 레코드. */
export function listProjectConnections(): ProjectConnection[] {
  return getConnectionStore().list();
}

/** 마지막 실행 시각 갱신(기본 now=Date.now()). 레코드 없으면 null. */
export function touchProjectLastRun(
  projectId: string,
  at: number = Date.now(),
): ProjectConnection | null {
  return getConnectionStore().touchLastRun(projectId, at);
}
