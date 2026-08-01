import type { Project } from "../types/project";

/**
 * repoConnect — "저장소 연결" 모달의 노출 판정 (티켓 r8VggohxLGciDVXV2rf6).
 *
 * 초대 수락한 멤버가 프로젝트에 진입했는데 이 기기에 rootPath 가 없으면
 * (프로젝트가 repo URL 을 알고 있을 때만) Clone & 연결 모달을 띄운다.
 *
 * ★판정이 보수적이어야 하는 이유 — 이미 연결된 멤버에게 픽셀 하나도
 * 바뀌면 안 된다:
 *  - `machineId` 도착 전에는 판정하지 않는다. 부팅 초기엔 리졸버가 내 칸을
 *    특정하지 못해 owner 조차 folderPath 가 잠시 undefined 가 되는데, 그
 *    순간 모달이 번쩍이면 안 된다.
 *  - `folderPathResolution.kind === "own"` 이면 절대 노출하지 않는다.
 *  - repo URL 이 없으면 모달이 보여줄 것도, clone 할 것도 없다 — 기존
 *    폴더 선택 플로우(폴더 피커)가 그대로 담당한다.
 */
export function shouldOfferRepoConnect(
  project: Pick<Project, "gitRemoteUrl" | "folderPathResolution"> | null,
  machineId: string | null,
): boolean {
  if (!project || !machineId) return false;
  if (!project.gitRemoteUrl) return false;
  const kind = project.folderPathResolution?.kind;
  return kind === "foreign-only" || kind === "unregistered";
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
