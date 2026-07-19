// P0 회귀 테스트 — 의존성 게이트 오탐(선행 DONE 인데 BLOCKED 로 되돌림).
//
// 버그: `dependsOnCompleted` 는 "선행이 DONE 으로 전이하는 순간"에만 flip 되는
// edge-trigger 플래그인데, create_task 는 선행의 현재 status 를 보지 않고
// `deps.length === 0` 으로만 시드했다. 그래서 **이미 DONE 인 A** 를 depends_on 으로
// 걸고 B 를 만들면 flip 을 촉발할 전이가 영영 없어 플래그가 false 로 고착되고,
// dispatch/claim 게이트가 B 를 영구 차단했다. 반면 get_task_dependencies 는 선행
// status 를 매번 읽는 level-trigger 라 "충족"이라 답해 두 경로가 갈렸다.
//
// tools.ts 는 ./firebase.js → real firebase/auth 를 끌어와 유닛테스트에서 import 할
// 수 없으므로(dependency-resolution.test.ts 와 동일 제약), 판정 로직을 db-injected
// 로 뽑아낸 projection.ts 의 함수로 검증한다.

import { describe, it, expect, beforeEach } from "vitest";
import { doc, setDoc, getDoc, __resetStore } from "../mocks/firebase-firestore";
import {
  areDependenciesComplete,
  isDependencyGateOpen,
} from "../../electron/mcp-server/projection";

const db = {} as never;

async function seedTask(
  id: string,
  fields: { status?: string; dependsOn?: string[] } = {},
): Promise<void> {
  await setDoc(doc(db, "tasks", id), { status: "TODO", ...fields });
}

async function readFlag(id: string): Promise<boolean | undefined> {
  const snap = await getDoc(doc(db, "tasks", id));
  return (snap.data() as { dependsOnCompleted?: boolean } | null)
    ?.dependsOnCompleted;
}

beforeEach(() => __resetStore());

describe("areDependenciesComplete (level-trigger 판정)", () => {
  it("의존이 없으면 충족", async () => {
    expect(await areDependenciesComplete(db, [])).toBe(true);
  });

  it("모든 선행이 DONE 이면 충족", async () => {
    await seedTask("A", { status: "DONE" });
    await seedTask("B", { status: "DONE" });
    expect(await areDependenciesComplete(db, ["A", "B"])).toBe(true);
  });

  it("하나라도 미완이면 미충족", async () => {
    await seedTask("A", { status: "DONE" });
    await seedTask("B", { status: "IN_PROGRESS" });
    expect(await areDependenciesComplete(db, ["A", "B"])).toBe(false);
  });

  it("존재하지 않는 선행은 미충족 (get_task_dependencies 와 동일 판정)", async () => {
    expect(await areDependenciesComplete(db, ["ghost"])).toBe(false);
  });
});

describe("isDependencyGateOpen — 사용자 재현 절차", () => {
  it("★A 를 먼저 DONE 시킨 뒤 만든 B(플래그 stale false)의 게이트가 열린다", async () => {
    // 재현: A 생성 → DONE → B 를 depends_on:[A] 로 생성.
    // B 생성 시점엔 A 의 DONE '전이'가 이미 지나가 flip 이 영영 안 걸린다.
    await seedTask("A", { status: "DONE" });
    const staleB = {
      id: "B",
      dependsOn: ["A"],
      dependsOnCompleted: false, // 버그 재현: 고착된 플래그
    };

    expect(await isDependencyGateOpen(db, staleB)).toBe(true);
  });

  it("게이트 판정이 get_task_dependencies 의 라이브 판정과 항상 일치한다(조회/게이트 모순 차단)", async () => {
    await seedTask("A", { status: "DONE" });
    await seedTask("C", { status: "REVIEW" });

    for (const deps of [["A"], ["C"], ["A", "C"], ["ghost"], []]) {
      const live = await areDependenciesComplete(db, deps);
      const gate = await isDependencyGateOpen(db, {
        id: "X",
        dependsOn: deps,
        dependsOnCompleted: false,
      });
      expect(gate).toBe(live);
    }
  });

  it("선행이 미완이면 게이트는 닫힌 채로 유지된다(가드 무력화 아님)", async () => {
    await seedTask("A", { status: "IN_PROGRESS" });
    expect(
      await isDependencyGateOpen(db, {
        id: "B",
        dependsOn: ["A"],
        dependsOnCompleted: false,
      }),
    ).toBe(false);
  });

  it("플래그가 이미 true 면 선행을 조회하지 않고 즉시 통과(fast path)", async () => {
    // 선행 문서를 아예 seed 하지 않았는데도 통과 = 라이브 조회를 타지 않았다는 증거.
    expect(
      await isDependencyGateOpen(db, {
        id: "B",
        dependsOn: ["never-seeded"],
        dependsOnCompleted: true,
      }),
    ).toBe(true);
  });

  it("의존이 없는데 플래그만 false 인 손상 문서도 통과", async () => {
    expect(
      await isDependencyGateOpen(db, {
        id: "B",
        dependsOn: [],
        dependsOnCompleted: false,
      }),
    ).toBe(true);
  });

  it("heal: stale false 플래그를 그 자리에서 true 로 자가치유한다(기존 고착 티켓 구제)", async () => {
    await seedTask("A", { status: "DONE" });
    await setDoc(doc(db, "tasks", "B"), {
      status: "TODO",
      dependsOn: ["A"],
      dependsOnCompleted: false,
    });

    expect(
      await isDependencyGateOpen(
        db,
        { id: "B", dependsOn: ["A"], dependsOnCompleted: false },
        { heal: true },
      ),
    ).toBe(true);
    expect(await readFlag("B")).toBe(true);
  });

  it("heal: 선행이 미완이면 플래그를 건드리지 않는다", async () => {
    await seedTask("A", { status: "IN_PROGRESS" });
    await setDoc(doc(db, "tasks", "B"), {
      status: "TODO",
      dependsOn: ["A"],
      dependsOnCompleted: false,
    });

    expect(
      await isDependencyGateOpen(
        db,
        { id: "B", dependsOn: ["A"], dependsOnCompleted: false },
        { heal: true },
      ),
    ).toBe(false);
    expect(await readFlag("B")).toBe(false);
  });
});
