/**
 * 완료 컬럼 "최근 완료순" 정렬 — lib/boardSort.ts.
 *
 * 계약(티켓 MThqQ62n):
 *   ① completedAt 이 있으면 그것이 축. 최근 완료가 위.
 *   ② completedAt 없는 옛 티켓은 updatedAt 폴백 — 섞여도 한 축으로 정렬된다.
 *   ③ updatedAt 이 더 최신이어도 completedAt 이 있으면 completedAt 을 믿는다
 *     (완료 후 코멘트 하나 달았다고 맨 위로 튀지 않는다 — 이 티켓의 동기).
 *   ④ 동률은 입력 순서 유지, 입력 배열 불변.
 */
import { describe, expect, it } from "vitest";
import { completedAtOf, sortDoneTasks } from "../../src/lib/boardSort";

const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
const HOUR = 3_600_000;

function done(
  id: string,
  opts: { completedAt?: Date | null; updatedAt: Date },
): { id: string; completedAt?: Date | null; updatedAt: Date } {
  return { id, ...opts };
}

describe("completedAtOf — 축 선택", () => {
  it("completedAt 이 있으면 그것", () => {
    const t = done("a", {
      completedAt: new Date(T0 + HOUR),
      updatedAt: new Date(T0 + 5 * HOUR),
    });
    expect(completedAtOf(t)).toBe(T0 + HOUR);
  });

  it("completedAt 이 없으면(undefined/null) updatedAt 폴백", () => {
    expect(completedAtOf(done("a", { updatedAt: new Date(T0) }))).toBe(T0);
    expect(
      completedAtOf(done("a", { completedAt: null, updatedAt: new Date(T0) })),
    ).toBe(T0);
  });

  it("깨진 Date 는 0 — 맨 아래로", () => {
    expect(
      completedAtOf(
        done("a", {
          completedAt: new Date("not a date"),
          updatedAt: new Date("also not"),
        }),
      ),
    ).toBe(0);
  });
});

describe("sortDoneTasks — 완료 컬럼 순서", () => {
  it("최상단이 가장 최근 완료 티켓", () => {
    const older = done("older", {
      completedAt: new Date(T0),
      updatedAt: new Date(T0),
    });
    const newest = done("newest", {
      completedAt: new Date(T0 + 3 * HOUR),
      updatedAt: new Date(T0 + 3 * HOUR),
    });
    const mid = done("mid", {
      completedAt: new Date(T0 + HOUR),
      updatedAt: new Date(T0 + HOUR),
    });
    expect(sortDoneTasks([older, newest, mid]).map((t) => t.id)).toEqual([
      "newest",
      "mid",
      "older",
    ]);
  });

  it("완료 후 코멘트로 updatedAt 만 갱신된 옛 티켓은 위로 튀지 않는다", () => {
    const oldButTouched = done("old-touched", {
      completedAt: new Date(T0),
      updatedAt: new Date(T0 + 10 * HOUR), // 오늘 코멘트 달아서 갱신됨
    });
    const recent = done("recent", {
      completedAt: new Date(T0 + 2 * HOUR),
      updatedAt: new Date(T0 + 2 * HOUR),
    });
    expect(sortDoneTasks([oldButTouched, recent]).map((t) => t.id)).toEqual([
      "recent",
      "old-touched",
    ]);
  });

  it("completedAt 없는 기존 티켓(폴백)도 한 축으로 섞여 정렬된다", () => {
    const legacyOld = done("legacy-old", { updatedAt: new Date(T0) });
    const legacyNew = done("legacy-new", {
      updatedAt: new Date(T0 + 4 * HOUR),
    });
    const withField = done("with-field", {
      completedAt: new Date(T0 + 2 * HOUR),
      updatedAt: new Date(T0 + 2 * HOUR),
    });
    expect(
      sortDoneTasks([legacyOld, withField, legacyNew]).map((t) => t.id),
    ).toEqual(["legacy-new", "with-field", "legacy-old"]);
  });

  it("동률은 입력 순서 유지(안정), 입력 배열은 그대로", () => {
    const a = done("a", { updatedAt: new Date(T0) });
    const b = done("b", { updatedAt: new Date(T0) });
    const c = done("c", { updatedAt: new Date(T0) });
    const input = [a, b, c];
    const out = sortDoneTasks(input);
    expect(out.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(input);
    expect(input.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});
