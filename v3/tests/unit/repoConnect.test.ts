import { describe, expect, it } from "vitest";
import {
  repoConnectMode,
  repoDirNameFromUrl,
  resolveRepoConnectVisible,
  shouldOfferRepoConnect,
} from "../../src/lib/repoConnect";
import type { ProjectPathResolution } from "../../src/lib/projectPaths";

// "저장소 연결" 모달 노출 판정 (티켓 r8VggohxLGciDVXV2rf6,
// 게이트 완화 r8vIviEcwHFbFJ88RqZ7, own-but-empty 보강 r8vg9pMWCRtdnUzR3KyX).
// 핵심 계약: 이미 연결된 멤버(own)·machineId 미도착에서는 절대 true 가 되지
// 않는다 — 기존 화면 픽셀 불변의 근거. repo URL 부재는 더 이상 차단 사유가
// 아니라 모드(clone vs manual) 결정 요인이다. 단, own 으로 표시된 폴더가
// 비어 있거나 프로젝트와 다른 git 을 가리키면 예외적으로 모달을 띄운다.

const REPO = "https://github.com/acme/app.git";
const MACHINE = "mac-abc-123";

function project(
  kind: ProjectPathResolution["kind"] | undefined,
  // null = "URL 없음"(기본 파라미터가 undefined 를 삼키는 함정 회피용 센티널)
  gitRemoteUrlOrNull: string | null = REPO,
) {
  const gitRemoteUrl = gitRemoteUrlOrNull ?? undefined;
  const folderPathResolution: ProjectPathResolution | undefined =
    kind === "own"
      ? { kind, path: "/Users/me/app", source: "machine" }
      : kind === "foreign-only"
        ? {
            kind,
            otherMachines: [
              {
                path: "C:\\Users\\owner\\app",
                platform: "win32",
                machineId: "win-1",
                updatedAt: 1,
              },
            ],
          }
        : kind === "unregistered"
          ? { kind }
          : undefined;
  return { gitRemoteUrl, folderPathResolution };
}

describe("shouldOfferRepoConnect", () => {
  it("offers for a member whose machine has no path (foreign-only)", () => {
    expect(shouldOfferRepoConnect(project("foreign-only"), MACHINE)).toBe(true);
  });

  it("offers when no machine registered a path yet (unregistered)", () => {
    expect(shouldOfferRepoConnect(project("unregistered"), MACHINE)).toBe(true);
  });

  it("never offers when this machine already has the path (own)", () => {
    expect(shouldOfferRepoConnect(project("own"), MACHINE)).toBe(false);
  });

  it("never offers before machineId arrives (boot flash guard)", () => {
    expect(shouldOfferRepoConnect(project("foreign-only"), null)).toBe(false);
  });

  // ★실버그(r8vIviEcwHFbFJ88RqZ7): owner 가 로컬 git 폴더를 한 번도 안 붙인
  // 프로젝트는 gitRemoteUrl 이 비어 있고, 초대받은 멤버는 로컬 repo 가 없어
  // 스스로 채울 수도 없다 — 예전 게이트에선 모달이 영영 안 떴다.
  it("still offers without a repo URL (manual entry fallback)", () => {
    expect(shouldOfferRepoConnect(project("foreign-only", null), MACHINE)).toBe(
      true,
    );
    expect(shouldOfferRepoConnect(project("unregistered", null), MACHINE)).toBe(
      true,
    );
  });

  it("keeps the own-machine invariant even without a repo URL", () => {
    expect(shouldOfferRepoConnect(project("own", null), MACHINE)).toBe(false);
    expect(shouldOfferRepoConnect(project("foreign-only", null), null)).toBe(
      false,
    );
  });

  it("never offers without a project or resolution", () => {
    expect(shouldOfferRepoConnect(null, MACHINE)).toBe(false);
    expect(shouldOfferRepoConnect(project(undefined), MACHINE)).toBe(false);
  });

  // ★own-but-empty 보강 (티켓 r8vg9pMWCRtdnUzR3KyX).
  // 자동 등록된 빈 폴더/잘못된 git 으로 인해 영구히 코드 탭에 못 들어오던
  // 갭을 막는다. 정상 own(코드 있고 프로젝트와 매칭)은 여전히 표시 안 됨
  // — 픽셀 불변.
  it("does not offer when own folder is valid (pixel-invariant)", () => {
    expect(shouldOfferRepoConnect(project("own"), MACHINE, "valid")).toBe(
      false,
    );
  });

  it("offers when own folder is empty (auto-registered empty dir)", () => {
    expect(shouldOfferRepoConnect(project("own"), MACHINE, "empty")).toBe(true);
  });

  it("offers when own folder has a mismatching git remote", () => {
    expect(shouldOfferRepoConnect(project("own"), MACHINE, "mismatch")).toBe(
      true,
    );
  });

  it("treats own + null (preflight pending) as no-offer (boot flash guard)", () => {
    // IPC 가 아직 안 돌아온 첫 프레임엔 null — 깜빡임 방지.
    expect(shouldOfferRepoConnect(project("own"), MACHINE, null)).toBe(false);
  });

  it("ignores ownValidity for non-own kinds (foreign-only / unregistered keep offering)", () => {
    expect(
      shouldOfferRepoConnect(project("foreign-only"), MACHINE, "empty"),
    ).toBe(true);
    expect(
      shouldOfferRepoConnect(project("unregistered"), MACHINE, "mismatch"),
    ).toBe(true);
  });
});

describe("resolveRepoConnectVisible", () => {
  // ★회귀가드: 수동 재호출(forceOpen)은 project kind 와 무관하게 항상 모달을
  // 열 수 있어야 한다. forceOpen 을 isOwn 에 묶으면 non-own/undefined
  // 프로젝트에서 수동 재호출 버튼이 죽는다(진범 RepoConnectModal.tsx:166-167).
  it("forceOpen alone opens the modal regardless of project kind", () => {
    expect(resolveRepoConnectVisible(false, true)).toBe(true);
  });

  it("offered alone still opens the modal", () => {
    expect(resolveRepoConnectVisible(true, false)).toBe(true);
  });

  it("neither offered nor forceOpen keeps the modal closed", () => {
    expect(resolveRepoConnectVisible(false, false)).toBe(false);
  });

  // ★회귀가드(티켓 b4Iw8qInqACF2Ba0UaYc): dismissed 는 자동 경로만 막는다.
  // `!dismissed` 를 visible 전체에 걸면 [나중에]로 한 번 닫은 프로젝트에서
  // '저장소 연결' 버튼이 영영 죽는다(forceOpen=true → visible=false →
  // forceOpen 즉시 리셋 → 무반응).
  it("forceOpen overrides dismissed so the manual button reopens the modal", () => {
    expect(resolveRepoConnectVisible(false, true, true)).toBe(true);
    expect(resolveRepoConnectVisible(true, true, true)).toBe(true);
  });

  // ★반대쪽 회귀가드(#699 own-valid 자동 미노출 유지): 자동 경로는 dismissed
  // 를 계속 존중해야 한다. 여기가 true 로 뒤집히면 [나중에]가 무력화된다.
  it("offered alone still respects dismissed", () => {
    expect(resolveRepoConnectVisible(true, false, true)).toBe(false);
    expect(resolveRepoConnectVisible(true, false, false)).toBe(true);
  });

  it("dismissed cannot open a modal that was never offered", () => {
    expect(resolveRepoConnectVisible(false, false, true)).toBe(false);
  });

  // 세 번째 인자를 안 주는 기존 호출부는 의미가 바뀌지 않는다.
  it("defaults dismissed to false for two-argument callers", () => {
    expect(resolveRepoConnectVisible(true, false)).toBe(true);
    expect(resolveRepoConnectVisible(false, true)).toBe(true);
    expect(resolveRepoConnectVisible(false, false)).toBe(false);
  });
});

describe("repoConnectMode", () => {
  it("uses clone mode when the project knows its repo URL", () => {
    expect(repoConnectMode({ gitRemoteUrl: REPO })).toBe("clone");
  });

  it("falls back to manual entry when the URL is missing or blank", () => {
    expect(repoConnectMode({ gitRemoteUrl: undefined })).toBe("manual");
    expect(repoConnectMode({ gitRemoteUrl: "   " })).toBe("manual");
    expect(repoConnectMode(null)).toBe("manual");
  });
});

describe("repoDirNameFromUrl", () => {
  it("matches the electron-side derivation for display", () => {
    expect(repoDirNameFromUrl("https://github.com/acme/app.git")).toBe("app");
    expect(repoDirNameFromUrl("git@github.com:acme/my-repo.git")).toBe(
      "my-repo",
    );
    expect(repoDirNameFromUrl("https://github.com/acme/....git")).toBe("repo");
  });
});
