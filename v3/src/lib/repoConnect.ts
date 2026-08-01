import type { Project } from "../types/project";

/**
 * repoConnect — "저장소 연결" 모달의 노출 판정 (티켓 r8VggohxLGciDVXV2rf6,
 * 게이트 완화 r8vIviEcwHFbFJ88RqZ7, own-but-empty 보강 r8vg9pMWCRtdnUzR3KyX).
 *
 * 초대 수락한 멤버가 프로젝트에 진입했는데 이 기기에 rootPath 가 없으면
 * Clone & 연결 모달을 띄운다.
 *
 * ★판정이 보수적이어야 하는 이유 — 이미 연결된 멤버에게 픽셀 하나도
 * 바뀌면 안 된다:
 *  - `machineId` 도착 전에는 판정하지 않는다. 부팅 초기엔 리졸버가 내 칸을
 *    특정하지 못해 owner 조차 folderPath 가 잠시 undefined 가 되는데, 그
 *    순간 모달이 번쩍이면 안 된다.
 *  - `folderPathResolution.kind === "own"` 이면 보통 노출하지 않는다 —
 *    단, **그 폴더가 사실상 코드가 없는 상태**(비어 있거나 프로젝트의
 *    gitRemoteUrl 과 무관한 git)면 예외적으로 노출해 사용자가 바로잡게
 *    한다. 빈 폴더 자동 등록으로 `own` 이 된 멤버가 영구히 코드 탭에
 *    들어오지 못하던 갭을 막는다.
 *
 * ★repo URL 은 더 이상 노출 조건이 아니다(실버그 수정). URL 은 로컬 git
 * 폴더가 붙은 기기에서만 채워지는데, 초대받은 멤버는 로컬 repo 가 없어
 * 스스로 채울 수 없다. owner 가 한 번도 안 채운 프로젝트에서는 모달이 영영
 * 뜨지 않아 멤버가 코드에 손도 못 댔다. 이제 URL 을 모르면 수동입력 모드로
 * 띄운다 — `repoConnectMode` 가 두 모드를 가른다.
 */

/**
 * 이 기기 칸(`own`)으로 등록된 폴더가 실제 코드 탭을 쓸 수 있는 상태인가.
 *
 *  - `valid`    — 비어 있지 않고, 프로젝트의 gitRemoteUrl 과 (있으면) 일치.
 *  - `empty`    — 폴더는 존재하지만 코드가 없다(빈 폴더 자동 등록 케이스).
 *  - `mismatch` — 폴더에 git 이 있긴 한데 origin 이 프로젝트와 다르다.
 *  - `null`     — 아직 검사 전이거나 검사 실패(IPC 실패·권한 등). 이 경우엔
 *                 기존 동작(own 이면 모달 안 띄움)을 유지해 부팅 시 깜빡임을
 *                 막는다. 폴더가 실제로 코드 있는 정상 own 이면 어차피
 *                 검사 결과가 `valid` 로 들어와 다시 결정된다.
 */
export type OwnValidity = "valid" | "empty" | "mismatch" | null;

export function shouldOfferRepoConnect(
  project: Pick<Project, "gitRemoteUrl" | "folderPathResolution"> | null,
  machineId: string | null,
  // kind === "own" 일 때만 의미가 있다. 그 외엔 무시된다.
  ownValidity: OwnValidity = null
): boolean {
  if (!project || !machineId) return false;
  const kind = project.folderPathResolution?.kind;
  if (kind === "foreign-only" || kind === "unregistered") return true;
  if (kind === "own") {
    // 정상 own(코드 있고 프로젝트와 매칭) — 모달 띄우지 않음(★불변).
    if (ownValidity === "valid" || ownValidity === null) return false;
    // 빈 폴더/잘못된 git — 사용자가 바로잡게 모달 띄움.
    return true;
  }
  return false;
}

/**
 * 모달이 어떤 모드로 떠야 하나.
 *  - `clone`  — 프로젝트가 repo 주소를 안다. 주소를 보여주고 [Clone & 연결].
 *  - `manual` — 주소를 모른다. 주소 입력란 + [기존 폴더 연결]로 받아낸다.
 */
export function repoConnectMode(
  project: Pick<Project, "gitRemoteUrl"> | null
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
