// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveWorkspaceModeEnabled,
  useWorkspaceModeStore,
} from "../../src/stores/workspaceModeStore";

const STORAGE_KEY = "marblo.workspaceMode.enabled";

/**
 * 셸은 제품의 기본값을 넘어 **유일한** 화면이 됐다(설정 토글 제거). 이 테스트가
 * 지키는 불변식은 두 가지다:
 *  1. 프로덕션(테스트 해치 OFF)에서는 저장된 opt-out("0")조차 무시하고 ON —
 *     예전에 토글을 껐던 유저가 되돌릴 UI 없이 레거시에 갇히지 않는다.
 *  2. 테스트 모드에서만 "0" 이 레거시 <Layout /> 으로 떨어뜨린다 — cleanroom
 *     E2E(switchToLegacyLayout)가 계속 그 경로를 검증할 수 있게.
 *
 * localStorage 는 직접 심는다: 이 러너의 jsdom 은 실제 저장소를 노출하지 않아
 * (node --localstorage-file 미지정) window.localStorage 가 undefined 다.
 */
function setTestHatch(on: boolean): void {
  (
    window as unknown as {
      electronAPI?: { testMode?: { bypassAuth: boolean } };
    }
  ).electronAPI = on ? { testMode: { bypassAuth: true } } : undefined;
}

function setStoredFlag(value: string | null): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => (key === STORAGE_KEY ? value : null) },
  });
}

afterEach(() => {
  setTestHatch(false);
  setStoredFlag(null);
});

describe("workspaceModeStore", () => {
  it("defaults to ON (the shell is the only shipped experience)", () => {
    expect(useWorkspaceModeStore.getState().enabled).toBe(true);
  });

  it("ignores a persisted opt-out in production", () => {
    setTestHatch(false);
    setStoredFlag("0");
    expect(resolveWorkspaceModeEnabled()).toBe(true);
  });

  it("honors the persisted opt-out only under the test hatch", () => {
    setTestHatch(true);
    setStoredFlag("0");
    expect(resolveWorkspaceModeEnabled()).toBe(false);
  });

  it("stays ON under the test hatch when no opt-out is written", () => {
    setTestHatch(true);
    setStoredFlag(null);
    expect(resolveWorkspaceModeEnabled()).toBe(true);
  });

  it("stays ON when reading storage throws (private mode)", () => {
    setTestHatch(true);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("storage disabled");
        },
      },
    });
    expect(resolveWorkspaceModeEnabled()).toBe(true);
  });
});
