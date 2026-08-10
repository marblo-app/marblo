/**
 * 스토어 별점 산식의 계약. 이 스위트가 지키는 것은 "별점이 **방어 가능**한가"다 —
 * 회귀 위험은 넷:
 *  1. 임의성: 같은 입력이 다른 별을 내는 것(벽시계·네트워크가 산식에 새는 것),
 *  2. 역인센티브: 신호를 **감추는 게 이득**이 되는 것(업스트림 레포를 지우면
 *     감점을 피한다든가),
 *  3. 정책 우회: 비OSI·회수 항목이 인기로 상단에 올라오는 것,
 *  4. 보안 판정과의 불일치: 설치가 거부되는 항목이 별 다섯을 받는 것.
 */
import { describe, it, expect } from "vitest";
import {
  computeRegistryRating,
  isKnownNonOsiLicense,
  isOsiApprovedLicense,
  rateRegistryItems,
  usefulnessFromStars,
  RATING_WEIGHTS,
  type RatingInput,
} from "../../electron/registry-rating";
import type { RegistryStarsSnapshot } from "../../electron/data/registry-stars-snapshot";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

/** 고정 스냅샷 — 테스트는 커밋된 실제 스냅샷에 의존하지 않는다(스타는 변한다). */
function snapshot(
  repos: RegistryStarsSnapshot["repos"] = {},
): RegistryStarsSnapshot {
  return {
    collectedAt: "2026-08-10T00:00:00Z",
    registryCommit: "c".repeat(40),
    repos,
  };
}

function upstream(
  over: Partial<RegistryStarsSnapshot["repos"][string]> = {},
): RegistryStarsSnapshot["repos"][string] {
  return {
    stars: 1000,
    pushedAt: "2026-08-01T00:00:00Z",
    archived: false,
    license: "MIT",
    headSha: OTHER_SHA,
    ...over,
  };
}

/** 전 성분 만점에 가까운 기준 항목 — 여기서 한 신호씩 빼며 영향을 잰다. */
function item(over: Partial<RatingInput> = {}): RatingInput {
  return {
    sourceRepository: "https://github.com/acme/widget",
    sourceRef: SHA,
    license: "MIT",
    status: "active",
    install: {
      kind: "files",
      root: "claude-skills",
      dest: "widget",
      files: ["SKILL.md"],
      integrity: { "SKILL.md": "d".repeat(64) },
    },
    installDerived: false,
    ...over,
  };
}

const SNAP = snapshot({ "acme/widget": upstream() });

describe("usefulnessFromStars — 로그 스케일 앵커", () => {
  // 산식 문서(docs/store-rating.md)가 약속하는 값들. "10배마다 0.2" 가 깨지면
  // 별점 설명 전체가 거짓말이 된다.
  it("스타 10배마다 0.2 씩 오른다", () => {
    expect(usefulnessFromStars(0)).toBe(0);
    expect(usefulnessFromStars(9)).toBeCloseTo(0.2, 2);
    expect(usefulnessFromStars(99)).toBeCloseTo(0.4, 2);
    expect(usefulnessFromStars(999)).toBeCloseTo(0.6, 2);
    expect(usefulnessFromStars(9999)).toBeCloseTo(0.8, 2);
    expect(usefulnessFromStars(99999)).toBeCloseTo(1.0, 2);
  });

  it("100k 를 넘어도 1.0 을 넘지 않는다 — 상위 몇 개가 스케일을 삼키지 않게", () => {
    expect(usefulnessFromStars(270000)).toBe(1);
    expect(usefulnessFromStars(Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it("음수·NaN 같은 쓰레기 입력은 0", () => {
    expect(usefulnessFromStars(-5)).toBe(0);
    expect(usefulnessFromStars(Number.NaN)).toBe(0);
  });
});

describe("결정성 — 같은 입력이면 언제 불러도 같은 별점", () => {
  it("벽시계를 읽지 않는다(스냅샷의 collectedAt 이 기준 시계)", () => {
    const a = computeRegistryRating(item(), SNAP);
    const b = computeRegistryRating(item(), SNAP);
    expect(a).toEqual(b);
  });

  it("입력 객체를 변형하지 않는다", () => {
    const input = item();
    const before = JSON.stringify(input);
    computeRegistryRating(input, SNAP);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rateRegistryItems 는 원본 배열·객체를 그대로 두고 새 객체를 만든다", () => {
    const items = [item({ license: "MIT" })];
    const rated = rateRegistryItems(items, SNAP);
    expect(rated[0]).not.toBe(items[0]);
    expect(rated[0].rating.stars).toBeGreaterThanOrEqual(1);
    expect("rating" in items[0]).toBe(false);
  });
});

describe("유용성 — 업스트림 스타", () => {
  it("스타가 많을수록 별이 높다(다른 신호가 같을 때)", () => {
    const hi = computeRegistryRating(
      item(),
      snapshot({ "acme/widget": upstream({ stars: 50000 }) }),
    );
    const lo = computeRegistryRating(
      item(),
      snapshot({ "acme/widget": upstream({ stars: 5 }) }),
    );
    expect(hi.stars).toBeGreaterThan(lo.stars);
    expect(hi.upstreamStars).toBe(50000);
  });

  it("★업스트림을 선언했는데 스냅샷에 없으면 0 점이다 — 레포를 감추는 게 이득이 되면 안 된다", () => {
    const missing = computeRegistryRating(item(), snapshot({}));
    const declared = computeRegistryRating(
      item({ sourceRepository: undefined, sourceRef: undefined }),
      snapshot({}),
    );
    const usefulness = missing.components.find((c) => c.key === "usefulness");
    expect(usefulness?.value).toBe(0);
    expect(usefulness?.weight).toBeGreaterThan(0);
    expect(missing.reasons.map((r) => r.code)).toContain("starsMissing");
    // 레포를 아예 지운 쪽(측정 불가)이 더 낮거나 같아야 한다. 그렇지 않으면
    // "출처를 숨기면 별이 오른다"가 성립한다.
    expect(declared.stars).toBeGreaterThanOrEqual(missing.stars);
    expect(declared.stars).toBeLessThanOrEqual(4);
  });

  it("업스트림이 없는 항목은 유용성 성분이 **제외**되고 ★4 상한이 걸린다", () => {
    const inRepo = computeRegistryRating(
      item({ sourceRepository: undefined, sourceRef: undefined }),
      SNAP,
    );
    const usefulness = inRepo.components.find((c) => c.key === "usefulness");
    expect(usefulness?.value).toBeNull();
    expect(usefulness?.weight).toBe(0);
    expect(inRepo.stars).toBe(4);
    expect(inRepo.cap).toBe("usefulnessUnmeasurable");
    expect(inRepo.reasons.map((r) => r.code)).toContain(
      "usefulnessUnmeasurable",
    );
  });

  it("측정된 성분들의 가중치 합은 항상 1 이다(재정규화)", () => {
    for (const probe of [
      item(),
      item({ sourceRepository: undefined, sourceRef: undefined }),
      item({ license: undefined }),
    ]) {
      const rating = computeRegistryRating(probe, SNAP);
      const total = rating.components.reduce((sum, c) => sum + c.weight, 0);
      expect(total).toBeCloseTo(1, 6);
      // 제외된 성분은 가중치 0 이어야 한다 — 0 점으로 깎이면 안 된다.
      for (const c of rating.components) {
        if (c.value === null) expect(c.weight).toBe(0);
      }
    }
  });

  it("스타는 homepage 가 아니라 source.repository 로만 센다", () => {
    // homepage 로 인기 레포를 가리켜 남의 스타를 빌리는 경로가 없어야 한다.
    const rating = computeRegistryRating(
      item({ sourceRepository: "https://github.com/nobody/unknown" }),
      snapshot({ "acme/widget": upstream({ stars: 99999 }) }),
    );
    expect(rating.upstreamStars).toBeNull();
  });
});

describe("인증 — 설치 게이트와 같은 규칙(host allowlist · pinned ref · integrity)", () => {
  it("불변 핀이 아니면 감점되고 근거가 남는다", () => {
    const pinned = computeRegistryRating(item(), SNAP);
    const branch = computeRegistryRating(item({ sourceRef: "main" }), SNAP);
    expect(branch.score).toBeLessThan(pinned.score);
    expect(branch.reasons.map((r) => r.code)).toContain("unpinnedSource");
    expect(pinned.reasons.map((r) => r.code)).toContain("verifiedPin");
  });

  it("버전 태그 핀도 불변 핀으로 인정된다(v1.14.0 처럼)", () => {
    const rating = computeRegistryRating(item({ sourceRef: "v1.14.0" }), SNAP);
    expect(rating.reasons.map((r) => r.code)).toContain("verifiedPin");
  });

  it("허용 호스트가 아니면 감점된다", () => {
    const rating = computeRegistryRating(
      item({ sourceRepository: "https://evil.example.com/acme/widget" }),
      SNAP,
    );
    expect(rating.reasons.map((r) => r.code)).toContain("hostRejected");
  });

  it("경로 탈출이 있는 source.path 는 호스트 검증 실패로 취급한다", () => {
    const rating = computeRegistryRating(
      item({ sourcePath: "../../etc" }),
      SNAP,
    );
    expect(rating.reasons.map((r) => r.code)).toContain("hostRejected");
  });

  it("파일 전수 다이제스트가 있으면 무결성 만점, 일부만 덮이면 0", () => {
    const full = computeRegistryRating(item(), SNAP);
    const partial = computeRegistryRating(
      item({
        install: {
          kind: "files",
          root: "claude-skills",
          dest: "widget",
          files: ["SKILL.md", "reference.md"],
          integrity: { "SKILL.md": "d".repeat(64) },
        },
      }),
      SNAP,
    );
    expect(full.reasons.map((r) => r.code)).toContain("verifiedIntegrity");
    expect(partial.reasons.map((r) => r.code)).toContain("noIntegrity");
    expect(partial.score).toBeLessThan(full.score);
  });

  it("mcp-server 는 패키지 exact pin 이 무결성 앵커 — 범위 지정은 0", () => {
    const exact = computeRegistryRating(
      item({
        install: {
          kind: "mcp-server",
          runner: "npx",
          package: "airtable-mcp-server@1.14.0",
          args: [],
          envRequired: [],
          mcpKey: "airtable",
        },
      }),
      SNAP,
    );
    const floating = computeRegistryRating(
      item({
        install: {
          kind: "mcp-server",
          runner: "npx",
          package: "airtable-mcp-server@latest",
          args: [],
          envRequired: [],
          mcpKey: "airtable",
        },
      }),
      SNAP,
    );
    expect(exact.reasons.map((r) => r.code)).toContain("verifiedIntegrity");
    expect(floating.reasons.map((r) => r.code)).toContain("noIntegrity");
    expect(exact.score).toBeGreaterThan(floating.score);
  });

  it("★설치 계약이 없는 항목은 무결성 성분이 **제외**된다 — 우리가 쓰지도 않는 바이트를 감점하지 않는다", () => {
    // v1 mcp-server 처럼 인앱 설치가 아예 없는 항목이 여기 해당한다(스토어는
    // 링크만 준다). 0 으로 깎으면 스타 1.5만짜리 MCP 가 무명 항목보다 아래로
    // 내려간다 — 산식의 "모르는 것은 빼고 재정규화" 원칙을 여기서만 어기면
    // 그런 역전이 생긴다. 실제 레지스트리에서 확인된 회귀다.
    const rating = computeRegistryRating(item({ install: null }), SNAP);
    expect(rating.reasons.map((r) => r.code)).toContain(
      "integrityNotApplicable",
    );
    // 호스트·핀은 그대로 통과했으므로 인증 성분은 만점이다.
    expect(rating.components.find((c) => c.key === "verification")?.value).toBe(
      1,
    );
  });

  it("설치 계약이 없어도 핀이 깨지면 인증은 깎인다 — 제외되는 건 무결성뿐", () => {
    const rating = computeRegistryRating(
      item({ install: null, sourceRef: "main" }),
      SNAP,
    );
    expect(
      rating.components.find((c) => c.key === "verification")?.value,
    ).toBeLessThan(1);
    expect(rating.reasons.map((r) => r.code)).toContain("unpinnedSource");
  });

  it("★인증이 전부 깨진 항목은 인기가 아무리 많아도 ★5 가 될 수 없다", () => {
    const rating = computeRegistryRating(
      item({
        sourceRepository: "https://evil.example.com/acme/widget",
        sourceRef: "main",
        install: null,
      }),
      snapshot({ "acme/widget": upstream({ stars: 300000 }) }),
    );
    expect(rating.stars).toBeLessThan(5);
  });
});

describe("라이선스 — 레지스트리 OSI-only 정책", () => {
  it("OSI 승인 라이선스를 알아본다", () => {
    for (const spdx of ["MIT", "Apache-2.0", "AGPL-3.0", "MPL-2.0", "isc"]) {
      expect(isOsiApprovedLicense(spdx)).toBe(true);
    }
  });

  it("CC0 같은 퍼블릭 도메인 헌정은 OSI 목록엔 없어도 만점 대우", () => {
    const rating = computeRegistryRating(item({ license: "CC0-1.0" }), SNAP);
    expect(rating.reasons.map((r) => r.code)).toContain("licensePublicDomain");
    expect(rating.components.find((c) => c.key === "license")?.value).toBe(1);
  });

  it("★source-available 계열은 비OSI 로 판정된다", () => {
    for (const spdx of [
      "BUSL-1.1",
      "SSPL-1.0",
      "Elastic-2.0",
      "FSL-1.1-MIT",
      "PolyForm-Noncommercial-1.0.0",
      "CC-BY-NC-4.0",
    ]) {
      expect(isKnownNonOsiLicense(spdx)).toBe(true);
    }
  });

  it("★비OSI 는 감점이 아니라 ★2 상한 — 인기로 상단에 못 올라온다", () => {
    const rating = computeRegistryRating(
      item({ license: "BUSL-1.1" }),
      snapshot({ "acme/widget": upstream({ stars: 300000 }) }),
    );
    expect(rating.stars).toBe(2);
    expect(rating.cap).toBe("nonOsi");
    expect(rating.reasons.map((r) => r.code)).toContain("licenseNonOsi");
  });

  it("미신고·미인식은 감점일 뿐 상한이 아니다 — 모르는 것과 위반은 다르다", () => {
    const undeclared = computeRegistryRating(
      item({ license: undefined }),
      SNAP,
    );
    const unknown = computeRegistryRating(
      item({ license: "SomeCorp-Custom" }),
      SNAP,
    );
    const osi = computeRegistryRating(item(), SNAP);
    expect(undeclared.cap).toBeUndefined();
    expect(unknown.cap).toBeUndefined();
    expect(undeclared.score).toBeLessThan(osi.score);
    expect(undeclared.reasons.map((r) => r.code)).toContain(
      "licenseUndeclared",
    );
    expect(unknown.reasons.map((r) => r.code)).toContain("licenseUnrecognized");
  });
});

describe("신선도 — 핀이 살아 있는 코드를 가리키는가", () => {
  it("핀이 업스트림 HEAD 와 같으면 만점", () => {
    const rating = computeRegistryRating(
      item({ sourceRef: OTHER_SHA }),
      snapshot({ "acme/widget": upstream({ headSha: OTHER_SHA }) }),
    );
    expect(rating.reasons.map((r) => r.code)).toContain("freshPin");
    expect(rating.components.find((c) => c.key === "freshness")?.value).toBe(1);
  });

  it("업스트림이 오래 조용하면 신선도가 떨어진다", () => {
    const fresh = computeRegistryRating(
      item(),
      snapshot({
        "acme/widget": upstream({ pushedAt: "2026-08-05T00:00:00Z" }),
      }),
    );
    const stale = computeRegistryRating(
      item(),
      snapshot({
        "acme/widget": upstream({ pushedAt: "2025-02-01T00:00:00Z" }),
      }),
    );
    expect(stale.score).toBeLessThan(fresh.score);
    expect(stale.reasons.map((r) => r.code)).toContain("staleUpstream");
  });

  it("아카이브된 업스트림은 신선도 0", () => {
    const rating = computeRegistryRating(
      item(),
      snapshot({ "acme/widget": upstream({ archived: true }) }),
    );
    expect(rating.components.find((c) => c.key === "freshness")?.value).toBe(0);
    expect(rating.reasons.map((r) => r.code)).toContain("archivedUpstream");
  });

  it("활동 정보가 없으면 0 이 아니라 성분 제외", () => {
    const rating = computeRegistryRating(
      item(),
      snapshot({ "acme/widget": upstream({ pushedAt: null, headSha: null }) }),
    );
    const freshness = rating.components.find((c) => c.key === "freshness");
    expect(freshness?.value).toBeNull();
    expect(freshness?.weight).toBe(0);
  });
});

describe("상태 상한 — revoked / deprecated", () => {
  it("★회수된 항목은 무엇을 통과하든 ★1 로 고정된다", () => {
    const rating = computeRegistryRating(
      item({ status: "revoked" }),
      snapshot({ "acme/widget": upstream({ stars: 300000 }) }),
    );
    expect(rating.stars).toBe(1);
    expect(rating.cap).toBe("revoked");
    // 점수 자체는 높게 남는다 — 상한이 걸린 것이지 근거가 사라진 게 아니다.
    expect(rating.score).toBeGreaterThan(0.5);
  });

  it("지원 종료 항목은 ★3 상한", () => {
    const rating = computeRegistryRating(
      item({ status: "deprecated" }),
      snapshot({ "acme/widget": upstream({ stars: 300000 }) }),
    );
    expect(rating.stars).toBe(3);
    expect(rating.cap).toBe("deprecated");
  });
});

describe("산식 전체 — 별은 1~5 를 벗어나지 않고 근거가 반드시 붙는다", () => {
  const probes: RatingInput[] = [
    item(),
    item({ license: undefined, install: null, sourceRef: "main" }),
    item({ sourceRepository: undefined, sourceRef: undefined }),
    item({ status: "revoked" }),
    item({ status: "deprecated", license: "BUSL-1.1" }),
    {
      sourceRepository: "",
      status: "active",
      install: null,
      installDerived: false,
    },
  ];

  it("어떤 입력에도 ★는 1~5 정수", () => {
    for (const probe of probes) {
      const { stars } = computeRegistryRating(probe, SNAP);
      expect(Number.isInteger(stars)).toBe(true);
      expect(stars).toBeGreaterThanOrEqual(1);
      expect(stars).toBeLessThanOrEqual(5);
    }
  });

  it("모든 별점에 근거(reasons)와 스냅샷 시각이 붙는다 — 근거 없는 별은 없다", () => {
    for (const probe of probes) {
      const rating = computeRegistryRating(probe, SNAP);
      expect(rating.reasons.length).toBeGreaterThan(0);
      expect(rating.snapshotAt).toBe(SNAP.collectedAt);
      expect(rating.formulaVersion).toBeGreaterThanOrEqual(1);
    }
  });

  it("가중치 표는 합이 1 이다(문서가 약속하는 50/30/10/10)", () => {
    const sum = Object.values(RATING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(RATING_WEIGHTS.usefulness).toBe(0.5);
    expect(RATING_WEIGHTS.verification).toBe(0.3);
  });

  it("★5 는 업스트림 실증 + 전 인증 통과에만 나온다", () => {
    const best = computeRegistryRating(
      item({ sourceRef: OTHER_SHA }),
      snapshot({
        "acme/widget": upstream({ stars: 165000, headSha: OTHER_SHA }),
      }),
    );
    expect(best.stars).toBe(5);

    // 같은 인기라도 인증이 하나 깨지면 5 가 아니다.
    const unpinned = computeRegistryRating(
      item({ sourceRef: "main" }),
      snapshot({ "acme/widget": upstream({ stars: 165000 }) }),
    );
    expect(unpinned.stars).toBeLessThan(5);
  });
});
