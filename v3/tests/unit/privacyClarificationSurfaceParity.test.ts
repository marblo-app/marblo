/**
 * 심플 ↔ 어드밴스드 **고지** 표면 PARITY 가드 (ticket woXp2c70oR0tliGB8Vs6).
 *
 * trainingConsentSurfaceParity 와 같은 이유·같은 방식이다: 심플 셸은
 * GlobalOverlays 를 마운트하지 않으므로 "GlobalOverlays 에만 넣으면 양쪽에 간다"
 * 가 성립하지 않는다. 한쪽에만 배선되면 "심플로 쓰는 사람은 처리방침이 바뀐 걸
 * 끝내 못 본다" 가 되고, 그건 UI 취향이 아니라 고지 의무 쪽 결함이다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../../src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8");

const GLOBAL_OVERLAYS = read("components/GlobalOverlays.tsx");
const BEGINNER_SHELL = read("components/beginner/BeginnerShell.tsx");
const NOTICE = read("components/legal/PrivacyClarificationNotice.tsx");

describe("처리방침 명확화 고지 — 심플/어드밴스드 배선", () => {
  it("어드밴스드 셸 경로(GlobalOverlays)가 배너를 마운트한다", () => {
    expect(GLOBAL_OVERLAYS).toMatch(/<PrivacyClarificationNotice\b/);
    expect(GLOBAL_OVERLAYS).toMatch(
      /import\s*\{\s*PrivacyClarificationNotice\s*\}\s*from\s*["']\.\/legal\/PrivacyClarificationNotice["']/,
    );
  });

  it("심플 셸(BeginnerShell)도 같은 배너를 마운트한다", () => {
    expect(BEGINNER_SHELL).toMatch(/<PrivacyClarificationNotice\b/);
    expect(BEGINNER_SHELL).toMatch(
      /import\s*\{\s*PrivacyClarificationNotice\s*\}\s*from\s*["']\.\.\/legal\/PrivacyClarificationNotice["']/,
    );
  });

  it("두 표면은 같은 컴포넌트를 쓴다 (복제본 금지)", () => {
    expect(NOTICE).toMatch(/export function PrivacyClarificationNotice/);
    for (const source of [GLOBAL_OVERLAYS, BEGINNER_SHELL]) {
      expect(source.match(/<PrivacyClarificationNotice\b/g)?.length ?? 0).toBe(
        1,
      );
    }
  });
});
