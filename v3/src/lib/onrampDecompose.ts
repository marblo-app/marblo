import type { AgentRole } from "../types/task";

/**
 * L0 — "내 말이 카드가 된다" 의 **분해 규칙** (설계: v3/docs/onramp-ladder-design-2026-08-09.md §4).
 *
 * 온램프 사다리의 0층은 "로그인은 했지만 코딩 CLI 계정은 아직 없는" 사람이 서
 * 있는 칸이다. 그 칸에서 우리가 보여줄 수 있는 유일한 진짜 가치는 **자기가 쓴
 * 문장이 진짜 보드의 진짜 티켓이 되는 것**이고, 그건 LLM 없이도 만들 수 있다.
 *
 * 설계가 세 안(A 캔드데모 / B 템플릿·룰 / C 서버 1콜) 중 **B** 를 고른 이유는
 * 원가가 아니라 표면이다: B 는 신규 서버 표면이 0이라 #885 §8 이 출시조건으로
 * 못박은 abuse 통제 8종(단명토큰·하드캡·동시성·모델 allowlist·전역 예산
 * 킬스위치·이상탐지…)이 **하나도 필요 없다**. 불변식 I1("L0 는 우리 원가를
 * 만들지 않는다")을 구조적으로 만족한다.
 *
 * ── 이 파일의 계약 3가지 (설계 §4-C 의 seam 규율) ─────────────────────────
 *  D1. **순수함수다.** 네트워크·스토어·i18n·타이머·DOM 부수효과가 없다. 그래서
 *      v3 vitest(environment:"node", jsdom 없음)에서 그대로 테스트된다 —
 *      `demoScript.ts` 가 화면에서 쪼개져 나온 것과 같은 이유다.
 *  D2. 화면은 `DecomposeResult` **만** 읽는다. 나중에 C안(서버 1콜)으로 갈아탈
 *      때 같은 타입을 돌려주는 async 구현만 끼우면 화면 변경이 0이 된다.
 *  D3. `matchedRule` 을 계측에 싣는다 — "어떤 입력이 fallback 으로 떨어지는가"
 *      가 다음 룰의 유일한 근거다.
 *
 * ★문구가 locales 가 아니라 이 파일에 있는 이유: 이 문자열들은 **유저 문장과
 * 합성**된다(R3 — 유저가 쓴 명사구를 제목에 그대로 박는다). t() 로 빼면 화면이
 * 문장을 조립하게 되는데, 그러면 "무엇이 티켓 제목인가" 의 단일소스가 화면으로
 * 흩어진다. 대신 `locale` 을 **인자로** 받아 이 파일 안에서 갈린다(D1 유지).
 *
 * ★정직성 규칙(설계 §4-D, 가장 중요): `fallback === true` 면 화면이 그렇게
 * 말해야 한다. 초안을 완성품처럼 팔지 않는 것이 룰베이스에서 가능한 유일한
 * 방어다 — "조용히 틀린 일을 열심히 하는 팀"(#885 §7-B)을 **말로** 막는다.
 */

export type OnrampLocale = "ko" | "en";

export interface TicketDraft {
  title: string;
  description: string;
  /**
   * ★설계 초안은 `qa`·`design` 을 썼지만 실제 보드의 `Task.role` 은
   * backend|frontend|test|devops 넷뿐이다. 티켓이 **진짜**여야 한다는 불변식
   * I3 때문에 여기서는 실제 타입을 따른다 — 보드가 모르는 역할을 만들면 그
   * 티켓은 배정이 안 되는 가짜가 된다.
   */
  role: AgentRole;
  /** 0-based. 보드 write 순서이자 `dependsOnOrder` 의 참조 축. */
  order: number;
  /** 선행 초안의 order. **룰이 확신할 때만** 채운다(애매하면 비운다 — R5). */
  dependsOnOrder?: number;
}

export interface DecomposeResult {
  drafts: TicketDraft[];
  /** 어떤 규칙이 걸렸나 — 계측·디버깅용. 나중에 C안이면 "llm". */
  matchedRule: string;
  /** 룰이 확신하지 못해 일반 골격으로 떨어졌는가. UI 문구가 이걸 읽는다. */
  fallback: boolean;
  /** 입력에서 뽑아 제목에 박은 명사구(R3). 못 뽑았으면 빈 문자열. */
  subject: string;
}

export type Decomposer = (
  input: string,
  locale: OnrampLocale,
) => DecomposeResult;

// ── 한도 (설계 §4-F) ──────────────────────────────────────────────────────
//
// ★원가가 0이므로 한도의 목적은 **예산이 아니라 보드 위생**이다. 실행 못 하는
// 데모 카드가 무한히 쌓이면 첫인상이 "정리 안 되는 앱" 이 된다(R2).

/** 세션당 분해 횟수. #885 §5-B 의 "생애 데모캡 3회" 와 **축을 맞춘다**. */
export const ONRAMP_DECOMPOSE_LIMIT = 3;
/** 1회당 티켓 수 상한 — 미니 보드가 한 화면에 그리는 한계. */
export const ONRAMP_MAX_DRAFTS = 7;
/** 생애 데모 티켓 총량 = 3 × 7. */
export const ONRAMP_MAX_DEMO_TICKETS =
  ONRAMP_DECOMPOSE_LIMIT * ONRAMP_MAX_DRAFTS;
/** 입력 길이 상한 — 룰 매칭에 그 이상은 무의미하다. */
export const ONRAMP_MAX_INPUT_CHARS = 2_000;

// ── R1: 의도 키워드 사전 ──────────────────────────────────────────────────
//
// 전부 **소문자·공백제거 후** 부분일치로 본다. 한국어는 조사가 붙어도 어간이
// 남으므로("결제창을" → "결제" 포함) 부분일치가 형태소 분석보다 튼튼하다.
//
// ★순서가 곧 우선순위다. "결제 API 만들어줘" 는 payment 와 api 둘 다 걸리는데,
// 유저가 말한 **도메인**(결제)이 **형태**(API)보다 티켓 골격을 잘 정한다.
// 그래서 도메인 의도가 위, 형태 의도가 아래다.

interface IntentRule {
  id: string;
  keywords: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    id: "auth",
    keywords: [
      "로그인",
      "회원가입",
      "가입",
      "인증",
      "계정",
      "비밀번호",
      "세션",
      "login",
      "signup",
      "sign up",
      "sign-in",
      "signin",
      "auth",
      "password",
      "account",
    ],
  },
  {
    id: "payment",
    keywords: [
      "결제",
      "구독",
      "요금제",
      "카드",
      "청구",
      "환불",
      "payment",
      "checkout",
      "billing",
      "subscription",
      "subscribe",
      "refund",
      "pricing",
    ],
  },
  {
    id: "landing",
    keywords: [
      "랜딩",
      "홈페이지",
      "메인 페이지",
      "메인페이지",
      "소개 페이지",
      "소개페이지",
      "landing",
      "home page",
      "homepage",
      "marketing site",
    ],
  },
  {
    id: "dashboard",
    keywords: [
      "대시보드",
      "통계",
      "차트",
      "그래프",
      "지표",
      "리포트",
      "dashboard",
      "chart",
      "analytics",
      "metrics",
      "report",
    ],
  },
  {
    id: "list",
    keywords: [
      "목록",
      "리스트",
      "검색",
      "필터",
      "게시판",
      "list",
      "search",
      "filter",
      "table view",
    ],
  },
  {
    id: "bug",
    keywords: [
      "버그",
      "오류",
      "에러",
      "안 돼",
      "안돼",
      "안 됩니다",
      "고쳐",
      "깨졌",
      "죽어",
      "bug",
      "error",
      "broken",
      "crash",
      "fix ",
      "not working",
      "doesn't work",
    ],
  },
  {
    id: "test",
    keywords: [
      "테스트",
      "커버리지",
      "회귀",
      "qa",
      "test",
      "coverage",
      "regression",
    ],
  },
  {
    id: "deploy",
    keywords: [
      "배포",
      "릴리스",
      "릴리즈",
      "파이프라인",
      "도커",
      "deploy",
      "release",
      "pipeline",
      "docker",
      "ci/cd",
      "ci ",
    ],
  },
  {
    id: "api",
    keywords: [
      "api",
      "엔드포인트",
      "서버",
      "백엔드",
      "디비",
      "db",
      "데이터베이스",
      "endpoint",
      "backend",
      "database",
      "schema",
    ],
  },
];

// ── R2/R4/R5: 의도별 골격 템플릿 ──────────────────────────────────────────
//
// `{subject}` 만 유저 어휘로 치환된다(R3). 역할은 템플릿이 고정하고(R4),
// 의존성은 **템플릿이 확신하는 경우만** 채운다(R5 — 애매하면 비운다).

interface StepTemplate {
  /** `{subject}` 자리표시자를 쓸 수 있다. */
  title: Record<OnrampLocale, string>;
  body: Record<OnrampLocale, string>;
  role: AgentRole;
  /** 이 템플릿 안에서의 선행 step 인덱스. */
  dependsOn?: number;
}

interface IntentTemplate {
  /** 주어를 못 뽑았을 때 제목에 들어가는 기본 명사구. */
  defaultSubject: Record<OnrampLocale, string>;
  steps: StepTemplate[];
}

const TEMPLATES: Record<string, IntentTemplate> = {
  auth: {
    defaultSubject: { ko: "로그인", en: "login" },
    steps: [
      {
        title: {
          ko: "{subject} 화면 만들기",
          en: "Build the {subject} screen",
        },
        body: {
          ko: "입력 폼과 검증, 로딩·에러 상태까지 화면 쪽을 완성합니다.",
          en: "Build the form, validation, and the loading/error states.",
        },
        role: "frontend",
      },
      {
        title: { ko: "{subject} API 구현", en: "Implement the {subject} API" },
        body: {
          ko: "요청/응답 스키마를 정하고 엔드포인트를 구현합니다.",
          en: "Define the request/response schema and implement the endpoint.",
        },
        role: "backend",
      },
      {
        title: { ko: "세션·토큰 저장 처리", en: "Persist session and tokens" },
        body: {
          ko: "인증 결과를 어디에 어떻게 보관할지 정하고 배선합니다.",
          en: "Decide where the auth result is stored and wire it up.",
        },
        role: "backend",
        // ★확신하는 의존성 하나만 — 저장할 것이 생기기 전에는 저장을 못 한다.
        dependsOn: 1,
      },
      {
        title: { ko: "실패·예외 처리", en: "Handle failures and edge cases" },
        body: {
          ko: "잘못된 입력·만료·네트워크 실패에 무엇을 보여줄지 정합니다.",
          en: "Decide what the user sees on bad input, expiry, and network failure.",
        },
        role: "frontend",
      },
      {
        title: { ko: "{subject} 테스트", en: "Test {subject}" },
        body: {
          ko: "성공/실패 경로를 자동 테스트로 못박습니다.",
          en: "Pin the success and failure paths with automated tests.",
        },
        role: "test",
      },
    ],
  },
  payment: {
    defaultSubject: { ko: "결제", en: "payment" },
    steps: [
      {
        title: {
          ko: "{subject} 화면 만들기",
          en: "Build the {subject} screen",
        },
        body: {
          ko: "금액·상품 표시와 결제 시작 버튼까지 화면을 만듭니다.",
          en: "Show the amount and item, and wire the start-payment button.",
        },
        role: "frontend",
      },
      {
        title: { ko: "결제 API 연동", en: "Integrate the payment API" },
        body: {
          ko: "결제 요청 생성과 주문 보관을 서버에서 처리합니다.",
          en: "Create the payment intent and persist the order server-side.",
        },
        role: "backend",
      },
      {
        title: { ko: "결제 결과 검증", en: "Verify the payment result" },
        body: {
          ko: "결제사 응답을 신뢰하지 말고 서버에서 다시 조회해 확정합니다.",
          en: "Never trust the client callback — re-fetch and confirm server-side.",
        },
        role: "backend",
        dependsOn: 1,
      },
      {
        title: { ko: "실패·환불 경로", en: "Failure and refund paths" },
        body: {
          ko: "취소·실패·중복 결제에 무엇을 하는지 정합니다.",
          en: "Decide what happens on cancel, failure, and duplicate charges.",
        },
        role: "backend",
      },
      {
        title: { ko: "{subject} 테스트", en: "Test {subject}" },
        body: {
          ko: "성공/실패/중복 시나리오를 테스트로 남깁니다.",
          en: "Cover success, failure, and duplicate scenarios with tests.",
        },
        role: "test",
      },
    ],
  },
  landing: {
    defaultSubject: { ko: "랜딩 페이지", en: "landing page" },
    steps: [
      {
        title: { ko: "{subject} 구성 잡기", en: "Outline the {subject}" },
        body: {
          ko: "무엇을 먼저 보여줄지 섹션 순서를 정합니다.",
          en: "Decide the section order — what the visitor sees first.",
        },
        role: "frontend",
      },
      {
        title: { ko: "히어로 섹션 만들기", en: "Build the hero section" },
        body: {
          ko: "한 문장 가치제안과 주 CTA 를 배치합니다.",
          en: "Place the one-line value proposition and the primary CTA.",
        },
        role: "frontend",
        dependsOn: 0,
      },
      {
        title: { ko: "기능 소개 섹션", en: "Build the feature sections" },
        body: {
          ko: "핵심 기능을 3~4개로 추려 설명합니다.",
          en: "Pick three or four core features and explain them.",
        },
        role: "frontend",
      },
      {
        title: {
          ko: "반응형·성능 점검",
          en: "Responsive and performance pass",
        },
        body: {
          ko: "모바일 폭과 첫 로딩 속도를 실제로 확인합니다.",
          en: "Check mobile widths and first-load speed for real.",
        },
        role: "test",
      },
    ],
  },
  dashboard: {
    defaultSubject: { ko: "대시보드", en: "dashboard" },
    steps: [
      {
        title: { ko: "지표 정의", en: "Define the metrics" },
        body: {
          ko: "무엇을 세는 숫자인지 먼저 못박습니다 — 정의가 흔들리면 화면도 흔들립니다.",
          en: "Pin down what each number counts before drawing anything.",
        },
        role: "backend",
      },
      {
        title: { ko: "집계 API 구현", en: "Implement the aggregation API" },
        body: {
          ko: "정의한 지표를 계산해 돌려주는 엔드포인트를 만듭니다.",
          en: "Build the endpoint that computes the defined metrics.",
        },
        role: "backend",
        dependsOn: 0,
      },
      {
        title: {
          ko: "{subject} 화면 만들기",
          en: "Build the {subject} screen",
        },
        body: {
          ko: "차트와 요약 카드를 배치하고 빈 상태를 처리합니다.",
          en: "Lay out the charts and summary cards, and handle the empty state.",
        },
        role: "frontend",
        dependsOn: 1,
      },
      {
        title: { ko: "기간·필터", en: "Date range and filters" },
        body: {
          ko: "기간 선택과 필터가 같은 숫자 축을 쓰게 맞춥니다.",
          en: "Make the range picker and filters share one numeric axis.",
        },
        role: "frontend",
      },
    ],
  },
  list: {
    defaultSubject: { ko: "목록", en: "list" },
    steps: [
      {
        title: {
          ko: "{subject} 화면 만들기",
          en: "Build the {subject} screen",
        },
        body: {
          ko: "목록·빈 상태·로딩을 그립니다.",
          en: "Render the list, the empty state, and loading.",
        },
        role: "frontend",
      },
      {
        title: { ko: "조회 API 구현", en: "Implement the query API" },
        body: {
          ko: "페이지네이션까지 포함해 조회 엔드포인트를 만듭니다.",
          en: "Build the query endpoint, pagination included.",
        },
        role: "backend",
      },
      {
        title: { ko: "검색·필터", en: "Search and filters" },
        body: {
          ko: "검색어와 필터를 서버 쿼리로 이어 붙입니다.",
          en: "Wire the search term and filters into the server query.",
        },
        role: "backend",
        dependsOn: 1,
      },
      {
        title: { ko: "{subject} 테스트", en: "Test {subject}" },
        body: {
          ko: "빈 결과·많은 결과 두 끝을 테스트합니다.",
          en: "Test both ends: empty results and very large results.",
        },
        role: "test",
      },
    ],
  },
  bug: {
    defaultSubject: { ko: "이 문제", en: "this issue" },
    steps: [
      {
        title: { ko: "{subject} 재현하기", en: "Reproduce {subject}" },
        body: {
          ko: "어떤 조건에서 항상 재현되는지 절차를 적습니다. 재현 못 하면 고칠 수도 없습니다.",
          en: "Write the steps that reproduce it every time. No repro, no fix.",
        },
        role: "test",
      },
      {
        title: { ko: "원인 찾기", en: "Find the root cause" },
        body: {
          ko: "증상이 아니라 원인을 찾습니다 — 어디서 처음 어긋나는지.",
          en: "Find the cause, not the symptom — where does it first go wrong.",
        },
        role: "backend",
        dependsOn: 0,
      },
      {
        title: { ko: "수정하기", en: "Apply the fix" },
        body: {
          ko: "찾은 원인만 고칩니다. 곁가지 정리는 별도 티켓으로.",
          en: "Fix the cause only. Unrelated cleanups go in their own ticket.",
        },
        role: "backend",
        dependsOn: 1,
      },
      {
        title: { ko: "회귀 테스트 추가", en: "Add a regression test" },
        body: {
          ko: "같은 버그가 다시 오면 죽는 테스트를 남깁니다.",
          en: "Leave a test that fails if this bug ever comes back.",
        },
        role: "test",
        dependsOn: 2,
      },
    ],
  },
  test: {
    defaultSubject: { ko: "이 기능", en: "this feature" },
    steps: [
      {
        title: { ko: "테스트 대상 정리", en: "List what to test" },
        body: {
          ko: "지금 안 덮인 경로를 먼저 적습니다.",
          en: "Write down the paths that aren't covered today.",
        },
        role: "test",
      },
      {
        title: { ko: "{subject} 유닛 테스트", en: "Unit-test {subject}" },
        body: {
          ko: "순수 로직부터 덮습니다 — 가장 싸고 가장 빨리 도는 층입니다.",
          en: "Start with pure logic — the cheapest, fastest layer.",
        },
        role: "test",
        dependsOn: 0,
      },
      {
        title: { ko: "통합·E2E 테스트", en: "Integration and E2E tests" },
        body: {
          ko: "실제 사용자가 지나는 한 줄기를 끝까지 태웁니다.",
          en: "Drive one real user path end to end.",
        },
        role: "test",
      },
      {
        title: { ko: "CI 에 연결", en: "Wire it into CI" },
        body: {
          ko: "사람이 기억해서 돌리는 테스트는 곧 안 돌게 됩니다.",
          en: "A test only humans remember to run soon stops running.",
        },
        role: "devops",
      },
    ],
  },
  deploy: {
    defaultSubject: { ko: "배포", en: "deployment" },
    steps: [
      {
        title: { ko: "빌드 스크립트 정리", en: "Sort out the build script" },
        body: {
          ko: "한 명령으로 재현 가능한 빌드를 만듭니다.",
          en: "Make the build reproducible from one command.",
        },
        role: "devops",
      },
      {
        title: { ko: "{subject} 파이프라인", en: "{subject} pipeline" },
        body: {
          ko: "빌드→검사→배포 순서를 자동화합니다.",
          en: "Automate build → check → ship, in that order.",
        },
        role: "devops",
        dependsOn: 0,
      },
      {
        title: { ko: "환경변수·시크릿 정리", en: "Environment and secrets" },
        body: {
          ko: "어떤 값이 어디서 오는지 한 곳에 적습니다. 시크릿 원문은 코드에 두지 않습니다.",
          en: "Document where each value comes from. Never commit raw secrets.",
        },
        role: "devops",
      },
      {
        title: { ko: "롤백 확인", en: "Verify rollback" },
        body: {
          ko: "되돌리는 길을 먼저 확인합니다 — 배포보다 중요한 절차입니다.",
          en: "Verify the way back first — it matters more than the way forward.",
        },
        role: "devops",
        dependsOn: 1,
      },
    ],
  },
  api: {
    defaultSubject: { ko: "API", en: "API" },
    steps: [
      {
        title: {
          ko: "{subject} 스키마 정하기",
          en: "Design the {subject} schema",
        },
        body: {
          ko: "요청·응답 모양과 에러 규약을 먼저 정합니다.",
          en: "Define the request/response shape and the error contract first.",
        },
        role: "backend",
      },
      {
        title: {
          ko: "{subject} 엔드포인트 구현",
          en: "Implement the {subject} endpoint",
        },
        body: {
          ko: "정한 스키마대로 구현합니다.",
          en: "Implement exactly the schema you defined.",
        },
        role: "backend",
        dependsOn: 0,
      },
      {
        title: {
          ko: "입력 검증·에러 처리",
          en: "Validation and error handling",
        },
        body: {
          ko: "잘못된 입력을 서버에서 막습니다 — 화면 검증은 방어선이 아닙니다.",
          en: "Reject bad input server-side — client validation is not a defense.",
        },
        role: "backend",
        dependsOn: 1,
      },
      {
        title: { ko: "{subject} 테스트", en: "Test the {subject}" },
        body: {
          ko: "정상·오류 응답을 자동 테스트로 못박습니다.",
          en: "Pin both the happy path and the error responses with tests.",
        },
        role: "test",
      },
    ],
  },
};

/** R6 — 어떤 의도도 안 걸렸을 때의 일반 골격. `fallback: true` 가 함께 나간다. */
const FALLBACK_TEMPLATE: IntentTemplate = {
  defaultSubject: { ko: "이번 작업", en: "this work" },
  steps: [
    {
      title: {
        ko: "{subject} 요구사항 정리",
        en: "Clarify {subject} requirements",
      },
      body: {
        ko: "무엇이 끝난 상태인지 한 줄로 적습니다. 이게 애매하면 나머지가 전부 흔들립니다.",
        en: "Write one line describing 'done'. Everything else wobbles without it.",
      },
      role: "backend",
    },
    {
      title: { ko: "{subject} 구현", en: "Implement {subject}" },
      body: {
        ko: "정리한 요구사항대로 만듭니다.",
        en: "Build exactly what the requirements say.",
      },
      role: "backend",
      dependsOn: 0,
    },
    {
      title: { ko: "화면 배선", en: "Wire up the UI" },
      body: {
        ko: "사용자가 실제로 만나는 자리를 연결합니다.",
        en: "Connect the surface the user actually touches.",
      },
      role: "frontend",
      dependsOn: 1,
    },
    {
      title: { ko: "테스트·확인", en: "Test and verify" },
      body: {
        ko: "직접 한 번 써 보고, 그 경로를 테스트로 남깁니다.",
        en: "Use it once yourself, then leave that path as a test.",
      },
      role: "test",
    },
  ],
};

// ── R3: 유저 어휘 재사용 ──────────────────────────────────────────────────

/**
 * 제목에 박을 명사구를 유저 문장에서 뽑는다.
 *
 * 형태소 분석기를 쓰지 않는다(의존성 0 · 오프라인 · <10ms 가 이 층의 계약이다).
 * 대신 **버리는 쪽**으로만 작동한다: 조사·상용 동사·부탁 표현을 걷어내고 남은
 * 첫 토큰을 쓴다. 못 뽑으면 빈 문자열을 돌려주고 템플릿의 기본 명사구가 선다 —
 * 어설픈 추측으로 이상한 제목을 만드느니 일반 명사가 낫다.
 */
const STOPWORDS = new Set([
  // ko — 부탁·의도 표현
  "만들어줘",
  "만들어",
  "만들기",
  "만들고",
  "해줘",
  "해주세요",
  "하고",
  "하는",
  "해야",
  "싶어",
  "싶어요",
  "필요해",
  "필요합니다",
  "추가",
  "추가해줘",
  "구현",
  "구현해줘",
  "기능",
  "부분",
  "그리고",
  "그냥",
  "좀",
  "우리",
  "저희",
  "제가",
  "내가",
  "지금",
  "빨리",
  "전체",
  // en
  "please",
  "make",
  "build",
  "create",
  "add",
  "implement",
  "want",
  "need",
  "would",
  "like",
  "a",
  "an",
  "the",
  "to",
  "for",
  "with",
  "and",
  "our",
  "my",
  "i",
  "we",
  "it",
  "this",
  "that",
  "can",
  "you",
]);

/** 한국어 조사 꼬리 — 긴 것부터 벗겨야 "에서" 가 "에" 로 잘못 잘리지 않는다. */
const PARTICLES = [
  "에서의",
  "으로의",
  "에서",
  "에게",
  "부터",
  "까지",
  "으로",
  "이랑",
  "라도",
  "이나",
  "만큼",
  "처럼",
  "보다",
  "을",
  "를",
  "이",
  "가",
  "은",
  "는",
  "의",
  "에",
  "로",
  "와",
  "과",
  "도",
  "랑",
];

function stripParticle(token: string): string {
  // 조사를 벗겨도 어간이 2자 이상 남을 때만 벗긴다 — "이가" 같은 짧은 이름이
  // 통째로 사라지는 것을 막는다.
  for (const p of PARTICLES) {
    if (token.length > p.length + 1 && token.endsWith(p)) {
      return token.slice(0, token.length - p.length);
    }
  }
  return token;
}

export function extractSubject(input: string): string {
  const tokens = input
    .replace(/[.,!?;:()[\]{}"'`~/\\|]/g, " ")
    .split(/\s+/)
    .map((tk) => tk.trim())
    .filter(Boolean);

  for (const raw of tokens) {
    const lower = raw.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    const stripped = stripParticle(raw);
    if (!stripped) continue;
    if (STOPWORDS.has(stripped.toLowerCase())) continue;
    // 숫자만·기호만인 토큰은 제목이 되지 못한다.
    if (!/[가-힣a-zA-Z]/.test(stripped)) continue;
    if (stripped.length < 2) continue;
    return stripped;
  }
  return "";
}

// ── 본체 ──────────────────────────────────────────────────────────────────

function normalizeForMatch(input: string): string {
  return input.toLowerCase();
}

export function matchIntent(input: string): string | null {
  const hay = normalizeForMatch(input);
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((k) => hay.includes(k))) return rule.id;
  }
  return null;
}

/** 원문 인용 꼬리 — 티켓 설명이 "무엇을 듣고 만든 카드인가" 를 들고 있게 한다. */
function quoteRequest(input: string, locale: OnrampLocale): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  const clipped = trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 160)}…`;
  return locale === "ko"
    ? `\n\n요청한 내용: "${clipped}"`
    : `\n\nOriginal request: "${clipped}"`;
}

/**
 * ★fallback 일 때 설명에 함께 나가는 정직성 문장(설계 §4-D). 화면 문구
 * (`onramp.decompose.fallbackNote`)와 **같은 말**을 티켓 본문에도 남긴다 —
 * 화면을 닫고 나면 그 티켓만 남기 때문이다.
 */
function honestyNote(locale: OnrampLocale): string {
  return locale === "ko"
    ? "\n\n※ 이 초안은 앱이 규칙으로 대략 쪼갠 것입니다. 계정을 연결하면 오케스트레이터가 실제 코드를 읽고 다시 쪼갭니다."
    : "\n\nNote: this draft was split by local rules, not by reading your code. Connect an account and the orchestrator will re-split it against the real repository.";
}

/**
 * B — 로컬 룰 분해. **기본 구현이자 지금 유일한 구현**이다.
 *
 * 실패하지 않는다: 어떤 입력이 와도(빈 문자열 포함) 최소 4장의 초안을 돌려준다.
 * 화면이 "아무 일도 안 일어남" 을 그릴 일이 없어야 한다는 뜻이다.
 */
export const ruleDecomposer: Decomposer = (input, locale) => {
  const clipped = (input ?? "").slice(0, ONRAMP_MAX_INPUT_CHARS);
  const intent = matchIntent(clipped);
  const template = (intent && TEMPLATES[intent]) || FALLBACK_TEMPLATE;
  const fallback = !intent;
  const extracted = extractSubject(clipped);
  const subject = extracted || template.defaultSubject[locale];

  const steps = template.steps.slice(0, ONRAMP_MAX_DRAFTS);
  const drafts: TicketDraft[] = steps.map((step, order) => ({
    title: step.title[locale].replace("{subject}", subject).trim(),
    description:
      step.body[locale] +
      quoteRequest(clipped, locale) +
      (fallback ? honestyNote(locale) : ""),
    role: step.role,
    order,
    ...(step.dependsOn !== undefined && step.dependsOn < order
      ? { dependsOnOrder: step.dependsOn }
      : {}),
  }));

  return {
    drafts,
    matchedRule: intent ?? "fallback",
    fallback,
    subject: extracted,
  };
};

/**
 * 한도 판정 — "지금 한 번 더 분해해도 되나".
 *
 * ★초과를 **조용한 실패로 만들지 않는다**(설계 §4-F): 한도 도달 자체가 전환
 * 트리거이므로, 호출부는 `allowed === false` 일 때 M1(연결 안내)을 띄운다.
 */
export interface OnrampQuota {
  decomposeCount: number;
  demoTicketCount: number;
}

export interface OnrampQuotaVerdict {
  allowed: boolean;
  /** 이번에 만들 수 있는 티켓 수 상한(남은 생애 총량에 맞춰 줄어든다). */
  remainingTickets: number;
  reason: "ok" | "decompose_limit" | "ticket_limit";
}

export function checkOnrampQuota(quota: OnrampQuota): OnrampQuotaVerdict {
  const remainingTickets = Math.max(
    0,
    ONRAMP_MAX_DEMO_TICKETS - quota.demoTicketCount,
  );
  if (quota.decomposeCount >= ONRAMP_DECOMPOSE_LIMIT) {
    return { allowed: false, remainingTickets, reason: "decompose_limit" };
  }
  if (remainingTickets <= 0) {
    return { allowed: false, remainingTickets: 0, reason: "ticket_limit" };
  }
  return { allowed: true, remainingTickets, reason: "ok" };
}

/** 남은 총량에 맞춰 초안을 자른다(생애 21장 상한을 넘기지 않는다). */
export function clampDrafts(
  drafts: TicketDraft[],
  remainingTickets: number,
): TicketDraft[] {
  const limit = Math.min(ONRAMP_MAX_DRAFTS, Math.max(0, remainingTickets));
  const kept = drafts.slice(0, limit);
  // 잘려 나간 선행을 가리키는 의존성은 **비운다** — 없는 티켓을 가리키는
  // dependsOn 은 보드에서 영원히 안 풀리는 게이트가 된다.
  return kept.map((d) =>
    d.dependsOnOrder !== undefined && d.dependsOnOrder >= kept.length
      ? { ...d, dependsOnOrder: undefined }
      : d,
  );
}
