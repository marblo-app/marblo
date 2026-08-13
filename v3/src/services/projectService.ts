import { where, arrayUnion, arrayRemove } from "firebase/firestore";
import type { Project } from "../types/project";
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

export function normalizeGitRemoteUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let s = url.trim().toLowerCase();
  if (!s) return null;

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

export async function createProject(
  data: Omit<Project, "id" | "createdAt" | "updatedAt">,
): Promise<string> {
  const now = new Date();
  const members = data.members.includes(data.ownerId)
    ? data.members
    : [data.ownerId, ...data.members];
  return createDocument(COLLECTION, {
    ...data,
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
    ...data,
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
