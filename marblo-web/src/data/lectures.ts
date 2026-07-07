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
      "평생 업데이트 무료",
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
      "Lifetime free updates",
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
