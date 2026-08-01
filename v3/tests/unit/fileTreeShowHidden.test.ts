import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage 만 있으면 동작. jsdom 없이 stub.
const storage: Record<string, string> = {};
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
  },
});

const { useFileTreeStore, isShowHidden } =
  await import("../../src/stores/fileTreeStore");

const KEY = "marblo:v3:fileTree:showHidden";
const stored = () => JSON.parse(storage[KEY] ?? "{}");

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  useFileTreeStore.setState({ showHiddenByScope: {} });
});

/**
 * 티켓 D8yiihCWgDMd3AU7xkEy — "숨김 항목 표시"는 **프로젝트 단위**로 기억한다.
 * 파이썬 프로젝트에선 켜두고, 나머지 프로젝트 트리는 깨끗하게. 기본은 언제나
 * OFF 라 켜지 않은 프로젝트는 이전과 트리가 동일해야 한다.
 */
describe("fileTreeStore.showHidden — 프로젝트 단위 토글", () => {
  it("기본값은 OFF — 기존 사용자 트리는 그대로다", () => {
    const { showHiddenByScope } = useFileTreeStore.getState();
    expect(isShowHidden(showHiddenByScope, "proj-1")).toBe(false);
  });

  it("모르는 스코프는 항상 false (없는 키 = 감춤)", () => {
    expect(isShowHidden({}, "never-seen")).toBe(false);
    expect(isShowHidden({ other: true }, "never-seen")).toBe(false);
  });

  it("toggle 하면 그 프로젝트만 켜지고 localStorage 에 남는다", () => {
    useFileTreeStore.getState().toggleShowHidden("proj-1");
    expect(
      isShowHidden(useFileTreeStore.getState().showHiddenByScope, "proj-1"),
    ).toBe(true);
    expect(stored()).toEqual({ "proj-1": true });
  });

  it("★한 프로젝트에서 켜도 다른 프로젝트는 영향 없다", () => {
    useFileTreeStore.getState().toggleShowHidden("python-proj");
    const map = useFileTreeStore.getState().showHiddenByScope;
    expect(isShowHidden(map, "python-proj")).toBe(true);
    expect(isShowHidden(map, "other-proj")).toBe(false);
  });

  it("다시 toggle 하면 꺼지고 그 값도 남는다", () => {
    useFileTreeStore.getState().toggleShowHidden("proj-1");
    useFileTreeStore.getState().toggleShowHidden("proj-1");
    expect(
      isShowHidden(useFileTreeStore.getState().showHiddenByScope, "proj-1"),
    ).toBe(false);
    expect(stored()).toEqual({ "proj-1": false });
  });

  it("같은 값으로 set 하면 쓰지 않는다 (불필요한 리렌더/쓰기 방지)", () => {
    useFileTreeStore.getState().setShowHidden("proj-1", false);
    expect(storage[KEY]).toBeUndefined();
  });

  it("빈 스코프는 no-op (프로젝트도 폴더도 없을 때)", () => {
    useFileTreeStore.getState().setShowHidden("", true);
    expect(storage[KEY]).toBeUndefined();
  });

  it("setShowHidden(true) 는 폴더 생성이 가려졌을 때 자동으로 켜는 경로다", () => {
    useFileTreeStore.getState().setShowHidden("/Users/me/venv-work", true);
    expect(stored()).toEqual({ "/Users/me/venv-work": true });
  });

  it("프로젝트에 안 묶인 폴더도 경로 스코프로 따로 기억된다", () => {
    useFileTreeStore.getState().setShowHidden("proj-1", true);
    useFileTreeStore.getState().setShowHidden("/tmp/loose-folder", true);
    expect(stored()).toEqual({ "proj-1": true, "/tmp/loose-folder": true });
  });
});

describe("fileTreeStore.showHidden — 저장분 복원", () => {
  it("깨진 JSON 은 빈 맵으로 취급한다 (graceful)", () => {
    storage[KEY] = "not json {{";
    // 읽기 함수는 스토어 생성 시점에 돌지만, isShowHidden 자체가 방어적이다.
    expect(isShowHidden({}, "proj-1")).toBe(false);
  });

  it("boolean 이 아닌 값은 버린다", () => {
    expect(isShowHidden({ a: true }, "a")).toBe(true);
    // 타입에 안 맞는 값이 들어와도 true 로 오인하지 않는다.
    expect(
      isShowHidden({ a: "yes" } as unknown as Record<string, boolean>, "a"),
    ).toBe(false);
  });
});
