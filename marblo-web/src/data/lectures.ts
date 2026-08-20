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
  // 토스페이 가맹점 심사 대응(티켓 xRlxnHV0CDp5eVvItxHK) — 강사 이력·모집기간·
  // 개강시점·수강기간·모집실패 시 처리를 상세페이지/목록에 노출하기 위한 필드.
  // ko/en/ja 모두 채운다. 날짜·정책 문구는 사장님 확정분을 그대로 쓰고 추측 금지.
  instructorBio_ko: string;
  instructorBio_en: string;
  instructorBio_ja: string;
  enrollmentPeriod_ko: string;
  enrollmentPeriod_en: string;
  enrollmentPeriod_ja: string;
  courseStartDate_ko: string;
  courseStartDate_en: string;
  courseStartDate_ja: string;
  courseAccessPeriod_ko: string;
  courseAccessPeriod_en: string;
  courseAccessPeriod_ja: string;
  enrollmentFailurePolicy_ko: string;
  enrollmentFailurePolicy_en: string;
  enrollmentFailurePolicy_ja: string;
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
    thumbnail: "/images/lectures/marblo-workspace-board.png",
    instructor: "김동원",
    instructorTitle: "데이터가 답이다",
    instructorBio_ko: `패스트캠퍼스에서 AI·GA4·마케팅 분석·SEO 강의를 진행하는 현직 데이터 사이언티스트입니다.

현) 롯데멤버스 데이터사이언티스트 — 그룹 전사 행동 데이터 기반 대규모 추천시스템, 고객데이터플랫폼(CDP), 분석 프로덕트를 개발합니다. 머신러닝·데이터 엔지니어링·실험설계·BI·프로덕션 AI 시스템 전반을 다룹니다.
전) 덴츠코리아(아이프로스펙트) 데이터분석 팀리더 · 제일기획 · HS애드

자격·수상: Google Cloud Certified — Professional Machine Learning Engineer, Kaggle Competitions 브론즈 메달(3,700+ 팀 중 상위 10%). 유튜브 채널 「데이터가 답이다」를 운영하며 엔터프라이즈 규모 추천·분석 시스템을 설계·운영한 경험이 있습니다.

전문 분야: AI·ML(추천시스템, 예측모델링, MLOps, 생성형 AI, RAG, 멀티에이전트 시스템), 데이터 프로덕트(CDP, 광고 DMP, 행동분석, GA4, BI 대시보드, 실험설계), AI 프로덕트 빌딩(AI 제품·개발자도구·워크플로우 자동화·에이전트 시스템), 계량 리서치(시장·재무·대체데이터 기반 시스템 트레이딩 전략 개발 및 백테스팅).

현재 Marblo(멀티에이전트 코딩·오케스트레이션 플랫폼)와 개미날다(AI 투자 리서치·데이터 플랫폼)를 빌딩하고 있습니다.`,
    instructorBio_en: `A working data scientist who also teaches AI, GA4, marketing analytics, and SEO at Fast Campus.

Current: Data Scientist at Lotte Members — builds large-scale recommendation systems, a customer data platform (CDP), and analytics products based on company-wide behavioral data. Works across machine learning, data engineering, experiment design, BI, and production AI systems.
Previous: Data Analytics Team Lead at Dentsu Korea (iProspect); Cheil Worldwide; HS Ad.

Certifications & awards: Google Cloud Certified — Professional Machine Learning Engineer; Kaggle Competitions Bronze Medal (top 10% among 3,700+ teams). Runs the YouTube channel "데이터가 답이다" (Data Is the Answer) and has experience designing and operating enterprise-scale recommendation and analytics systems.

Areas of expertise: AI/ML (recommendation systems, predictive modeling, MLOps, generative AI, RAG, multi-agent systems); data products (CDP, ad DMP, behavioral analytics, GA4, BI dashboards, experiment design); AI product building (AI products, developer tools, workflow automation, agent systems); quantitative research (systematic trading strategy development and backtesting on market, financial, and alternative data).

Currently building Marblo (a multi-agent coding and orchestration platform) and 개미날다 (an AI investment research and data platform).`,
    instructorBio_ja: `ファストキャンパスでAI・GA4・マーケティング分析・SEO講座を担当する現役データサイエンティストです。

現職：ロッテメンバーズ データサイエンティスト — グループ全社の行動データに基づく大規模レコメンドシステム、カスタマーデータプラットフォーム(CDP)、分析プロダクトを開発。機械学習・データエンジニアリング・実験設計・BI・プロダクションAIシステム全般を担当します。
前職：デンツーコリア(アイプロスペクト) データ分析チームリーダー、第一企画、HSアド

資格・受賞：Google Cloud Certified — Professional Machine Learning Engineer、Kaggle Competitionsブロンズメダル(3,700+チーム中上位10%)。YouTubeチャンネル「데이터가 답이다」(データが答えだ)を運営し、エンタープライズ規模のレコメンド・分析システムの設計・運用経験があります。

専門分野：AI・ML(レコメンドシステム、予測モデリング、MLOps、生成AI、RAG、マルチエージェントシステム)、データプロダクト(CDP、広告DMP、行動分析、GA4、BIダッシュボード、実験設計)、AIプロダクトビルディング(AI製品・開発者ツール・ワークフロー自動化・エージェントシステム)、定量リサーチ(市場・財務・オルタナティブデータに基づくシステムトレーディング戦略の開発とバックテスト)。

現在、Marblo(マルチエージェント・コーディング&オーケストレーションプラットフォーム)と개미날다(AI投資リサーチ・データプラットフォーム)を開発中です。`,
    enrollmentPeriod_ko:
      "2026년 10월 5일부터 상시 모집 (녹화 강의(VOD) 상시 판매, 별도 모집 마감일 없음)",
    enrollmentPeriod_en:
      "Rolling enrollment from October 5, 2026 (recorded VOD course sold on an ongoing basis; no separate enrollment deadline)",
    enrollmentPeriod_ja:
      "2026年10月5日から常時募集(録画講座(VOD)を随時販売、別途の募集締切なし)",
    courseStartDate_ko: "2026년 10월 5일",
    courseStartDate_en: "October 5, 2026",
    courseStartDate_ja: "2026年10月5日",
    courseAccessPeriod_ko: "구매일로부터 1년",
    courseAccessPeriod_en: "1 year from the date of purchase",
    courseAccessPeriod_ja: "購入日から1年間",
    enrollmentFailurePolicy_ko:
      "녹화 강의(VOD)로 최소 모집 인원 조건이 없으며, 모집 인원과 무관하게 예정대로 오픈·제공합니다. 부득이하게 오픈이 불가능해질 경우 결제 금액을 전액 환불합니다.",
    enrollmentFailurePolicy_en:
      "This is a recorded (VOD) course with no minimum enrollment requirement — it opens and is provided on schedule regardless of the number of enrollees. If, in unavoidable circumstances, the course cannot open, the full payment amount will be refunded.",
    enrollmentFailurePolicy_ja:
      "録画講座(VOD)のため最低募集人数の条件はなく、募集人数にかかわらず予定どおり開講・提供します。やむを得ず開講が不可能になった場合は、決済金額を全額返金します。",
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
