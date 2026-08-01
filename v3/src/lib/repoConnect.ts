import type { Project } from "../types/project";

/**
 * repoConnect — "저장소 연결" 모달의 노출 판정 (티켓 r8VggohxLGciDVXV2rf6,
 * 게이트 완화 r8vIviEcwHFbFJ88RqZ7).
 *
 * 초대 수락한 멤버가 프로젝트에 진입했는데 이 기기에 rootPath 가 없으면
 * Clone & 연결 모달을 띄운다.
 *
 * ★판정이 보수적이어야 하는 이유 — 이미 연결된 멤버에게 픽셀 하나도
 * 바뀌면 안 된다:
 *  - `machineId` 도착 전에는 판정하지 않는다. 부팅 초기엔 리졸버가 내 칸을
 *    특정하지 못해 owner 조차 folderPath 가 잠시 undefined 가 되는데, 그
 *    순간 모달이 번쩍이면 안 된다.
 *  - `folderPathResolution.kind === "own"` 이면 절대 노출하지 않는다.
 *
 * ★repo URL 은 더 이상 노출 조건이 아니다(실버그 수정). URL 은 로컬 git
 * 폴더가 붙은 기기에서만 채워지는데, 초대받은 멤버는 로컬 repo 가 없어
 * 스스로 채울 수 없다. owner 가 한 번도 안 채운 프로젝트에서는 모달이 영영
 * 뜨지 않아 멤버가 코드에 손도 못 댔다. 이제 URL 을 모르면 수동입력 모드로
 * 띄운다 — `repoConnectMode` 가 두 모드를 가른다.
 */
export function shouldOfferRepoConnect(
  project: Pick<Project, "gitRemoteUrl" | "folderPathResolution"> | null,
  machineId: string | null,
): boolean {
  if (!project || !machineId) return false;
  const kind = project.folderPathResolution?.kind;
  return kind === "foreign-only" || kind === "unregistered";
}

/**
 * 모달이 어떤 모드로 떠야 하나.
 *  - `clone`  — 프로젝트가 repo 주소를 안다. 주소를 보여주고 [Clone & 연결].
 *  - `manual` — 주소를 모른다. 주소 입력란 + [기존 폴더 연결]로 받아낸다.
 */
export function repoConnectMode(
  project: Pick<Project, "gitRemoteUrl"> | null,
): "clone" | "manual" {
  return project?.gitRemoteUrl?.trim() ? "clone" : "manual";
}

/** URL 에서 clone 폴더 이름을 표시용으로 파생 (electron repo-clone 과 동일 규칙). */
export function repoDirNameFromUrl(url: string): string {
  const last =
    url
      .replace(/[/:]+$/, "")
      .split(/[/:]/)
      .pop() ?? "";
  const cleaned = last
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[.-]+/, "");
  return cleaned || "repo";
}
