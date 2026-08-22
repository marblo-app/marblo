/**
 * githubAppGuide — 상태 판정 (티켓 kzxsRzC37uVvYftpVZO4).
 *
 * ★이 스위트가 지키는 계약은 하나다: **모든 상태에 "다음에 뭘 하면 되는지"
 * 가 있다.** 오늘 UX 감사가 "로딩 40개 중 28개가 실패 상태를 안 그린다" 고
 * 지적했고, 이 화면은 그러면 안 된다. 그래서
 *  (a) 도달 가능한 상태를 **전부** 열거해 하나도 빠지지 않았는지 보고,
 *  (b) 각 상태의 문구 키가 **ko·en 에 실재**하는지 확인한다.
 * 키가 없으면 화면에 키 문자열("githubGuide.foo.bar")이 그대로 찍힌다 —
 * 그게 곧 "다음 행동이 없는 에러 화면" 이다.
 */
import { describe, expect, it } from "vitest";
import {
  installJustCompleted,
  resolveGitHubAppGuide,
  type GitHubAppStatusView,
  type GuideInput,
  type GuideKind,
} from "../../src/lib/githubAppGuide";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

/** 모든 축이 열린(=제일 좋은) 상태. 각 테스트가 여기서 하나씩 닫는다. */
const READY: GitHubAppStatusView = {
  installed: true,
  repoAccessible: true,
  configured: true,
  role: "member",
  canWrite: true,
  canMerge: false,
  writeGranted: true,
};

function input(over: Partial<GuideInput> = {}): GuideInput {
  return {
    status: READY,
    supported: true,
    failed: false,
    isOwner: false,
    role: "member",
    hasRepoUrl: true,
    ...over,
  };
}

/**
 * 도달 가능한 모든 상태를 만드는 입력표. ★새 상태를 추가하면 여기에도
 * 넣어야 아래 `커버리지` 테스트가 통과한다 — 상태만 늘리고 문구를 잊는 것을
 * 막는 장치다.
 */
const CASES: { kind: GuideKind; input: GuideInput }[] = [
  { kind: "unsupported", input: input({ supported: false }) },
  { kind: "error", input: input({ failed: true }) },
  { kind: "loading", input: input({ status: null }) },
  {
    kind: "not-configured",
    input: input({ status: { ...READY, configured: false } }),
  },

  // 오너
  {
    kind: "owner-no-repo-url",
    input: input({ isOwner: true, hasRepoUrl: false }),
  },
  {
    kind: "owner-not-installed",
    input: input({ isOwner: true, status: { ...READY, installed: false } }),
  },
  {
    kind: "owner-repo-mismatch",
    input: input({
      isOwner: true,
      status: { ...READY, repoAccessible: false },
    }),
  },
  {
    kind: "owner-read-only",
    input: input({ isOwner: true, status: { ...READY, writeGranted: false } }),
  },
  { kind: "owner-ready", input: input({ isOwner: true, role: "owner" }) },

  // 팀원
  { kind: "member-no-repo-url", input: input({ hasRepoUrl: false }) },
  {
    kind: "member-not-installed",
    input: input({ status: { ...READY, installed: false } }),
  },
  {
    kind: "member-repo-mismatch",
    input: input({ status: { ...READY, repoAccessible: false } }),
  },
  {
    kind: "member-read-only",
    input: input({ status: { ...READY, writeGranted: false } }),
  },
  { kind: "member-viewer", input: input({ role: "viewer" }) },
  { kind: "member-ready", input: input({ role: "member" }) },
];

describe("resolveGitHubAppGuide — 상태 판정", () => {
  it.each(CASES)("$kind 로 판정한다", ({ kind, input: given }) => {
    expect(resolveGitHubAppGuide(given).kind).toBe(kind);
  });

  it("도달 가능한 상태를 전부 덮는다 (새 상태를 추가하면 여기서 깨진다)", () => {
    const covered = new Set(CASES.map((c) => c.kind));
    const produced = new Set(
      CASES.map((c) => resolveGitHubAppGuide(c.input).kind),
    );
    expect([...produced].sort()).toEqual([...covered].sort());
    expect(covered.size).toBe(CASES.length);
  });
});

describe("★모든 상태에 '다음에 뭘 하면 되는지' 가 있다", () => {
  it.each(CASES)("$kind 는 nextAction 문구를 갖는다", ({ input: given }) => {
    const state = resolveGitHubAppGuide(given);
    const next = ko[state.nextActionKey];
    expect(next).toBeTruthy();
    // 키 이름이 그대로 노출되는 사고를 막는다.
    expect(next).not.toBe(state.nextActionKey);
    expect(next.trim().length).toBeGreaterThan(0);
  });

  it.each(CASES)("$kind 의 제목·본문도 비어 있지 않다", ({ input: given }) => {
    const state = resolveGitHubAppGuide(given);
    expect(ko[state.titleKey]?.trim()).toBeTruthy();
    expect(ko[state.bodyKey]?.trim()).toBeTruthy();
  });
});

describe("문구가 ko·en 두 로케일에 모두 있다", () => {
  const usedKeys = [
    ...new Set(
      CASES.flatMap(({ input: given }) => {
        const s = resolveGitHubAppGuide(given);
        return [
          s.titleKey,
          s.bodyKey,
          s.nextActionKey,
          ...(s.alsoKey ? [s.alsoKey] : []),
        ];
      }),
    ),
  ];

  it.each(usedKeys)("%s — ko/en 에 있다", (key) => {
    expect(ko[key]?.trim()).toBeTruthy();
    expect(en[key]?.trim()).toBeTruthy();
  });

  it("githubGuide.* 전체 키셋이 ko/en 에서 정확히 같다", () => {
    const koKeys = (Object.keys(ko) as (keyof typeof ko)[])
      .filter((k) => k.startsWith("githubGuide."))
      .sort();
    const enKeys = (Object.keys(en) as (keyof typeof en)[])
      .filter((k) => k.startsWith("githubGuide."))
      .sort();
    expect(enKeys).toEqual(koKeys);
  });
});

describe("★과장하지 않는다 — 권한 상태에 따라 말이 달라진다", () => {
  it("writeGranted:false 는 ready 가 아니다 (오너·팀원 모두)", () => {
    const status = { ...READY, writeGranted: false };
    expect(resolveGitHubAppGuide(input({ isOwner: true, status })).kind).toBe(
      "owner-read-only",
    );
    expect(resolveGitHubAppGuide(input({ status })).kind).toBe(
      "member-read-only",
    );
  });

  it("viewer 는 clone 이 되므로 blocked 가 아니라 warn 이다", () => {
    const state = resolveGitHubAppGuide(input({ role: "viewer" }));
    expect(state.kind).toBe("member-viewer");
    expect(state.tone).toBe("warn");
  });

  it("역할 게이트는 설치·권한 뒤에 온다 — 설치도 안 됐는데 역할 탓을 하지 않는다", () => {
    // viewer 인데 App 도 아직 안 깔린 상태. "역할이 부족" 이 아니라
    // "오너가 설치해야 한다" 가 먼저 나와야 한다.
    const state = resolveGitHubAppGuide(
      input({ role: "viewer", status: { ...READY, installed: false } }),
    );
    expect(state.kind).toBe("member-not-installed");
  });

  it("저장소 주소가 없으면 설치 안내보다 그게 먼저다", () => {
    const state = resolveGitHubAppGuide(
      input({
        isOwner: true,
        hasRepoUrl: false,
        status: { ...READY, installed: false },
      }),
    );
    expect(state.kind).toBe("owner-no-repo-url");
    expect(state.action).toBe("repo-connect");
  });
});

describe("★실패를 로딩으로 위장하지 않는다", () => {
  it("failed 는 loading 과 다른 상태이고 [다시 확인] 을 준다", () => {
    const state = resolveGitHubAppGuide(input({ failed: true, status: null }));
    expect(state.kind).toBe("error");
    expect(state.action).toBe("refresh");
  });

  it("조회 실패는 절대 ok tone 이 아니다", () => {
    expect(resolveGitHubAppGuide(input({ failed: true })).tone).not.toBe("ok");
  });
});

describe("★설치 버튼은 오너 상태에서만 나온다", () => {
  it("팀원 상태는 install 액션을 갖지 않는다 (눌러도 거부될 가짜 버튼 방지)", () => {
    const memberStates = CASES.filter((c) => c.kind.startsWith("member-"));
    expect(memberStates.length).toBeGreaterThan(0);
    for (const c of memberStates) {
      expect(resolveGitHubAppGuide(c.input).action).not.toBe("install");
    }
  });
});

describe("installJustCompleted — '됐다' 를 앱이 확인해서 보여 준다", () => {
  it("설치 전 → 설치+접근 가능 이면 완료다", () => {
    expect(installJustCompleted({ ...READY, installed: false }, READY)).toBe(
      true,
    );
  });

  it("첫 조회에서 이미 설치돼 있어도 완료로 본다 (before 가 없다)", () => {
    expect(installJustCompleted(null, READY)).toBe(true);
  });

  it("이미 설치돼 있었으면 다시 알리지 않는다", () => {
    expect(installJustCompleted(READY, READY)).toBe(false);
  });

  it("★설치는 됐지만 저장소를 못 열면 완료가 아니다 (과장 금지)", () => {
    const halfway = { ...READY, repoAccessible: false };
    expect(installJustCompleted({ ...READY, installed: false }, halfway)).toBe(
      false,
    );
  });

  it("조회 결과가 없으면 완료가 아니다", () => {
    expect(installJustCompleted(READY, null)).toBe(false);
  });
});
