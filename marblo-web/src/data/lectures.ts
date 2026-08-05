// Marblo v3 강의 커리큘럼 데이터
// Firestore lectures 컬렉션에 업로드할 시드 데이터

export interface LectureSection {
  title: string;
  title_en: string;
  duration: number; // seconds
  youtubeId: string; // placeholder - replace with real IDs
}

export interface LectureModule {
  title: string;
  title_en: string;
  sections: LectureSection[];
}

export interface LectureData {
  slug: string;
  title_ko: string;
  title_en: string;
  subtitle_ko: string;
  subtitle_en: string;
  description_ko: string;
  description_en: string;
  price: number;
  originalPrice?: number;
  thumbnail: string;
  instructor: string;
  instructorTitle: string;
  level: "beginner" | "intermediate" | "advanced";
  totalDuration: number; // seconds
  modules: LectureModule[];
  features: string[];
  features_en: string[];
  requirements: string[];
  requirements_en: string[];
  status: "published" | "draft";
}

// ─────────────────────────────────────────────────────────────────────────────
// 강의 "출시 예정" 전환 (토스 심사 / 티켓 Nj4zsTsJHAAqSM2wuH0X)
//
// 왜: 강의 콘텐츠가 미준비라 checkout 가드
// (src/app/[locale]/checkout/page.tsx 의 `type === "lecture"` useEffect)가
// 강의 결제 진입을 전부 막고 있다. 그런데 화면에는 가격(₩149,000·₩249,000)이
// 그대로 노출돼 있어, 토스 심사 가이드 §2 "품절 상품은 심사 불가" 에 걸린다
// (가격이 붙었는데 살 수 없는 카테고리 = 품절로 읽힘).
//
// 무엇을: 가격·할인율·"얼리버드/한정 300석/베스트셀러" 같은 판매·사전예약
// 문구를 화면에서 전부 내리고 "출시 예정"으로만 노출한다. 출시 알림 이메일
// 수집(→ /founders 베타 신청)은 결제가 아니므로 유지한다.
//
// 데이터·라우트는 지우지 않는다. 아래 price/originalPrice/LECTURE_PACKAGES 는
// 그대로 두고 "표시만" 끈 것이므로, 콘텐츠가 준비되면 아래 절차로 되돌린다.
//
// ▶ 되돌리는 방법 (강의 판매 재개 시)
//   1. `git log --grep="toss-lectures-coming-soon"` 로 이 전환 커밋을 찾아
//      `git revert` — 아래 4개 지점의 가격/구매 UI 가 한 번에 복구된다.
//      · src/app/[locale]/lectures/page.tsx           (목록 카드 가격/뱃지)
//      · src/app/[locale]/lectures/[slug]/page.tsx    (히어로 가격박스·패키지
//                                                      카드·최종 CTA·스티키바)
//      · src/app/[locale]/page.tsx + messages/*.json  (메인 번들 섹션 가격)
//   2. 그 다음 checkout 가드(위 useEffect)를 제거해야 실결제가 열린다.
//      가드가 남아 있으면 구매 버튼이 다시 상세로 튕긴다.
//   3. messages/*.json 의 `home.bundle.lecture_price` 를 복원한다.
//      전환 전 값 — ko "₩149,000" / en "$99" / ja "¥14,800"
//   4. 파운더 혜택 문구(티켓 MW2LEeUuWNlPVIiPwScP, PR#531 후속)도 이 전환과
//      맞물려 있다: messages/*.json 의 `foundation50.benefit4_body` /
//      `betatester50.receive_item4` 는 원래 "일반 얼리버드(25%)의 2배" 비교를
//      담고 있었으나, earlybird 가격이 화면에서 사라지면서 검증 불가한 비교가
//      되어 제거했다(50% 할인 약속 자체는 유지). earlybird 가격이 다시
//      노출되면 이 비교 문구를 되살릴지 검토할 것 — 강제 아님.
//   ★ 심사 기간(10~14일) 중에는 되돌리지 말 것. 가이드 §10 은 심사 중
//     판매상태 변경(품절→판매)을 반려 사유로 명시한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 강의 카테고리가 "출시 예정" 상태인지. 위 전환 블록 참조. */
export const LECTURES_COMING_SOON = true;

/** 로케일별 "출시 예정" 라벨. 목록의 기존 Coming Soon 카드와 문구를 맞춘다. */
export function comingSoonLabel(locale: string): string {
  if (locale === "ko") return "출시 예정";
  if (locale === "ja") return "近日公開";
  return "Coming Soon";
}

export const LECTURE_PACKAGES = {
  earlybird: {
    price: 149000,
    label: "얼리버드",
    label_en: "Early Bird",
    limit: 300,
    bonus: "Pro 6개월 무료 쿠폰",
    bonus_en: "Pro 6-month free coupon",
  },
  standard: {
    price: 199000,
    label: "정가",
    label_en: "Standard",
    bonus: "Pro 6개월 무료 쿠폰",
    bonus_en: "Pro 6-month free coupon",
  },
  proBudle: {
    price: 249000,
    label: "프로 번들",
    label_en: "Pro Bundle",
    bonus: "Pro 1년 무료 쿠폰",
    bonus_en: "Pro 1-year free coupon",
  },
};

export const lectures: LectureData[] = [
  {
    slug: "marblo-v3-masterclass",
    title_ko: "AI 에이전트 군단 마스터클래스 — 마블로 v3로 실전 프로젝트 완성",
    title_en: "AI Agent Army Masterclass — Build Real Projects with Marblo v3",
    subtitle_ko:
      "데스크탑 앱 하나로 멀티 AI 에이전트를 관리하며, 실전 SaaS를 처음부터 배포까지",
    subtitle_en:
      "Manage multi AI agents in one desktop app, from project planning to deployment",
    description_ko: `AI 에이전트 군단을 데스크탑 앱에서 직접 관리하며, 실전 프로젝트를 처음부터 배포까지 완성합니다.

Claude + Codex + Antigravity 에이전트를 한 보드에서 동시에 운용하고, 칸반 보드에서 태스크를 관리하며, 오케스트레이터가 목표를 자동 분해해 각 에이전트에 dispatch합니다.

날씨 대시보드 워밍업 → AI SaaS 메인 프로젝트 → GCP 배포 → SaaS 런칭까지, 15.5시간 동안 실전 프로젝트를 완성합니다.`,
    description_en: `Manage AI agent armies directly from a desktop app, completing real projects from start to deployment.

Run Claude + Codex + Antigravity agents simultaneously on one board, manage tasks on a kanban board, and let the orchestrator auto-decompose your goals and dispatch them to each agent.

From weather dashboard warmup → AI SaaS main project → GCP deployment → SaaS launch, complete a real project in 15.5 hours.`,
    price: 149000,
    originalPrice: 199000,
    thumbnail: "/images/lectures/marblo-v3-masterclass.png",
    instructor: "김동원",
    instructorTitle: "데이터가 답이다",
    level: "intermediate",
    totalDuration: 55800, // 15.5 hours in seconds
    features: [
      "전체 8모듈 15.5시간 강의 영상",
      "날씨 대시보드 + AI SaaS 완성 소스코드",
      "에이전트 스킬 템플릿 5종",
      "PRD + 태스크 분해 템플릿 5종",
      "GCP 배포 실전 가이드",
      "마블로 Pro 6개월 무료 쿠폰",
      "디스코드 커뮤니티 + 월간 라이브 Q&A",
      "마블로 초기 앰배서더 인증서 (추후 지속 혜택)",
      "구매 후 1년간 업데이트 무료",
    ],
    features_en: [
      "Full 8 modules, 15.5 hours of video",
      "Weather Dashboard + AI SaaS complete source code",
      "5 agent skill templates",
      "5 PRD + task decomposition templates",
      "GCP deployment guide",
      "Marblo Pro 6-month free coupon",
      "Discord community + monthly live Q&A",
      "Marblo Early Ambassador Certificate (ongoing perks)",
      "Free updates for 1 year after purchase",
    ],
    requirements: [
      "프로그래밍 기초 (어떤 언어든 OK)",
      "터미널 사용 경험",
      "Claude Code 기본 사용법 (없어도 모듈 1에서 커버)",
    ],
    requirements_en: [
      "Basic programming (any language)",
      "Terminal experience",
      "Claude Code basics (covered in Module 1 if needed)",
    ],
    status: "published",
    modules: [
      {
        title: "모듈 1. 마블로 소개 + 설치 + 첫 체험",
        title_en: "Module 1. Marblo Introduction + Setup + First Experience",
        sections: [
          {
            title: '1-1. 왜 AI 에이전트 "군단"인가',
            title_en: '1-1. Why AI Agent "Army"',
            duration: 900,
            youtubeId: "",
          },
          {
            title: "1-2. 마블로 핵심 기능 소개",
            title_en: "1-2. Marblo Core Features",
            duration: 1500,
            youtubeId: "",
          },
          {
            title: "1-3. 마블로 설치 + Claude Code 필수 사용법",
            title_en: "1-3. Marblo Setup + Claude Code Essentials",
            duration: 1500,
            youtubeId: "",
          },
          {
            title: "1-4. 환경 설정 — MCP + 슬래시 스킬 + Hook",
            title_en: "1-4. Environment Setup — MCP + Slash Skills + Hook",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "1-5. 첫 풀사이클 체험",
            title_en: "1-5. First Full-Cycle Experience",
            duration: 1500,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 2. 시스템 구조 + 에이전트 스킬 설계",
        title_en: "Module 2. System Architecture + Agent Skill Design",
        sections: [
          {
            title: "2-1. MCP란 무엇인가",
            title_en: "2-1. What is MCP",
            duration: 900,
            youtubeId: "",
          },
          {
            title: "2-2. 마블로 아키텍처 — v3 코드 뜯어보기",
            title_en: "2-2. Marblo Architecture Deep Dive",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "2-3. 상태 머신 — 왜 JIRA 칸반과 다른가",
            title_en: "2-3. State Machine — Why Different from JIRA",
            duration: 900,
            youtubeId: "",
          },
          {
            title: "2-4. 슬래시 스킬 구조",
            title_en: "2-4. Slash Skill Structure",
            duration: 900,
            youtubeId: "",
          },
          {
            title: "2-5. 에이전트 스킬 파일 — 역할별 행동 규칙",
            title_en: "2-5. Agent Skill Files — Role-based Behavior",
            duration: 1800,
            youtubeId: "",
          },
          {
            title: "2-6. 티켓 → 에이전트 연결 + 실시간 diff 추적",
            title_en: "2-6. Ticket → Agent Linking + Live Diff Tracking",
            duration: 1500,
            youtubeId: "",
          },
          {
            title: "2-7. 워크트리 격리 + 안전한 머지 워크플로우",
            title_en: "2-7. Worktree Isolation + Safe Merge Workflow",
            duration: 1800,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 3. 워밍업: 날씨 대시보드",
        title_en: "Module 3. Warmup: Weather Dashboard",
        sections: [
          {
            title: "3-1. /tf-plan으로 프로젝트 기획",
            title_en: "3-1. Project Planning with /tf-plan",
            duration: 900,
            youtubeId: "",
          },
          {
            title: "3-2. /tf-start로 실행 + 관찰",
            title_en: "3-2. Execute + Observe with /tf-start",
            duration: 1500,
            youtubeId: "",
          },
          {
            title: "3-3. PM 역할 — /tf-status + /tf-review",
            title_en: "3-3. PM Role — /tf-status + /tf-review",
            duration: 1800,
            youtubeId: "",
          },
          {
            title: "3-4. 회고",
            title_en: "3-4. Retrospective",
            duration: 600,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 4. 메인 프로젝트: AI SaaS 빌드",
        title_en: "Module 4. Main Project: AI SaaS Build",
        sections: [
          {
            title: "4-1. /tf-analyze — 요구사항 분석",
            title_en: "4-1. Requirements Analysis",
            duration: 1800,
            youtubeId: "",
          },
          {
            title: "4-2. 태스크 생성 + 에이전트 스폰",
            title_en: "4-2. Task Creation + Agent Spawn",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "4-3. Sprint 1 — 백엔드 기초",
            title_en: "4-3. Sprint 1 — Backend Foundation",
            duration: 3000,
            youtubeId: "",
          },
          {
            title: "4-4. Sprint 2 — 프론트엔드 + 병렬 처리",
            title_en: "4-4. Sprint 2 — Frontend + Parallel",
            duration: 3000,
            youtubeId: "",
          },
          {
            title: "4-5. Sprint 3 — 통합 + 리뷰",
            title_en: "4-5. Sprint 3 — Integration + Review",
            duration: 2400,
            youtubeId: "",
          },
          {
            title: "4-6. 상황별 대응 — PM이 개입하는 순간",
            title_en: "4-6. Situational Response — When PM Intervenes",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "4-7. 프로젝트 마무리",
            title_en: "4-7. Project Wrap-up",
            duration: 600,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 5. 멀티모델 에이전트 오케스트레이션",
        title_en: "Module 5. Multi-Model Agent Orchestration",
        sections: [
          {
            title: "5-1. 왜 멀티모델인가",
            title_en: "5-1. Why Multi-Model",
            duration: 900,
            youtubeId: "",
          },
          {
            title: "5-2. 마블로 멀티모델 설정",
            title_en: "5-2. Marblo Multi-Model Setup",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "5-3. 실습: 혼합 에이전트 팀 구성",
            title_en: "5-3. Lab: Mixed Agent Team",
            duration: 2400,
            youtubeId: "",
          },
          {
            title: "5-4. 오케스트레이터 — 자연어로 태스크 분해",
            title_en: "5-4. Orchestrator — NL Task Decomposition",
            duration: 1500,
            youtubeId: "",
          },
          {
            title: "5-5. 모델별 비용/성능 비교 + 최적 전략",
            title_en: "5-5. Model Cost/Performance + Strategy",
            duration: 1200,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 6. GCP 배포 + 자동화",
        title_en: "Module 6. GCP Deployment + Automation",
        sections: [
          {
            title: "6-1. GCP 프로젝트 셋업",
            title_en: "6-1. GCP Project Setup",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "6-2. Cloud Run 배포",
            title_en: "6-2. Cloud Run Deployment",
            duration: 1800,
            youtubeId: "",
          },
          {
            title: "6-3. 크론잡으로 자동화",
            title_en: "6-3. Cron Job Automation",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "6-4. CI/CD 파이프라인",
            title_en: "6-4. CI/CD Pipeline",
            duration: 1200,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 7. SaaS 랜딩페이지 + 런칭 준비",
        title_en: "Module 7. SaaS Landing Page + Launch Prep",
        sections: [
          {
            title: "7-1. SaaS 랜딩페이지 디자인 (Stitch MCP)",
            title_en: "7-1. SaaS Landing Page Design (Stitch MCP)",
            duration: 2400,
            youtubeId: "",
          },
          {
            title: "7-2. 런칭 체크리스트",
            title_en: "7-2. Launch Checklist",
            duration: 1200,
            youtubeId: "",
          },
        ],
      },
      {
        title: "모듈 8. 운영 패턴 + 반복 자동화 + 마무리",
        title_en: "Module 8. Operation Patterns + Automation + Wrap-up",
        sections: [
          {
            title: "8-1. 일상 운영 패턴",
            title_en: "8-1. Daily Operation Patterns",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "8-2. /tf-ralph — 반복 작업 자동화",
            title_en: "8-2. /tf-ralph — Repetitive Task Automation",
            duration: 1800,
            youtubeId: "",
          },
          {
            title: "8-3. 확장 방향",
            title_en: "8-3. Expansion Directions",
            duration: 1200,
            youtubeId: "",
          },
          {
            title: "8-4. 마무리",
            title_en: "8-4. Closing",
            duration: 1200,
            youtubeId: "",
          },
        ],
      },
    ],
  },
];
