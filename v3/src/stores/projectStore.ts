import { create } from "zustand";
import { where } from "firebase/firestore";
import type { Project } from "../types/project";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../services/firestore";
import * as projectService from "../services/projectService";
import { useSubscriptionStore } from "./subscriptionStore";
import { checkProjectCreate, ProjectLimitError } from "../lib/planLimits";
import { resolveProjectPath, withMachinePath } from "../lib/projectPaths";

const COLLECTION = "projects";
const DATE_FIELDS = ["createdAt", "updatedAt"];

/**
 * 문서를 이 기기 기준으로 재해석한다 (티켓 sHyHC9RoutYHDt97UOEm).
 *
 * ★여기가 "남의 기기 경로가 절대 새어나가지 않게" 막는 단일 초크포인트다.
 * 파생 `folderPath` 는 이 기기 칸이 있을 때만 채워지고, 다른 기기의 경로만
 * 있으면 undefined 가 된다. 덕분에 Header/CodeTab/FileTree/ConnectionStatusPanel
 * /CliSetupGate/useOrchestratorAutoLaunch 등 기존 소비자를 하나도 고치지 않고도
 * 올바른 값을 받는다 — undefined("로컬 경로 없음")는 앱 전역이 이미 제대로
 * 처리하는 상태다.
 *
 * 원본을 `legacyFolderPath`/`folderPaths` 에 보존하므로 machineId 가 뒤늦게
 * 도착해 다시 부를 때도 **멱등**하다.
 */
function applyMachineResolution(p: Project, machineId: string | null): Project {
  const legacy = p.legacyFolderPath ?? p.folderPath;
  const resolution = resolveProjectPath(
    { folderPath: legacy, folderPaths: p.folderPaths },
    machineId,
  );
  return {
    ...p,
    legacyFolderPath: legacy,
    folderPath: resolution.kind === "own" ? resolution.path : undefined,
    folderPathResolution: resolution,
  };
}

/**
 * 중복 등록 판정용 경로 일치.
 *
 * 파생 `folderPath`(이 기기 칸)뿐 아니라 **어느 기기의 칸이든** 같은 경로를
 * 들고 있으면 같은 프로젝트로 본다. 형제 기기(맥미니↔맥북)가 우연히 같은
 * 레이아웃을 쓰는 경우까지 덮어, 폴더를 다시 골랐을 때 두 번째 프로젝트가
 * 생기는 일을 막는다. 레거시 단일 필드도 후보에 포함한다.
 */
function projectHasPath(p: Project, folderPath: string): boolean {
  if (p.folderPath === folderPath) return true;
  if (p.legacyFolderPath === folderPath) return true;
  return Object.values(p.folderPaths ?? {}).some(
    (entry) => entry.path === folderPath,
  );
}

function toProject(
  raw: Record<string, unknown>,
  machineId: string | null,
): Project {
  return applyMachineResolution(
    convertTimestamps<Project>(raw, DATE_FIELDS),
    machineId,
  );
}

function ensureOwnerMember(
  data: Omit<Project, "id" | "createdAt" | "updatedAt">,
): Omit<Project, "id" | "createdAt" | "updatedAt"> {
  if (data.members.includes(data.ownerId)) return data;
  return {
    ...data,
    members: [data.ownerId, ...data.members],
  };
}

// Cold-start race: the very first onSnapshot can arrive empty before Firestore
// has hydrated / the auth token has propagated to the SDK (a permission error is
// collapsed to [] by subscribeToCollection). Re-arm the listener a few times with
// backoff so the board recovers without a manual renderer refresh.
const COLD_START_RETRY_BACKOFF_MS = [300, 800, 1500];

/**
 * 이 기기의 machineId. main 프로세스가 권위자이고 IPC 로 한 번만 받아와
 * 캐시한다(값은 app-state.json 에 영속되어 재시작해도 안 바뀐다).
 * 프로세스 수명 동안 상수이므로 모듈 레벨 프라미스로 중복 호출을 접는다.
 */
let machineIdPromise: Promise<string | null> | null = null;

function loadMachineId(): Promise<string | null> {
  if (!machineIdPromise) {
    machineIdPromise = (async () => {
      try {
        const id = await window.electronAPI?.getMachineId?.();
        return typeof id === "string" && id ? id : null;
      } catch {
        // fail-soft: machineId 를 못 얻으면 레거시 단일 경로만 보는 기존
        // 동작으로 degrade 한다(foreign-platform 차단은 그대로 유지).
        return null;
      }
    })();
  }
  return machineIdPromise;
}

/** 테스트 훅 — machineId 캐시 리셋. */
export function _resetMachineIdCache(): void {
  machineIdPromise = null;
}

interface ProjectState {
  currentProject: Project | null;
  projects: Project[];
  /** 이 기기의 machineId. 아직 IPC 응답 전이면 null. */
  machineId: string | null;
  /**
   * 지금 스토어에 실린 프로젝트가 **누구 것인지** — 활성 구독의 uid.
   *
   * 계정 격리의 판정 근거다(티켓 GOiAnCMjqrEPNcmBaiBY). 두 가지를 가능하게 한다:
   *  1. 스냅샷 콜백이 자기 uid 와 대조해, 이전 계정 구독의 늦은 스냅샷을 삼킨다.
   *  2. UI 가 `subscribedUserId === user.uid` 로 "이 리스트가 지금 로그인한
   *     계정의 것인가" 를 물을 수 있다 — projectsHydrated 만으로는 이전 계정
   *     세션에서 넘어온 true 와 구분되지 않는다.
   */
  subscribedUserId: string | null;
  autoSelectFirstProject: boolean;
  loading: boolean;
  // True once the first projects snapshot has settled (carried data, or the
  // cold-start retries were exhausted). Lets the UI distinguish "still loading
  // on cold start" from "genuinely has no projects".
  projectsHydrated: boolean;
  error: string | null;

  setCurrentProject: (project: Project) => void;
  clearCurrentProject: () => void;
  /**
   * 계정이 바뀔 때(로그아웃 포함) 계정 귀속 상태를 전부 버린다.
   * 호출은 `lib/accountScope` 의 초크포인트를 통해서만 — 직접 부르지 말 것.
   */
  resetForAccountChange: () => void;
  setAutoSelectFirstProject: (enabled: boolean) => void;
  findByFolderPath: (folderPath: string) => Project | undefined;
  findByPathOrRemote: (
    folderPath: string,
    gitRemoteUrl: string | null | undefined,
  ) => Project | undefined;
  /**
   * 이 기기의 폴더 경로를 프로젝트에 등록한다. 다른 기기의 칸은 보존된다.
   * 폴더 선택으로 "이 기기에 미등록" 상태를 해소하는 경로.
   */
  setFolderPathForThisMachine: (
    projectId: string,
    path: string,
  ) => Promise<void>;
  /**
   * 레거시 단일 folderPath 를 이 기기 칸으로 승격한다(자가치유).
   * 경로가 실제로 이 기기에 존재할 때만 주장한다.
   */
  claimLegacyFolderPaths: () => Promise<void>;
  fetchProjects: (userId: string) => Promise<void>;
  createProject: (
    data: Omit<Project, "id" | "createdAt" | "updatedAt">,
  ) => Promise<string>;
  updateProject: (id: string, data: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  subscribeToProjects: (userId: string) => () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  projects: [],
  machineId: null,
  subscribedUserId: null,
  autoSelectFirstProject: true,
  loading: false,
  projectsHydrated: false,
  error: null,

  setFolderPathForThisMachine: async (projectId: string, path: string) => {
    const machineId = get().machineId ?? (await loadMachineId());
    if (!machineId) {
      // machineId 없이 쓰면 어느 칸에 넣을지 알 수 없다 — 조용히 스킵한다.
      // 레거시 경로 해석은 그대로 동작하므로 사용자 영향은 없다.
      console.warn(
        "[projectStore] machineId unavailable — skipping per-machine folder path write",
      );
      return;
    }
    const platform = window.electronAPI?.platform ?? "";
    const entry = await projectService.setProjectFolderPathForMachine(
      projectId,
      machineId,
      path,
      platform,
    );
    // 낙관적 로컬 반영: onSnapshot 이 곧 같은 값을 실어오지만, 폴더 선택 직후
    // 오케 자동기동이 folderPath 를 즉시 읽으므로 왕복을 기다리지 않는다.
    const patch = (p: Project): Project =>
      p.id === projectId
        ? {
            ...p,
            folderPaths: withMachinePath(p.folderPaths, machineId, entry),
            folderPath: path,
            folderPathResolution: {
              kind: "own" as const,
              path,
              source: "machine" as const,
            },
          }
        : p;
    const { currentProject } = get();
    set({
      projects: get().projects.map(patch),
      currentProject: currentProject ? patch(currentProject) : currentProject,
    });
  },

  setCurrentProject: (project: Project) => {
    set({ currentProject: project });
  },

  clearCurrentProject: () => {
    set({ currentProject: null });
  },

  resetForAccountChange: () => {
    // machineId 는 기기 귀속이라 유지한다 — 계정과 무관하고, 버리면 다음 계정이
    // IPC 왕복을 다시 기다리는 동안 경로 해석이 레거시로 퇴화한다.
    // subscribedUserId=null 은 "지금 실린 데이터의 주인이 없다" 는 뜻이라,
    // 살아남은 이전 구독의 스냅샷도 이 시점 이후로는 전부 삼켜진다.
    set({
      projects: [],
      currentProject: null,
      subscribedUserId: null,
      loading: false,
      projectsHydrated: false,
      error: null,
    });
  },

  setAutoSelectFirstProject: (enabled: boolean) => {
    set({ autoSelectFirstProject: enabled });
  },

  findByFolderPath: (folderPath: string) => {
    return get().projects.find((p) => projectHasPath(p, folderPath));
  },

  findByPathOrRemote: (
    folderPath: string,
    gitRemoteUrl: string | null | undefined,
  ) => {
    const projects = get().projects;
    const normalized = projectService.normalizeGitRemoteUrl(gitRemoteUrl);
    if (normalized) {
      const byRemote = projects.find(
        (p) =>
          projectService.normalizeGitRemoteUrl(p.gitRemoteUrl) === normalized,
      );
      if (byRemote) return byRemote;
    }
    return projects.find((p) => projectHasPath(p, folderPath));
  },

  /**
   * 레거시 → 기기별 칸 마이그레이션 (티켓 sHyHC9RoutYHDt97UOEm).
   *
   * 대상은 `source === "legacy"` 로 해석된 프로젝트, 즉 **아직 어떤 기기도
   * 칸을 만들지 않은** 문서뿐이다. 여기서 이 기기가 칸을 만들면 그 문서는
   * 더 이상 레거시 채택 대상이 아니게 되어(리졸버 2번 분기), 다른 기기는
   * foreign-only 로 떨어진다 — 그래서 **정말 그 경로를 가진 기기만** 주장해야
   * 한다. 경로 존재 확인이 그 판정이다: 같은 OS 형제 기기(맥미니↔맥북)는
   * 경로 모양으로 구분되지 않으므로 존재 여부가 유일한 단서다.
   *
   * 전 구간 fail-soft — 마이그레이션이 실패해도 레거시 해석이 그대로 동작한다.
   */
  claimLegacyFolderPaths: async () => {
    const machineId = get().machineId ?? (await loadMachineId());
    if (!machineId) return;
    const candidates = get().projects.filter(
      (p) =>
        p.folderPathResolution?.kind === "own" &&
        p.folderPathResolution.source === "legacy" &&
        p.folderPath,
    );
    for (const p of candidates) {
      const path = p.folderPath;
      if (!path) continue;
      try {
        // 이 기기에 실제로 없는 경로는 내 것이 아니다 → 주장하지 않는다.
        // (그 기기에서는 기존 #512 "폴더가 사라졌습니다" 안내가 그대로 뜨고,
        //  폴더를 다시 고르면 그때 올바른 경로로 칸이 만들어진다.)
        if (!(await window.electronAPI?.fs?.pathExists?.(path))) continue;
        await get().setFolderPathForThisMachine(p.id, path);
      } catch (err) {
        console.warn(
          `[projectStore] legacy folderPath claim failed for ${p.id} (fail-soft):`,
          err,
        );
      }
    }
  },

  fetchProjects: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const machineId = get().machineId ?? (await loadMachineId());
      const projects = (await projectService.getProjects(userId)).map((p) =>
        applyMachineResolution(p, machineId),
      );
      // 계정 격리: 왕복 도중 계정이 바뀌었으면 이 결과는 남의 것이다 — 버린다.
      // (주인이 아직 없으면 = 방금 리셋된 상태면, 이 fetch 가 주인을 세운다.)
      const owner = get().subscribedUserId;
      if (owner !== null && owner !== userId) {
        set({ loading: false });
        return;
      }
      set({ projects, machineId, loading: false, subscribedUserId: userId });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch projects",
        loading: false,
      });
    }
  },

  createProject: async (data) => {
    // Plan gate (choke point): block a Free user's 2nd+ project regardless of
    // which UI path called us. The UI catches ProjectLimitError to open the
    // UpgradeModal; the server (enforceProjectLimit trigger) re-validates in
    // case a client bypasses this check with a direct Firestore write.
    const plan = useSubscriptionStore.getState().getPlan();
    const check = checkProjectCreate(plan, get().projects.length);
    if (!check.allowed) {
      const err = new ProjectLimitError(check);
      set({ error: err.message });
      throw err;
    }
    try {
      const id = await projectService.createProject(ensureOwnerMember(data));
      return id;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create project",
      });
      throw err;
    }
  },

  updateProject: async (id, data) => {
    try {
      await projectService.updateProject(id, data);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update project",
      });
      throw err;
    }
  },

  deleteProject: async (id) => {
    try {
      await projectService.deleteProject(id);
      const { currentProject } = get();
      if (currentProject?.id === id) {
        set({ currentProject: null });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete project",
      });
      throw err;
    }
  },

  subscribeToProjects: (userId: string) => {
    // ★계정 격리 (티켓 GOiAnCMjqrEPNcmBaiBY): uid 가 바뀌었으면 **스냅샷을
    //   기다리지 않고 지금 당장** 이전 계정의 리스트를 버린다. 예전엔 loading
    //   플래그만 세우고 `projects` 는 그대로 뒀는데, 그러면 새 계정 신원으로
    //   렌더되는 프레임이 옛 계정 프로젝트를 그대로 그린다 — 사용자가 실제로
    //   본 그 화면이다. 지우는 쪽은 언제나 안전하다(곧 올 스냅샷이 채운다).
    //
    //   ★같은 uid 면 비우지 않는다: 렌더러 재구독(sleep/wake 복귀, 이펙트 재실행)
    //   에서 useSessionRestore 가 이미 골라 둔 currentProject 를 날려 버리면
    //   창이 프로젝트를 잃는다. 격리에 필요한 건 "계정이 바뀔 때 비우는 것"뿐이다.
    if (get().subscribedUserId !== userId) {
      set({ projects: [], currentProject: null });
    }
    set({ subscribedUserId: userId, loading: true, projectsHydrated: false });

    // machineId 는 IPC 라 비동기다. 스냅샷이 먼저 도착할 수 있으므로, 도착하면
    // 이미 들고 있는 프로젝트를 다시 해석한다(applyMachineResolution 은 원본을
    // 보존하므로 멱등). 그 전까지는 레거시 단일 경로만 보는 기존 동작.
    void loadMachineId().then((machineId) => {
      if (!machineId || get().machineId === machineId) return;
      const { currentProject } = get();
      set({
        machineId,
        projects: get().projects.map((p) =>
          applyMachineResolution(p, machineId),
        ),
        currentProject: currentProject
          ? applyMachineResolution(currentProject, machineId)
          : currentProject,
      });
      // 스냅샷이 machineId 보다 먼저 도착한 경우, 재해석 직후가 레거시 승격을
      // 걸 수 있는 첫 시점이다(스냅샷은 다시 안 올 수 있으므로 여기서도 건다).
      if (!legacyClaimStarted && get().projectsHydrated) {
        legacyClaimStarted = true;
        void get().claimLegacyFolderPaths();
      }
    });

    let cancelled = false;
    // 레거시 승격은 이 구독당 한 번만. 스냅샷마다 재시도하면 같은 문서에
    // 반복 쓰기가 나간다.
    let legacyClaimStarted = false;
    let innerUnsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // Only the *initial* cold-start triggers retries. Once we accept an
    // authoritative snapshot, later emptying (e.g. last project deleted) must
    // not re-arm the listener.
    let settled = false;

    const arm = () => {
      if (cancelled) return;
      innerUnsub = subscribeToCollection<Record<string, unknown>>(
        COLLECTION,
        [where("members", "array-contains", userId)],
        (docs) => {
          if (cancelled) return;
          // ★uid 스탬프 가드 (계정 격리, 티켓 GOiAnCMjqrEPNcmBaiBY).
          //   `cancelled` 는 정상 teardown 만 막는다. 해제를 놓친 구독이나 이미
          //   비행 중이던 스냅샷이 새 계정 세션 위로 착지하는 경로는 그것으로
          //   닫히지 않는다 — 그게 바로 남의 프로젝트가 리스트에 실리는 모양이다.
          //   스토어가 기억하는 주인과 다르면 조용히 버린다(fail-closed).
          if (get().subscribedUserId !== userId) return;
          const projects = docs.map((d) => toProject(d, get().machineId));
          const { currentProject, autoSelectFirstProject } = get();

          // Auto-select first project if none selected
          let nextCurrent = currentProject;
          if (!nextCurrent && autoSelectFirstProject && projects.length > 0) {
            nextCurrent = projects[0];
          } else if (nextCurrent) {
            // Sync current project with latest data
            const updated = projects.find((p) => p.id === nextCurrent!.id);
            nextCurrent = updated || (projects.length > 0 ? projects[0] : null);
          }

          // Cold-start: first snapshot empty → likely transient (cold cache /
          // token lag). Tear down this listener and re-arm after a backoff,
          // keeping the store loading/unhydrated so the UI shows a spinner
          // instead of a false "No Projects". Give up after a few tries.
          if (
            !settled &&
            projects.length === 0 &&
            attempt < COLD_START_RETRY_BACKOFF_MS.length
          ) {
            const delay = COLD_START_RETRY_BACKOFF_MS[attempt];
            attempt += 1;
            // Keep whatever currentProject we have but don't flip loading off.
            set({ projects, currentProject: nextCurrent });
            if (innerUnsub) {
              innerUnsub();
              innerUnsub = null;
            }
            retryTimer = setTimeout(arm, delay);
            return;
          }

          settled = true;
          set({
            projects,
            currentProject: nextCurrent,
            loading: false,
            projectsHydrated: true,
          });
          // 권위 있는 스냅샷이 자리잡은 뒤 한 번만 레거시 경로를 승격한다.
          // machineId 를 아직 못 받았으면 조용히 no-op 이고, 그 경우 아래
          // loadMachineId().then 의 재해석 뒤에 다음 스냅샷에서 다시 걸린다.
          if (!legacyClaimStarted && get().machineId) {
            legacyClaimStarted = true;
            void get().claimLegacyFolderPaths();
          }
        },
      );
    };

    arm();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (innerUnsub) innerUnsub();
    };
  },
}));
