/**
 * @vitest-environment jsdom
 *
 * 계정 격리 회귀 가드 — 티켓 GOiAnCMjqrEPNcmBaiBY (P0).
 *
 * 증상: datagadapida 로 로그인했는데 이전 계정(john.kim)의 프로젝트가 리스트에
 * 보였다. 심각도 판정 결과는 **(a) 렌더러 스테일 상태**다 — Firestore rules 는
 * 멤버 격리를 지키고 있고(firestore.rules.test.ts "projects 계정 격리 (list
 * 쿼리)"), 이전 계정 uid 로 스코프한 쿼리조차 permission-denied 로 떨어진다.
 * 즉 서버는 fail-closed 였고, 남의 프로젝트를 화면에 남긴 건 **클라이언트가 이전
 * 계정의 스냅샷 결과를 그대로 들고 있었기 때문**이다.
 *
 * 이 파일이 못 박는 불변식:
 *   1. 계정이 바뀌면 projectStore 는 새 스냅샷을 기다리지 않고 **즉시** 빈다.
 *      (한 프레임이라도 새 uid + 옛 계정 데이터로 렌더되면 그게 곧 누출이다)
 *   2. 구독은 항상 live 현재 uid 로만 스코프된다.
 *   3. 이전 구독의 늦은 스냅샷은 스토어에 절대 쓰이지 않는다(uid 스탬프 가드).
 *   4. 계정 귀속 스토어 전체를 지우는 단일 초크포인트가 존재한다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type SnapshotCb = (docs: Array<Record<string, unknown>>) => void;

interface CapturedSubscription {
  collectionName: string;
  constraints: Array<{ type?: string; field?: string; value?: unknown }>;
  callback: SnapshotCb;
  unsubscribed: boolean;
}

const subscriptions: CapturedSubscription[] = [];

// `lib/firebase` 는 import 만으로 initializeAuth 를 부른다(다른 스토어 테스트와
// 동일한 처리 — VITE_FIREBASE_* 없이는 그 자리에서 터진다).
vi.mock("../../src/lib/firebase", () => ({
  db: {},
  auth: {},
  functions: {},
  app: {},
  isPackagedLoopbackAuth: false,
  FIREBASE_FUNCTIONS_REGION: "us-central1",
}));

// services/firestore 는 lib/firebase(실제 Firebase 앱 초기화)를 끌고 온다.
// importActual 로 부분 mock 하면 그 초기화가 테스트 환경에서 터지므로, 이
// 테스트가 실제로 쓰는 표면만 손으로 세운다. convertTimestamps/toTimestamp 는
// 순수 함수라 그대로 재현해도 의미가 보존된다.
vi.mock("../../src/services/firestore", () => ({
  subscribeToCollection: (
    collectionName: string,
    constraints: CapturedSubscription["constraints"],
    callback: SnapshotCb,
  ) => {
    const sub: CapturedSubscription = {
      collectionName,
      constraints,
      callback,
      unsubscribed: false,
    };
    subscriptions.push(sub);
    return () => {
      sub.unsubscribed = true;
    };
  },
  subscribeToDocument: () => () => {},
  convertTimestamps: (data: Record<string, unknown>) => ({ ...data }),
  toTimestamp: (d: Date) => d,
  toDate: (v: unknown) => v as Date,
  getDocument: async () => null,
  queryDocuments: async () => [],
  createDocument: async () => "mock-id",
  setDocument: async () => {},
  mergeDocument: async () => {},
  updateDocument: async () => {},
  deleteDocument: async () => {},
}));

const { useProjectStore } = await import("../../src/stores/projectStore");
const { useTaskStore } = await import("../../src/stores/taskStore");
const { useAgentStore } = await import("../../src/stores/agentStore");
const { resetAccountScopedState } = await import("../../src/lib/accountScope");

function projectDoc(id: string, ownerId: string) {
  return {
    id,
    name: id,
    ownerId,
    members: [ownerId],
    folderPath: `/repo/${id}`,
  };
}

/** 이 구독의 members array-contains 값 = 실제로 쿼리에 쓰인 uid. */
function scopedUid(sub: CapturedSubscription): unknown {
  return sub.constraints.find((c) => c.field === "members")?.value;
}

function liveSubscriptions(): CapturedSubscription[] {
  return subscriptions.filter((s) => !s.unsubscribed);
}

beforeEach(() => {
  subscriptions.length = 0;
  useProjectStore.setState({
    projects: [],
    currentProject: null,
    autoSelectFirstProject: true,
    loading: false,
    projectsHydrated: false,
    error: null,
  });
  useTaskStore.setState({ tasks: [] });
  useAgentStore.setState({ agents: [], ownedAgents: [] });
});

describe("계정 전환 시 프로젝트 리스트 격리", () => {
  it("새 계정으로 재구독하면 이전 계정 프로젝트가 즉시 사라진다", () => {
    const store = useProjectStore.getState();

    // 1) john.kim 세션 — 프로젝트가 리스트에 실린다.
    const unsubJohn = store.subscribeToProjects("john-uid");
    subscriptions[0].callback([projectDoc("music-composer", "john-uid")]);
    expect(useProjectStore.getState().projects.map((p) => p.id)).toEqual([
      "music-composer",
    ]);
    expect(useProjectStore.getState().currentProject?.id).toBe(
      "music-composer",
    );

    // 2) 로그아웃 → 새 계정 로그인.
    unsubJohn();
    useProjectStore.getState().subscribeToProjects("datagadapida-uid");

    // ★스냅샷이 오기 **전에** 이미 비어 있어야 한다. 새 계정 uid 로 렌더되는
    //   어떤 프레임에서도 이전 계정 데이터가 보이면 안 된다.
    const after = useProjectStore.getState();
    expect(after.projects).toEqual([]);
    expect(after.currentProject).toBeNull();
    expect(after.projectsHydrated).toBe(false);
  });

  it("구독은 항상 live 현재 uid 로 스코프되고 이전 구독은 해제된다", () => {
    const unsubJohn = useProjectStore
      .getState()
      .subscribeToProjects("john-uid");
    expect(scopedUid(subscriptions[0])).toBe("john-uid");

    unsubJohn();
    useProjectStore.getState().subscribeToProjects("datagadapida-uid");

    expect(subscriptions[0].unsubscribed).toBe(true);
    const live = liveSubscriptions();
    expect(live).toHaveLength(1);
    expect(scopedUid(live[0])).toBe("datagadapida-uid");
  });

  it("이전 구독의 늦은 스냅샷은 스토어에 쓰이지 않는다", () => {
    const unsubJohn = useProjectStore
      .getState()
      .subscribeToProjects("john-uid");
    const johnSnapshot = subscriptions[0].callback;

    unsubJohn();
    useProjectStore.getState().subscribeToProjects("datagadapida-uid");

    // 해제된 뒤 뒤늦게 도착한 john 스냅샷 — 삼켜져야 한다.
    johnSnapshot([projectDoc("music-composer", "john-uid")]);
    expect(useProjectStore.getState().projects).toEqual([]);
  });

  it("새 계정 스냅샷이 비어 있으면 리스트도 비어 있다", () => {
    vi.useFakeTimers();
    try {
      const unsubJohn = useProjectStore
        .getState()
        .subscribeToProjects("john-uid");
      subscriptions[0].callback([projectDoc("music-composer", "john-uid")]);
      unsubJohn();

      useProjectStore.getState().subscribeToProjects("datagadapida-uid");
      // 콜드스타트 재시도(300/800/1500ms)를 전부 소진시킨다 — 새 계정은 정말로
      // 프로젝트가 0개다.
      for (let i = 0; i < 5; i += 1) {
        const live = liveSubscriptions();
        if (live.length > 0) live[live.length - 1].callback([]);
        vi.advanceTimersByTime(2000);
      }

      const after = useProjectStore.getState();
      expect(after.projects).toEqual([]);
      expect(after.currentProject).toBeNull();
      expect(after.projectsHydrated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("같은 uid 로 재구독하면 선택된 프로젝트를 유지한다(세션 복원 보존)", () => {
    const unsub = useProjectStore.getState().subscribeToProjects("john-uid");
    subscriptions[0].callback([projectDoc("music-composer", "john-uid")]);
    unsub();

    useProjectStore.getState().subscribeToProjects("john-uid");
    expect(useProjectStore.getState().currentProject?.id).toBe(
      "music-composer",
    );
  });
});

describe("계정 귀속 상태 초크포인트", () => {
  it("resetAccountScopedState 가 프로젝트·보드·에이전트를 한 번에 비운다", () => {
    const unsub = useProjectStore.getState().subscribeToProjects("john-uid");
    subscriptions[0].callback([projectDoc("music-composer", "john-uid")]);
    useTaskStore.setState({
      tasks: [{ id: "t1", projectId: "music-composer" }] as never,
    });
    useAgentStore.setState({
      agents: [{ id: "a1", projectId: "music-composer" }] as never,
      ownedAgents: [{ id: "a1", projectId: "music-composer" }] as never,
    });

    // 인자는 **새로 채택하는** uid 다(티켓 E3ywX1ftbVr5f1TrFsgp에서 추가). 온보딩
    // 판정을 그 계정에 귀속시키기 위한 것이고, 여기서 보는 클리어 계약과는 무관.
    resetAccountScopedState("datagadapida-uid");

    expect(useProjectStore.getState().projects).toEqual([]);
    expect(useProjectStore.getState().currentProject).toBeNull();
    expect(useProjectStore.getState().projectsHydrated).toBe(false);
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useAgentStore.getState().ownedAgents).toEqual([]);
    unsub();
  });

  it("초크포인트 이후 도착한 이전 계정 스냅샷도 무시된다", () => {
    const unsub = useProjectStore.getState().subscribeToProjects("john-uid");
    const johnSnapshot = subscriptions[0].callback;
    johnSnapshot([projectDoc("music-composer", "john-uid")]);

    resetAccountScopedState("datagadapida-uid");
    johnSnapshot([projectDoc("music-composer", "john-uid")]);

    expect(useProjectStore.getState().projects).toEqual([]);
    unsub();
  });
});
