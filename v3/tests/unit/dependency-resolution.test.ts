// N4 회귀 테스트 — 의존성 해소 비트랜잭션 중복/스트랜딩 방어.
//
// resolveDependentIfReady(db, dependentId, completedTaskId) 가 후행 task 의
// dependsOnCompleted 를 "모든 선행이 DONE 일 때 단 한 번만" 멱등하게 flip 하는지
// 검증한다. 핵심은 동시 완료 race 에서 단 하나의 호출만 unblocked=true 를 받아
// 오케스트레이터 notify(=디스패치)가 중복되지 않는 것.
//
// tools.ts 는 ./firebase.js → real firebase/auth 를 끌어와 유닛테스트에서 import
// 할 수 없으므로(force-block-projection.test.ts 와 동일 제약), db-injected 로 뽑아
// 낸 projection.ts 의 함수를 같은 in-memory firestore mock 하니스로 직접 검증한다.

import { describe, it, expect, beforeEach } from "vitest";
// `firebase/firestore` 는 vitest.config 에서 in-memory mock 으로 alias 되어 있어
// 아래 seed/read 헬퍼와 resolveDependentIfReady 가 같은 store 를 공유한다.
import { doc, setDoc, getDoc, __resetStore } from "../mocks/firebase-firestore";
import { resolveDependentIfReady } from "../../electron/mcp-server/projection";

// mock 의 doc()/runTransaction() 은 db 인자를 무시하므로 더미면 충분.
const db = {} as never;

interface SeedFields {
  status?: string;
  dependsOn?: string[];
  dependsOnCompleted?: boolean;
  title?: string;
  role?: string;
}

async function seedTask(id: string, fields: SeedFields = {}): Promise<void> {
  await setDoc(doc(db, "tasks", id), { status: "TODO", ...fields });
}

async function readFlag(id: string): Promise<boolean | undefined> {
  const snap = await getDoc(doc(db, "tasks", id));
  return (snap.data() as { dependsOnCompleted?: boolean } | null)
    ?.dependsOnCompleted;
}

beforeEach(() => __resetStore());

describe("resolveDependentIfReady (N4)", () => {
  it("모든 선행이 DONE 이면 flag 를 flip 하고 unblocked=true + 메타 반환", async () => {
    await seedTask("T", {
      dependsOn: ["D1", "D2"],
      dependsOnCompleted: false,
      title: "downstream task",
      role: "backend",
    });
    await seedTask("D1", { status: "DONE" });
    await seedTask("D2", { status: "DONE" });

    const res = await resolveDependentIfReady(db, "T", "D1");

    expect(res.unblocked).toBe(true);
    expect(res.title).toBe("downstream task");
    expect(res.role).toBe("backend");
    expect(await readFlag("T")).toBe(true);
  });

  it("동시 완료 race: 두 선행이 각각 호출해도 unblock 은 정확히 한 번만 발생(중복 디스패치 차단)", async () => {
    // T 가 D1·D2 에 의존하고 둘 다 막 DONE 된 상황. 비원자 버전이라면 두 핸들러가
    // 모두 stale false 를 읽어 둘 다 unblocked=true → 오케 중복 디스패치였다.
    await seedTask("T", {
      dependsOn: ["D1", "D2"],
      dependsOnCompleted: false,
      title: "T",
      role: "backend",
    });
    await seedTask("D1", { status: "DONE" });
    await seedTask("D2", { status: "DONE" });

    // D1 완료 핸들러
    const first = await resolveDependentIfReady(db, "T", "D1");
    // D2 완료 핸들러(=race 의 패자). 트랜잭션 내 재검사로 flag 가 이미 true.
    const second = await resolveDependentIfReady(db, "T", "D2");

    const unblockCount = [first, second].filter((r) => r.unblocked).length;
    expect(unblockCount).toBe(1);
    expect(first.unblocked).toBe(true);
    expect(second.unblocked).toBe(false);
    expect(await readFlag("T")).toBe(true);
  });

  it("아직 안 끝난 선행이 있으면 flip 하지 않고 unblocked=false (flag 유지)", async () => {
    await seedTask("T", {
      dependsOn: ["D1", "D2"],
      dependsOnCompleted: false,
    });
    await seedTask("D1", { status: "DONE" });
    await seedTask("D2", { status: "IN_PROGRESS" }); // 미완

    const res = await resolveDependentIfReady(db, "T", "D1");

    expect(res.unblocked).toBe(false);
    expect(await readFlag("T")).toBe(false);
  });

  it("이미 해소된 후행(dependsOnCompleted=true)은 재-notify 하지 않는다(멱등 short-circuit)", async () => {
    await seedTask("T", {
      dependsOn: ["D1"],
      dependsOnCompleted: true,
    });
    await seedTask("D1", { status: "DONE" });

    const res = await resolveDependentIfReady(db, "T", "D1");
    expect(res.unblocked).toBe(false);
  });

  it("후행 문서가 없으면 throw 없이 unblocked=false (호출부 루프가 스트랜드되지 않게)", async () => {
    const res = await resolveDependentIfReady(db, "ghost", "D1");
    expect(res.unblocked).toBe(false);
  });

  it("해소를 촉발한 선행(completedTaskId)은 DONE 으로 간주해 재조회를 생략한다", async () => {
    // 트리거 task D1 자체는 (이 시점 store 상) 아직 DONE 이 아니어도 — 호출부가
    // 자기 status 커밋 직후 호출하는 의미론 — 트리거로 간주해 만족 처리한다.
    await seedTask("T", {
      dependsOn: ["D1"],
      dependsOnCompleted: false,
      title: "only-dep",
      role: "test",
    });
    await seedTask("D1", { status: "IN_PROGRESS" });

    const res = await resolveDependentIfReady(db, "T", "D1");

    expect(res.unblocked).toBe(true);
    expect(await readFlag("T")).toBe(true);
  });
});
