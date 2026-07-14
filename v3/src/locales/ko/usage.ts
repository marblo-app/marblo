/**
 * Korean — `usage.*` namespace (Usage tab: totals, weekly token rollup,
 * daily trend, rate-limit status). Model family brand names (Claude/Codex/
 * Gemini/Antigravity) and harness labels stay literal; only chrome, help
 * text, and the "기타/Other" family label are translated.
 */
export const usage = {
  // ── Page header ─────────────────────────────────────────
  "usage.title": "사용량",
  "usage.subtitle":
    "모델·에이전트·일자별 토큰 사용량. 라이브(에이전트 문서) + 히스토리(BigQuery) 합산.",
  "usage.selectProjectPrompt": "프로젝트를 선택하면 사용량이 표시됩니다.",

  // ── Summary cards ───────────────────────────────────────
  "usage.card.totalTokens": "총 토큰",
  "usage.card.inputOutput": "Input / Output",
  "usage.card.cache": "Cache (R/W)",
  "usage.section.byModelAgent": "모델별 / 에이전트별",

  // ── Model family label (only the catch-all is translated) ──
  "usage.modelFamily.other": "기타",

  // ── Weekly token card ───────────────────────────────────
  "usage.weekly.title": "최근 7일 총 토큰량",
  "usage.weekly.tokensSuffix": "tokens · 최근 7일 누적",
  "usage.weekly.empty":
    "아직 최근 7일 토큰 데이터가 없습니다. getCostSummary(BigQuery) 집계 — 새 빌드로 에이전트를 실행하면 채워집니다.",

  // ── Daily trend ─────────────────────────────────────────
  "usage.trend.titleEmpty": "일자별 추이 (모델별)",
  "usage.trend.title": "일자별 추이 (모델별, 최근 {span}일)",
  "usage.trend.empty":
    "아직 일자별 데이터가 없습니다. 모델별 추이는 BigQuery 비용 로그에서 집계됩니다 — 새 빌드로 에이전트를 실행하면 채워집니다.",
  "usage.trend.noUsage": "사용 없음",

  // ── Rate-limit status ───────────────────────────────────
  "usage.rateLimit.title": "한도(Rate limit) 상태",
  "usage.rateLimit.remaining": "{percent}% 남음",
  "usage.rateLimit.weeklyLabel": "주간",
  "usage.rateLimit.noUsage": "사용 없음",
  "usage.rateLimit.window.5h": "5시간",
  "usage.rateLimit.window.weekly": "주간(7일)",
  "usage.rateLimit.weeklyOnly":
    "이 플랜은 주간(7일) 한도만 제공합니다 · 5시간 한도 없음",
  "usage.rateLimit.resetSuffix": "{time} 리셋",
  "usage.rateLimit.note.claude":
    "Max 구독: 5시간/주간 한도 (CLI 자체 관리) · Pro: 일일 제한",
  "usage.rateLimit.note.gpt":
    "rollout 의 rate_limits(5h/주간 window, used_percent) — 라이브 표시 후속",
  "usage.rateLimit.note.gemini":
    "무료: 분당/일일 요청 한도 · 초과 시 프로세스 종료",
  "usage.rateLimit.note.antigravity":
    "개인 Gemini 계정 쿼터 공유 — 쿼터가 가장 빡빡, 초과 잦음",
  "usage.rateLimit.note.none": "한도 정보 없음",
  "usage.rateLimit.footer":
    "Codex 는 5시간·주간(7일) 한도를 rollout 에서 실시간 표기합니다. Claude 주간 한도 표기는 후속(Phase 1b, statusline 캡처)에서 연결됩니다.",

  // ── Relative reset time (fmtReset) ──────────────────────
  "usage.reset.soon": "곧",
  "usage.reset.days": "{n}일 후",
  "usage.reset.hours": "{n}시간 후",
  "usage.reset.minutes": "{n}분 후",
};
