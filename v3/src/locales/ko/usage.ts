/**
 * Korean — `usage.*` namespace (Usage tab: 기간 선택기, totals, 벤더·하위모델
 * 분해, 에이전트↔실모델, 벤더 크레딧/쿼터,
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

  // ── Period selector ─────────────────────────────────────
  "usage.period.label": "기간",
  "usage.period.7d": "7일",
  "usage.period.30d": "30일",
  "usage.period.all": "전체",

  // ── Summary cards ───────────────────────────────────────
  "usage.card.totalTokens": "총 토큰",
  "usage.card.inputOutput": "Input / Output",
  "usage.card.cache": "Cache (R/W)",
  "usage.card.cost": "비용",
  "usage.section.byModelAgent": "모델별 / 에이전트별",
  "usage.totals.rangeNote":
    "선택 기간({period}) 기준 · BigQuery cost_logs 집계",
  "usage.totals.liveNote":
    "선택 기간에 BigQuery 행이 없어 라이브 누적(에이전트 문서 전체 합)으로 표시합니다 — 기간 필터가 적용되지 않은 수치입니다.",

  // ── Model family label (only the catch-all is translated) ──
  "usage.modelFamily.other": "기타",

  // ── Vendor → submodel breakdown ─────────────────────────
  "usage.breakdown.title": "벤더 · 하위모델별 분해",
  "usage.breakdown.loading": "집계를 불러오는 중…",
  "usage.breakdown.empty":
    "선택 기간에 기록된 사용량이 없습니다. 분해는 BigQuery cost_logs 의 실제 실행 모델 id 로 집계됩니다.",
  "usage.breakdown.modelCount": "모델 {n}개",
  "usage.breakdown.modelUnknown": "모델 미기록",
  "usage.breakdown.vendorUnknown": "벤더 미상",
  "usage.breakdown.unregistered": "미등록",
  "usage.breakdown.unregisteredTip":
    "모델 레지스트리에 없는 id 입니다. 벤더는 id 프리픽스로 추정한 값이며, 비용 단가도 이 id 로는 확정되지 않습니다.",
  "usage.breakdown.estimated": "단가 추정",
  "usage.breakdown.estimatedTip":
    "이 모델의 단가는 벤더 공식 리스트가 아닌 보수적 추정치입니다(과소보고를 피하는 방향). 정액 구독 경로라 실 한계비용은 더 낮을 수 있습니다.",
  "usage.breakdown.footer":
    "벤더는 모델 레지스트리(단일소스)에서 해석합니다 — 같은 claude 바이너리로 떠도 GLM·MiniMax 는 별도 벤더로 분리됩니다. 비용은 기록된 단가 기준이며 정액 구독 구간에서는 명목값입니다.",

  // ── Agent ↔ actual model ────────────────────────────────
  "usage.agentModel.title": "에이전트 ↔ 실제 실행 모델",
  "usage.agentModel.empty": "이 프로젝트에 에이전트가 없습니다.",
  "usage.agentModel.colAgent": "에이전트",
  "usage.agentModel.colHarness": "하네스",
  "usage.agentModel.colModel": "실제 실행 모델",
  "usage.agentModel.colSource": "근거",
  "usage.agentModel.noModel": "기록 없음",
  "usage.agentModel.source.detected": "과금 세션 관측",
  "usage.agentModel.source.spawned": "스폰 argv",
  "usage.agentModel.source.none": "—",
  "usage.agentModel.footer":
    "모델 id 는 관측값만 씁니다 — 과금 세션 메타데이터(detectedModelId)가 우선, 없으면 메인 프로세스가 실제 argv 를 되읽은 값(spawnedModel). 둘 다 없으면 추측하지 않고 비웁니다.",

  // ── Vendor credits / quota ──────────────────────────────
  "usage.credits.title": "벤더 크레딧 · 쿼터",
  "usage.credits.axis.subscription": "구독",
  "usage.credits.axis.subscriptionQuota": "구독 쿼터(5시간+주간)",
  "usage.credits.axis.unknown": "과금축 미상",
  "usage.credits.unavailable": "조회불가",
  "usage.credits.noApi":
    "벤더가 잔여 쿼터 조회 API 를 공개하지 않습니다(1차 문서 전수 확인). 실제 소진 현황은 벤더 콘솔에서 확인하세요.",
  "usage.credits.subscriptionNote":
    "구독형이라 선불 잔액 개념이 없습니다. 남은 한도는 아래 '한도(Rate limit) 상태' 에 실측으로 표시됩니다.",
  "usage.credits.console": "벤더 콘솔 열기",
  "usage.credits.keySet": "크레덴셜 설정됨 ({keys})",
  "usage.credits.keyMissing": "크레덴셜 없음 ({keys})",
  "usage.credits.footer":
    "이 패널은 수치를 추정하지 않습니다. 크레덴셜 상태는 메인 프로세스가 판정한 실측값이며 키 이름만 표시하고 값은 렌더러로 내려오지 않습니다.",

  // ── Daily trend ─────────────────────────────────────────
  "usage.trend.titleEmpty": "일자별 추이 (벤더별)",
  "usage.trend.title": "일자별 추이 (벤더별, 최근 {span}일)",
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
