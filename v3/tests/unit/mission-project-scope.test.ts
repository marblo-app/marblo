import { describe, it, expect } from "vitest";
import {
  chunkProjectIds,
  MISSION_PROJECT_CHUNK_SIZE,
} from "../../electron/mission-engine/mission-project-scope";

// 티켓 Ciriq5ASEvAlA8TnKxhW — missions 룰이 멤버 스코프가 되면서 mission-engine 의
// 무스코프 구독을 `where(projectId,in,[...])` 로 바꿨다. 이 헬퍼가 깨지면 구독이
// 조용히 죽거나(빈 배열을 in 에 넘겨 SDK throw) 상한 초과로 런타임에 죽는다.

describe("chunkProjectIds", () => {
  it("빈 입력은 빈 청크 — 호출부가 쿼리를 아예 쏘지 않게 한다", () => {
    // Firestore 는 `in` 에 빈 배열을 주면 invalid-argument 로 던진다. 그래서
    // "청크 0개" 가 곧 "구독하지 마라" 신호여야 한다.
    expect(chunkProjectIds([])).toEqual([]);
    expect(chunkProjectIds(["", "   "])).toEqual([]);
  });

  it("상한 이하면 한 청크", () => {
    expect(chunkProjectIds(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });

  it("★in 상한을 넘으면 쪼갠다 — 안 쪼개면 런타임 invalid-argument", () => {
    const ids = Array.from({ length: 31 }, (_, i) => `p${i}`);
    const chunks = chunkProjectIds(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MISSION_PROJECT_CHUNK_SIZE);
    expect(chunks[1]).toEqual(["p30"]);
    // 어떤 id 도 잃지 않는다 — 잃으면 그 프로젝트의 미션이 조용히 안 잡힌다.
    expect(chunks.flat()).toEqual(ids);
  });

  it("중복과 공백을 걷어낸다 — 둘 다 in 슬롯만 축낸다", () => {
    expect(chunkProjectIds(["a", "a", " a ", "", "b"])).toEqual([["a", "b"]]);
  });

  it("경계값: 정확히 상한이면 한 청크", () => {
    const ids = Array.from(
      { length: MISSION_PROJECT_CHUNK_SIZE },
      (_, i) => `p${i}`,
    );
    expect(chunkProjectIds(ids)).toHaveLength(1);
  });
});
