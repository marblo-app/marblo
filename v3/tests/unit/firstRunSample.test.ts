import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  SAMPLE_SEED_ATTEMPTED_KEY,
  hasAttemptedSampleSeed,
  rememberSampleSeedAttempt,
  shouldSeedSampleProject,
  type SampleSeedGate,
} from "../../src/lib/firstRunSample";

/** 첫 실행 그 자체 — 이 상태에서만 자동 시드가 일어나야 한다. */
const FIRST_RUN: SampleSeedGate = {
  signedIn: true,
  projectsHydrated: true,
  projectCount: 0,
  hasRootPath: false,
  hasCurrentProject: false,
  isNewWindow: false,
  alreadyAttempted: false,
  hasRestoreTarget: false,
};

describe("shouldSeedSampleProject", () => {
  it("seeds on a genuine first run", () => {
    expect(shouldSeedSampleProject(FIRST_RUN)).toBe(true);
  });

  // 아래는 전부 "이미 자기 것을 쓰는 사람을 건드리지 않는다" 의 각 면이다.
  const refusals: Array<[string, Partial<SampleSeedGate>]> = [
    // 프로젝트 생성은 ownerId 를 요구한다 — 로그인 전엔 등록 자체가 불가능.
    ["not signed in yet", { signedIn: false }],
    // ★가장 위험한 칸: 콜드 스타트의 빈 스냅샷을 "프로젝트 없음" 으로 오독하면
    //   복귀 유저의 창이 샘플로 갈아타 버린다.
    ["the projects snapshot has not settled", { projectsHydrated: false }],
    ["the account already has a project", { projectCount: 1 }],
    ["a project is already selected", { hasCurrentProject: true }],
    ["this window already has a folder open", { hasRootPath: true }],
    // ★hasRootPath 와 다른 칸이다: 복원은 main 왕복 뒤에 rootPath 를 세우므로,
    //   그 전에 판단하면 "폴더 없는 신규 유저" 로 보인다. 복원 대상이 있다는
    //   사실만으로 물러서야 쓰던 폴더가 샘플로 갈아치워지지 않는다(E2E Z6).
    ["this window is about to restore a folder", { hasRestoreTarget: true }],
    // Cmd+Shift+N 은 "내가 직접 고르겠다" 는 의사표시다.
    ["it is a deliberately opened new window", { isNewWindow: true }],
    // 샘플을 지운 사용자에게 되살아나면 그건 버그다.
    ["this machine already tried once", { alreadyAttempted: true }],
  ];

  for (const [why, patch] of refusals) {
    it(`refuses when ${why}`, () => {
      expect(shouldSeedSampleProject({ ...FIRST_RUN, ...patch })).toBe(false);
    });
  }

  it("refuses when several conditions fail at once", () => {
    expect(
      shouldSeedSampleProject({
        ...FIRST_RUN,
        signedIn: false,
        projectCount: 3,
        hasRootPath: true,
      }),
    ).toBe(false);
  });
});

describe("the per-machine attempt marker", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips the seeded path", () => {
    expect(hasAttemptedSampleSeed()).toBe(false);
    rememberSampleSeedAttempt("/Users/t/Documents/Marblo Sample");
    expect(hasAttemptedSampleSeed()).toBe(true);
    expect(store[SAMPLE_SEED_ATTEMPTED_KEY]).toBe(
      "/Users/t/Documents/Marblo Sample",
    );
  });

  it("survives an unusable localStorage without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    });

    // 읽기 실패는 "안 했다" 로 본다 — 세션 내 반복은 훅의 ref 가 막으므로
    // 최악이라도 실행마다 1회, 그리고 시드 자체가 멱등이다.
    expect(hasAttemptedSampleSeed()).toBe(false);
    expect(() => rememberSampleSeedAttempt("/x")).not.toThrow();
  });
});
