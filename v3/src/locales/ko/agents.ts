/**
 * Korean — `agents.*` namespace (Agent Dashboard surface). Keys keep their
 * dotted form.
 */
export const agents = {
  "agents.dashboard.title": "Agent Dashboard",
  "agents.dashboard.addAgent": "에이전트 추가",
  "agents.dashboard.cleanup": "정리",
  "agents.dashboard.cleanupConfirm":
    "{count}개의 비활성 에이전트를 삭제하시겠습니까?\n(working 상태 제외)",
  "agents.dashboard.loading": "에이전트 로딩 중...",

  // ── Usage Dashboard ─────────────────────────────────────────
  "agents.usage.note.claude":
    "Max 구독: 무제한 (5분 쿨다운) / Pro: 일일 제한 있음",
  "agents.usage.note.gpt": "ChatGPT 구독 — rate limit 기반",
  "agents.usage.note.gemini": "무료: 15 RPM, 1M TPM / 유료: 무제한",
  "agents.usage.empty": "에이전트를 추가하면 사용량이 여기에 표시됩니다.",
  "agents.usage.gauge.rateLimit": "구독: {planLabel} · 한도 사용률",
  "agents.usage.gauge.activity": "구독: {planLabel} · 활동량",
  "agents.usage.level.idle": "대기",
  "agents.usage.level.low": "낮음",
  "agents.usage.level.medium": "보통",
  "agents.usage.level.high": "높음",

  // ── Guide: CLI comparison table ─────────────────────────────
  "agents.guide.cliCompare.title": "AI CLI 비교",
  "agents.guide.cliCompare.col.model": "모델",
  "agents.guide.cliCompare.col.free": "무료 사용",
  "agents.guide.cliCompare.col.strength": "강점",
  "agents.guide.cliCompare.col.install": "설치",
  "agents.guide.cliCompare.claude.free": "Pro/Max 구독 포함",
  "agents.guide.cliCompare.claude.strength":
    "코드 품질, 아키텍처 설계, 복잡한 리팩토링",
  "agents.guide.cliCompare.codex.free": "신규 $5 크레딧",
  "agents.guide.cliCompare.codex.strength": "빠른 반복, API 연동, 간단한 수정",
  "agents.guide.cliCompare.gemini.free": "15 RPM 무료",
  "agents.guide.cliCompare.gemini.strength":
    "긴 컨텍스트(1M), 대규모 코드 분석",

  // ── Guide: which agent to use ───────────────────────────────
  "agents.guide.which.title": "어떤 에이전트를 써야 할까?",
  "agents.guide.which.claude.0": "복잡한 아키텍처 설계/리팩토링",
  "agents.guide.which.claude.1": "코드 리뷰 + 보안 분석",
  "agents.guide.which.claude.2": "멀티파일 변경이 필요한 기능 구현",
  "agents.guide.which.claude.3": "MCP 도구 연동 (Marblo 태스크 관리)",
  "agents.guide.which.codex.0": "빠른 버그 수정 + 핫픽스",
  "agents.guide.which.codex.1": "API 엔드포인트 추가",
  "agents.guide.which.codex.2": "테스트 코드 작성",
  "agents.guide.which.codex.3": "간단한 CRUD 구현",
  "agents.guide.which.gemini.0": "대규모 코드베이스 분석 (1M 토큰 컨텍스트)",
  "agents.guide.which.gemini.1": "문서 생성 + 코드 설명",
  "agents.guide.which.gemini.2": "레거시 코드 이해 + 마이그레이션 계획",
  "agents.guide.which.gemini.3": "비용 절약이 필요한 반복 작업",

  // ── Guide: multi-agent strategy ─────────────────────────────
  "agents.guide.strategy.title": "멀티 에이전트 전략",
  "agents.guide.strategy.independent.title": "독립 에이전트 (분리형)",
  "agents.guide.strategy.independent.when":
    "서로 다른 파일/모듈을 동시에 작업할 때",
  "agents.guide.strategy.independent.example":
    "프론트엔드 에이전트 + 백엔드 에이전트를 각각 실행하여 병렬 개발",
  "agents.guide.strategy.independent.tip":
    "Git 충돌 방지를 위해 작업 범위(scope)를 명확히 분리하세요",
  "agents.guide.strategy.mixed.title": "혼합 모델 전략",
  "agents.guide.strategy.mixed.when": "비용 최적화 + 품질 균형이 필요할 때",
  "agents.guide.strategy.mixed.example":
    "Claude로 아키텍처 설계 → Codex로 반복 구현 → Gemini로 코드 리뷰",
  "agents.guide.strategy.mixed.tip":
    "복잡한 작업은 Claude, 단순 반복은 Codex/Gemini로 비용을 절감하세요",
  "agents.guide.strategy.single.title": "단일 에이전트 (집중형)",
  "agents.guide.strategy.single.when": "하나의 복잡한 작업에 집중할 때",
  "agents.guide.strategy.single.example":
    "대규모 리팩토링, 새로운 기능의 전체 구현",
  "agents.guide.strategy.single.tip":
    "컨텍스트가 중요한 작업은 하나의 에이전트에 맡기는 것이 효율적입니다",

  // ── Guide: setup instructions ───────────────────────────────
  "agents.guide.setup.title": "설치 가이드",
  "agents.guide.setup.step1.title": "CLI 설치",
  "agents.guide.setup.step1.code":
    "npm install -g @anthropic-ai/claude-code  # Claude\nnpm install -g @openai/codex               # Codex\nnpm install -g @google/gemini-cli           # Gemini",
  "agents.guide.setup.step2.title": "인증 설정",
  "agents.guide.setup.step2.code":
    "# Claude: ANTHROPIC_API_KEY 환경변수 또는 Pro/Max 구독\n# Codex:  codex 실행 후 OAuth 브라우저 인증\n# Gemini: Google AI Studio에서 API 키 발급",
  "agents.guide.setup.step3.title": "Marblo에서 에이전트 추가",
  "agents.guide.setup.step3.code":
    "# 1. 'Add Agent' 버튼 클릭\n# 2. 이름, 모델, 역할 선택\n# 3. MCP 연결은 자동 — 태스크 관리 바로 사용 가능",

  // ── Setup Guide (empty state) ───────────────────────────────
  "agents.setupGuide.empty": "에이전트가 없습니다",
  "agents.setupGuide.addFirst": "+ 첫 에이전트 추가",
  "agents.setupGuide.preInstall": "사전 설치 가이드",
  "agents.setupGuide.preInstallDesc":
    "에이전트를 실행하려면 해당 AI CLI가 시스템에 설치되어 있어야 합니다.",
  "agents.setupGuide.install": "설치",
  "agents.setupGuide.run": "실행",
  "agents.setupGuide.note.claude": "Anthropic API 키 필요 (ANTHROPIC_API_KEY)",
  "agents.setupGuide.note.codex": "OpenAI API 키 필요 (OPENAI_API_KEY)",
  "agents.setupGuide.note.gemini": "Google AI API 키 필요",
  "agents.setupGuide.mcp.title": "MCP 연결 (선택)",
  "agents.setupGuide.mcp.desc":
    "터미널에서 직접 CLI를 MCP와 연결하면 에이전트 없이도 티켓을 관리할 수 있습니다.",
};
