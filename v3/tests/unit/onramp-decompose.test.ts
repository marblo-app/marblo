/**
 * L0 룰 분해 계약 (ticket VzR1izqW6hzwF0YRfkgL · 설계 #886 §4).
 *
 * 여기서 검증되는 것은 "규칙이 약속한 모양을 낸다" 이지 "제목이 자연스럽다" 가
 * 아니다 — 후자는 사람이 읽어야 한다. 다만 설계가 판정선을 하나 준다(T4:
 * 임의 한국어 문장에서 fallback 비율 < 40%). 그 선은 여기서 지켜진다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ONRAMP_DECOMPOSE_LIMIT,
  ONRAMP_MAX_DEMO_TICKETS,
  ONRAMP_MAX_DRAFTS,
  ONRAMP_MAX_INPUT_CHARS,
  checkOnrampQuota,
  clampDrafts,
  extractSubject,
  matchIntent,
  ruleDecomposer,
} from "../../src/lib/onrampDecompose";

const srcPath = (rel: string) =>
  fileURLToPath(new URL(`../../src/${rel}`, import.meta.url));

const ROLES = new Set(["frontend", "backend", "test", "devops"]);

describe("onramp decompose — 모양 계약", () => {
  it("어떤 입력에서도 초안이 비지 않는다(조용한 실패 금지)", () => {
    for (const input of ["", "   ", "?", "ㅁㄴㅇㄹ", "a"]) {
      const result = ruleDecomposer(input, "ko");
      expect(result.drafts.length).toBeGreaterThanOrEqual(4);
      expect(result.drafts.length).toBeLessThanOrEqual(ONRAMP_MAX_DRAFTS);
    }
  });

  it("역할은 실제 보드의 AgentRole 넷뿐이다 — 보드가 모르는 역할은 배정이 안 된다", () => {
    // 설계 초안에는 qa·design 이 있었지만 `Task.role` 에는 없다. 티켓이 '진짜'
    // 여야 한다는 불변식 I3 가 이 테스트로 강제된다.
    for (const input of ["로그인 만들어줘", "배포 자동화", "그냥 아무거나"]) {
      for (const draft of ruleDecomposer(input, "ko").drafts) {
        expect(ROLES.has(draft.role), `${draft.role}`).toBe(true);
      }
    }
  });

  it("order 는 0부터 연속이고, 의존성은 **앞선** 초안만 가리킨다", () => {
    // 뒤를 가리키는 의존성은 보드에서 영원히 안 풀리는 게이트가 된다.
    for (const input of [
      "로그인 화면",
      "결제 붙여줘",
      "버그 고쳐줘",
      "hello",
    ]) {
      const { drafts } = ruleDecomposer(input, "ko");
      drafts.forEach((d, i) => {
        expect(d.order).toBe(i);
        if (d.dependsOnOrder !== undefined) {
          expect(d.dependsOnOrder).toBeLessThan(d.order);
          expect(d.dependsOnOrder).toBeGreaterThanOrEqual(0);
        }
      });
    }
  });

  it("ko/en 양쪽에서 제목·설명이 비지 않는다", () => {
    for (const locale of ["ko", "en"] as const) {
      for (const draft of ruleDecomposer("login screen", locale).drafts) {
        expect(draft.title.trim().length).toBeGreaterThan(0);
        expect(draft.description.trim().length).toBeGreaterThan(0);
        // 치환이 안 된 자리표시자가 화면에 뜨는 일은 없어야 한다.
        expect(draft.title).not.toContain("{subject}");
      }
    }
  });

  it("입력이 상한을 넘어도 잘라서 처리한다(원문 인용도 함께 잘린다)", () => {
    const huge = "로그인 " + "가".repeat(ONRAMP_MAX_INPUT_CHARS * 2);
    const { drafts } = ruleDecomposer(huge, "ko");
    for (const d of drafts) {
      // 원문 인용은 160자로 자른다 — 티켓 본문이 로그 뷰어가 되지 않게.
      expect(d.description.length).toBeLessThan(1_000);
    }
  });
});

describe("onramp decompose — R1 의도 · R3 어휘 재사용", () => {
  it("도메인 의도가 형태 의도를 이긴다(결제 API → payment)", () => {
    // "결제 API" 는 payment 와 api 둘 다 걸린다. 유저가 말한 도메인이 골격을
    // 더 잘 정하므로 payment 가 이겨야 한다 — 이 순서가 INTENT_RULES 의 계약이다.
    expect(matchIntent("결제 API 만들어줘")).toBe("payment");
    expect(matchIntent("login api")).toBe("auth");
  });

  it("의도별로 서로 다른 골격이 나온다", () => {
    const auth = ruleDecomposer("로그인 만들어줘", "ko");
    const bug = ruleDecomposer("결제창이 안 돼요", "ko");
    expect(auth.matchedRule).toBe("auth");
    // "결제창이 안 돼요" 는 payment 가 먼저 걸린다(도메인 우선).
    expect(bug.matchedRule).toBe("payment");
    expect(auth.drafts.map((d) => d.title)).not.toEqual(
      bug.drafts.map((d) => d.title),
    );
  });

  it("유저가 쓴 명사구가 제목에 그대로 박힌다(R3)", () => {
    const { drafts, subject } = ruleDecomposer("결제창 만들어줘", "ko");
    expect(subject).toBe("결제창");
    expect(drafts.some((d) => d.title.includes("결제창"))).toBe(true);
  });

  it("조사는 벗기되 짧은 어간은 통째로 지우지 않는다", () => {
    expect(extractSubject("로그인을 만들어줘")).toBe("로그인");
    expect(extractSubject("대시보드에서 통계를 보고 싶어")).toBe("대시보드");
    // 부탁 표현만 있는 문장에서는 뽑지 않는다 — 억지 추측보다 일반 명사가 낫다.
    expect(extractSubject("만들어줘 해줘")).toBe("");
  });

  it("주어를 못 뽑으면 템플릿 기본 명사구가 선다", () => {
    const { drafts, subject } = ruleDecomposer("로그인", "ko");
    expect(subject).toBe("로그인");
    expect(drafts[0].title).toContain("로그인");
  });
});

describe("onramp decompose — ★T4 판정선: fallback 비율 < 40%", () => {
  // 설계 §12 가 명시한 대로 이 40% 는 [제안]이지 실측이 아니다. 그래도 선을
  // 코드에 두는 이유는, 룰을 고치다가 이 비율이 조용히 나빠지는 것을 막기
  // 위해서다. 아래 20문장은 "신규 유저가 첫 화면에 쓸 법한 말" 이다.
  const SENTENCES = [
    "로그인 화면이랑 인증 API 만들어줘",
    "회원가입에 이메일 인증 붙여줘",
    "결제창 붙이고 결제 결과 검증까지",
    "구독 결제 연동하고 싶어요",
    "랜딩 페이지 새로 만들어줘",
    "홈페이지 히어로 섹션 다시",
    "관리자 대시보드에 매출 차트",
    "통계 지표 화면이 필요해요",
    "구독자 목록 화면에 검색 추가",
    "게시판 리스트랑 페이지네이션",
    "결제창이 안 돼요 고쳐주세요",
    "로그인하면 에러가 나요",
    "테스트 커버리지를 올리고 싶어",
    "E2E 테스트를 붙여줘",
    "배포 파이프라인 만들어줘",
    "도커로 릴리스 자동화",
    "주문 조회 API 엔드포인트 추가",
    "데이터베이스 스키마부터 정리",
    "알림 기능 추가해줘",
    "사용자 프로필 편집",
  ];

  it("20문장 중 fallback 비율이 40% 미만이다", () => {
    const fallbacks = SENTENCES.filter(
      (s) => ruleDecomposer(s, "ko").fallback,
    ).length;
    const ratio = fallbacks / SENTENCES.length;
    expect(ratio, `fallback ${fallbacks}/${SENTENCES.length}`).toBeLessThan(
      0.4,
    );
  });

  it("fallback 일 때는 설명이 그 사실을 말한다(정직성 규칙 §4-D)", () => {
    // 화면 문구만 정직하면 모달을 닫는 순간 그 정직함이 사라진다 — 티켓 본문에도
    // 같은 말이 남아야 한다.
    const result = ruleDecomposer("음 그냥 뭔가 해보고 싶어", "ko");
    expect(result.fallback).toBe(true);
    expect(result.matchedRule).toBe("fallback");
    for (const d of result.drafts) {
      expect(d.description).toContain("다시 쪼갭니다");
    }
    const en = ruleDecomposer("hmm something vague", "en");
    expect(en.fallback).toBe(true);
    expect(en.drafts[0].description).toContain("re-split");
  });

  it("의도가 걸린 초안에는 그 문구가 붙지 않는다(불필요한 자기비하 금지)", () => {
    const result = ruleDecomposer("로그인 만들어줘", "ko");
    expect(result.fallback).toBe(false);
    expect(result.drafts[0].description).not.toContain("다시 쪼갭니다");
  });
});

describe("onramp decompose — 한도(§4-F)", () => {
  it("상수는 설계대로 3회 · 7장 · 21장이다", () => {
    expect(ONRAMP_DECOMPOSE_LIMIT).toBe(3);
    expect(ONRAMP_MAX_DRAFTS).toBe(7);
    expect(ONRAMP_MAX_DEMO_TICKETS).toBe(21);
    expect(ONRAMP_MAX_DEMO_TICKETS).toBe(
      ONRAMP_DECOMPOSE_LIMIT * ONRAMP_MAX_DRAFTS,
    );
  });

  it("분해 3회를 채우면 막고, 사유를 말한다", () => {
    expect(
      checkOnrampQuota({ decomposeCount: 2, demoTicketCount: 0 }).allowed,
    ).toBe(true);
    const v = checkOnrampQuota({ decomposeCount: 3, demoTicketCount: 0 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("decompose_limit");
  });

  it("생애 21장을 채우면 분해 횟수가 남아도 막는다", () => {
    const v = checkOnrampQuota({ decomposeCount: 1, demoTicketCount: 21 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("ticket_limit");
    expect(v.remainingTickets).toBe(0);
  });

  it("남은 총량이 초안보다 적으면 잘라 내고, 잘린 선행을 가리키는 의존성을 비운다", () => {
    const { drafts } = ruleDecomposer("로그인 만들어줘", "ko");
    expect(drafts.length).toBe(5);
    const clamped = clampDrafts(drafts, 2);
    expect(clamped).toHaveLength(2);
    for (const d of clamped) {
      if (d.dependsOnOrder !== undefined) {
        expect(d.dependsOnOrder).toBeLessThan(clamped.length);
      }
    }
    // 3번째(세션 저장, dependsOn=1)가 잘리면 그 참조도 함께 사라진다.
    const two = clampDrafts(drafts, 2);
    expect(two.every((d) => (d.dependsOnOrder ?? 0) < 2)).toBe(true);
  });
});

describe("onramp L0 — ★무과금·무서버 불변식 회귀 가드", () => {
  // B안을 고른 이유가 **원가가 아니라 표면**이다(설계 §4-B): 서버 표면이 0이라
  // #885 §8 의 abuse 통제 8종이 하나도 필요 없다. 그 약속이 조용히 깨지는 경로는
  // 하나뿐이다 — 이 모듈이 어느 날 네트워크를 부르는 것. 소스 스캔으로 막는다.
  // (데모 대본이 같은 이유로 같은 가드를 갖고 있다.)
  const forbidden: Array<[string, RegExp]> = [
    ["fetch()", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /\bnew\s+WebSocket\b/],
    ["electronAPI (CLI 스폰·IPC)", /electronAPI/],
    ["ipcRenderer", /ipcRenderer/],
    ["firebase import", /from\s+["']firebase\//],
    ["원격 URL", /https?:\/\//],
  ];

  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("lib/onrampDecompose.ts 는 네트워크·electronAPI 를 건드리지 않는다", () => {
    const source = stripComments(
      readFileSync(srcPath("lib/onrampDecompose.ts"), "utf8"),
    );
    for (const [label, pattern] of forbidden) {
      expect(pattern.test(source), `${label} 발견`).toBe(false);
    }
  });

  it("lib/onrampGate.ts 도 같은 규율을 지킨다", () => {
    const source = stripComments(
      readFileSync(srcPath("lib/onrampGate.ts"), "utf8"),
    );
    for (const [label, pattern] of forbidden) {
      expect(pattern.test(source), `${label} 발견`).toBe(false);
    }
  });

  it("★L0 티켓 write 는 기존 taskService 를 쓴다 — 신규 백엔드 경로가 없다", () => {
    const source = readFileSync(
      srcPath("services/onrampDemoTickets.ts"),
      "utf8",
    );
    expect(source).toContain('from "./taskService"');
    // 직접 firestore 를 부르면 rules·컨버터 규율이 두 벌이 된다.
    expect(/from\s+["']firebase\//.test(source)).toBe(false);
    // 출처 필드가 빠지면 계측이 데모 티켓과 진짜 티켓을 못 가른다(§4-E).
    expect(source).toContain('origin: "onramp_demo"');
    expect(source).toContain("originRule");
    expect(source).toContain("originFallback");
  });
});
