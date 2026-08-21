import { where, arrayUnion, arrayRemove } from "firebase/firestore";
import type { Project } from "../types/project";
import { sanitizeGitRemoteUrl } from "../lib/gitUrlSafety";
import {
  buildMachinePathEntry,
  machineKeyFor,
  type ProjectMachinePath,
} from "../lib/projectPaths";
import {
  getDocument,
  queryDocuments,
  createDocument,
  updateDocument,
  mergeDocument,
  deleteDocument,
  toTimestamp,
  convertTimestamps,
} from "./firestore";

export async function findProjectByPath(
  folderPath: string,
  userId: string,
): Promise<Project | null> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("folderPath", "==", folderPath),
    where("members", "array-contains", userId),
  );
  return docs.length > 0 ? toProject(docs[0]) : null;
}

/**
 * remote URL → **비교 전용** 정규형 `host/owner/repo`.
 *
 * ★크레덴셜을 먼저 벗긴다 (티켓 d0d0JkRd1SeGTxVRx4nQ, P0 보안).
 * 이전 구현은 `https://` 뒤를 `([^/]+)` 로 잡아 `token@github.com` 전체를
 * 호스트로 삼았다 — userinfo 가 안 벗겨진 채, 게다가 전체 `.toLowerCase()`
 * 로 토큰이 뭉개져 **항상 mismatch** 였다. 그래서 같은 repo 인데도 매칭이
 * 안 돼 프로젝트가 중복 생성되는 실버그까지 같이 있었다.
 *
 * ★경로 대소문자를 접는 이유 — 이 함수의 결과는 **오직 비교 키**로만 쓰인다
 * (findProjectByPathOrRemote·projectStore 중복가드). 표시·git 명령에 쓰는
 * 값은 원문을 보존하는 `sanitizeGitRemoteUrl` 쪽이다. GitHub 는 owner/repo
 * 를 대소문자 구분 없이 같은 repo 로 해석하므로, 여기서 대소문자를 살리면
 * `Acme/App` 로 clone 한 멤버가 `acme/app` 로 등록된 같은 프로젝트를 못 찾고
 * 중복 프로젝트를 만든다. 비교 키는 접는 쪽이 맞다.
 */
export function normalizeGitRemoteUrl(
  url: string | null | undefined,
): string | null {
  const sanitized = sanitizeGitRemoteUrl(url);
  if (!sanitized) return null;
  let s = sanitized.toLowerCase();

  // git@host:path
  let m = s.match(/^git@([^:]+):(.+)$/);
  if (m) s = `${m[1]}/${m[2]}`;
  else {
    // ssh://git@host/path | https://host/path | http://host/path | git://host/path
    m = s.match(/^(?:(?:ssh:\/\/)?git@|https?:\/\/|git:\/\/)([^/]+)\/(.+)$/);
    if (m) s = `${m[1]}/${m[2]}`;
  }
  return s.replace(/\.git$/, "");
}

// Match a project by git remote URL (priority 1) or folder path (priority 2),
// scoped to the given user. Falls back to folder path when remote URL is null
// or no remote-based match exists. Non-git folders rely on folderPath alone.
export async function findProjectByPathOrRemote(
  folderPath: string,
  gitRemoteUrl: string | null | undefined,
  userId: string,
): Promise<Project | null> {
  const normalized = normalizeGitRemoteUrl(gitRemoteUrl);
  if (normalized) {
    const userProjects = await queryDocuments<Record<string, unknown>>(
      COLLECTION,
      where("members", "array-contains", userId),
    );
    for (const raw of userProjects) {
      const candidate = normalizeGitRemoteUrl(
        raw.gitRemoteUrl as string | undefined,
      );
      if (candidate && candidate === normalized) {
        return toProject(raw);
      }
    }
  }
  return findProjectByPath(folderPath, userId);
}

const COLLECTION = "projects";
const DATE_FIELDS = ["createdAt", "updatedAt"];

function toProject(raw: Record<string, unknown>): Project {
  return convertTimestamps<Project>(raw, DATE_FIELDS);
}

export async function getProjects(userId: string): Promise<Project[]> {
  const docs = await queryDocuments<Record<string, unknown>>(
    COLLECTION,
    where("members", "array-contains", userId),
  );
  return docs.map(toProject);
}

export async function getProject(projectId: string): Promise<Project | null> {
  const raw = await getDocument<Record<string, unknown>>(COLLECTION, projectId);
  return raw ? toProject(raw) : null;
}

/**
 * ★Firestore 쓰기의 크레덴셜 초크포인트 (티켓 d0d0JkRd1SeGTxVRx4nQ).
 *
 * `projects` 문서는 **팀 전원이 읽는다**. gitRemoteUrl 에 userinfo 가 실려
 * 오면 한 멤버의 개인 토큰이 팀 전체에 공개된다. 호출부가 늘어나도
 * (useProjectSetup·RepoConnectModal·teamService…) 새는 곳이 안 생기도록
 * 필드를 여기 한 곳에서 정화한다. 값이 없으면 그대로 둔다 — undefined 를
 * 만들어 넣으면 Firestore 가 거부한다.
 */
function withSanitizedRemote<T extends { gitRemoteUrl?: string }>(data: T): T {
  if (typeof data.gitRemoteUrl !== "string") return data;
  const clean = sanitizeGitRemoteUrl(data.gitRemoteUrl);
  if (clean === data.gitRemoteUrl) return data;
  // 정화 후 빈 값이면 필드를 아예 빼서 오염된 원문이 남지 않게 한다.
  const next = { ...data, gitRemoteUrl: clean ?? undefined };
  if (next.gitRemoteUrl === undefined) delete next.gitRemoteUrl;
  return next;
}

export async function createProject(
  data: Omit<Project, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  const members = data.members.includes(data.ownerId)
    ? data.members
    : [data.ownerId, ...data.members];
  return createDocument(COLLECTION, {
    ...withSanitizedRemote(data),
    members,
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });
}

export async function updateProject(
  projectId: string,
  data: Partial<Omit<Project, "id" | "createdAt">>,
): Promise<void> {
  await updateDocument(COLLECTION, projectId, {
    ...withSanitizedRemote(data),
    updatedAt: toTimestamp(new Date()),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await deleteDocument(COLLECTION, projectId);
}

/**
 * 이 기기의 폴더 경로 칸만 기록한다 (티켓 sHyHC9RoutYHDt97UOEm).
 *
 * ★다른 기기의 칸을 절대 건드리지 않는다. `setDoc(merge:true)` 는 중첩 맵을
 * **재귀 병합**하므로 `folderPaths` 아래 내 키 하나만 보내면 형제 키(다른
 * 기기들)는 서버에서 그대로 보존된다. 맵 전체를 read-modify-write 하면 두
 * 기기가 동시에 등록할 때 서로의 칸을 날릴 수 있어 그 방식은 쓰지 않는다.
 * (#494 의 telegramChannel 병합과 같은 방식)
 *
 * 레거시 단일 `folderPath` 필드는 **의도적으로 건드리지 않는다** — 아직
 * 마이그레이션하지 않은 다른 기기나 구버전 클라이언트가 그 값에 의존하고
 * 있을 수 있다. 새 필드가 권위자이고 레거시는 읽기 전용 유물로 남는다.
 */
export async function setProjectFolderPathForMachine(
  projectId: string,
  machineId: string,
  path: string,
  platform: string,
): Promise<ProjectMachinePath> {
  const entry = buildMachinePathEntry(machineId, path, platform, Date.now());
  await mergeDocument(COLLECTION, projectId, {
    folderPaths: { [machineKeyFor(machineId)]: entry },
    updatedAt: toTimestamp(new Date()),
  });
  return entry;
}

/**
 * 멤버십 쓰기의 단일 초크포인트 계약 (티켓 3YSvLFCT707GpV8FEyUp, P0).
 *
 * ★이 앱에서 `project.members` 를 바꾸는 코드는 아래 addMember/removeMember
 * 둘뿐이고, 둘 다 **프로젝트 하나**를 인자로 받는다. 그러므로 "1명 추가가
 * 여러 프로젝트에 번지는" 사고는 (a) 호출자가 프로젝트를 순회하거나
 * (b) 스코프가 깨진 값(빈 문자열·undefined·배열)이 id 자리에 들어올 때만
 * 생긴다. (b)는 조용히 엉뚱한 문서를 만들거나 건드릴 수 있으므로 여기서
 * 즉시 끊는다 — 실패가 조용한 광범위 쓰기보다 언제나 낫다.
 * (a)는 코드리뷰/회귀테스트가 막는다(tests/integration/team-collaboration).
 */
function assertSingleMembershipTarget(projectId: string, userId: string): void {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error("addMember/removeMember: projectId must be a non-empty id");
  }
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("addMember/removeMember: userId must be a non-empty uid");
  }
}

export async function addMember(
  projectId: string,
  userId: string,
): Promise<void> {
  assertSingleMembershipTarget(projectId, userId);
  await updateDocument(COLLECTION, projectId, {
    members: arrayUnion(userId),
    updatedAt: toTimestamp(new Date()),
  });
}

export async function removeMember(
  projectId: string,
  userId: string,
): Promise<void> {
  assertSingleMembershipTarget(projectId, userId);
  await updateDocument(COLLECTION, projectId, {
    members: arrayRemove(userId),
    updatedAt: toTimestamp(new Date()),
  });
}
