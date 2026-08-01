import { describe, expect, it } from "vitest";
import {
  repoConnectMode,
  repoDirNameFromUrl,
  shouldOfferRepoConnect,
} from "../../src/lib/repoConnect";
import type { ProjectPathResolution } from "../../src/lib/projectPaths";

// "저장소 연결" 모달 노출 판정 (티켓 r8VggohxLGciDVXV2rf6,
// 게이트 완화 r8vIviEcwHFbFJ88RqZ7).
// 핵심 계약: 이미 연결된 멤버(own)·machineId 미도착에서는 절대 true 가 되지
// 않는다 — 기존 화면 픽셀 불변의 근거. repo URL 부재는 더 이상 차단 사유가
// 아니라 모드(clone vs manual) 결정 요인이다.

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
