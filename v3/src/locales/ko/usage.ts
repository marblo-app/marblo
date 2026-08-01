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
  // 라벨은 `common.period.*` 로 옮겼다 — 작업내역 탭과 공용 컨트롤이라
  // 한쪽에서만 고치면 두 화면 문구가 갈라진다.

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
  "usage.rateLimit.note.grok":
    "Grok Build CLI 0.2.117 실측: usage/account/quota 명령 없음 — SuperGrok 잔여 한도 수치 미제공",
  "usage.rateLimit.note.gemini":
    "무료: 분당/일일 요청 한도 · 초과 시 프로세스 종료",
  "usage.rateLimit.note.antigravity":
    "개인 Gemini 계정 쿼터 공유 — 쿼터가 가장 빡빡, 초과 잦음",
  "usage.rateLimit.note.none": "한도 정보 없음",
  "usage.rateLimit.unavailable": "조회불가",
  "usage.rateLimit.unavailableTip":
    "이 벤더는 잔여 한도 조회 API 를 제공하지 않습니다 — 수치를 지어내지 않고 비웁니다. 실제 소진 현황은 위 '벤더 크레딧 · 쿼터' 의 벤더 콘솔 링크에서 확인하세요.",
  "usage.rateLimit.footer":
    "행은 벤더 단위입니다 — 같은 claude 바이너리로 떠도 GLM·MiniMax·Kimi 는 별도 쿼터입니다. 수치는 계정 프로브가 실재하는 Claude(Anthropic)·Codex(OpenAI) 만 표시하고, Grok(xAI)은 CLI 실측상 잔여 한도 명령이 없어 미지원으로 비웁니다. 나머지 벤더도 조회 API 가 없어 비웁니다. Claude 주간 한도 표기는 후속(Phase 1b, statusline 캡처)에서 연결됩니다.",

  // ── Model fact sheet (접이식 · 기본 접힘) ────────────────
  // 벤치 이름(SWE-bench Verified/Pro …)과 하네스 이름은 고유명사라 번역하지
  // 않는다 — 출처 화면에 적힌 표기가 그대로 보여야 대조가 된다.
  "usage.factSheet.title": "모델 단가 · 성능 · 컨텍스트",
  "usage.factSheet.hint": "펼쳐서 보기",
  "usage.factSheet.loading": "모델 정보를 불러오는 중…",
  "usage.factSheet.error":
    "모델 정보를 불러오지 못했습니다(Electron 브리지 응답 없음).",
  "usage.factSheet.retry": "다시 시도",
  "usage.factSheet.empty":
    "표시할 모델이 없습니다. 이 표는 모델 레지스트리에서 직접 읽습니다.",
  "usage.factSheet.colModel": "모델",
  "usage.factSheet.colInput": "Input $/1M",
  "usage.factSheet.colOutput": "Output $/1M",
  "usage.factSheet.colBench": "SWE-bench (개략)",
  "usage.factSheet.colContext": "컨텍스트",
  // ★{variant} 가 이미 "SWE-bench Pro" 처럼 벤치 이름을 통째로 들고 온다
  // (출처 표기 그대로라서). 앞에 "SWE-bench" 를 또 붙이면 헤더가
  // "SWE-bench SWE-bench Pro" 가 된다.
  "usage.factSheet.colBenchVariant": "{variant} (개략)",

  // ── ★기준(변형) 고정 ────────────────────────────────────
  // SWE-bench 는 문제집합이 다른 4종이라, 열 하나에 두 변형을 섞으면 뺄셈이
  // 성립하지 않는 두 수가 나란히 선다(Verified 96 vs Pro 64.6 = 이 화면이 실제로
  // 낸 오독). 그래서 한 번에 한 변형만 고를 수 있다.
  "usage.factSheet.basisLabel": "기준",
  "usage.factSheet.basisNote":
    "이 표와 차트의 SWE-bench 는 전부 {variant} 한 가지 기준으로 맞췄습니다({n}/{total} 모델에 공식 수치 존재). 다른 변형(Verified·Pro 등)은 문제집합이 다른 별개 시험이라 서로 빼거나 순위를 매길 수 없어 한 번에 하나만 보여 줍니다 — 기준을 바꾸면 표·차트가 함께 바뀝니다.",
  "usage.factSheet.basisTip":
    "SWE-bench 는 하나의 시험이 아니라 문제집합이 다른 4종(Verified·Pro·Multilingual·Multimodal)입니다. 벤더마다 공개하는 변형이 달라서(예: OpenAI 는 Pro 만, Anthropic 은 넷 다) 예전엔 모델마다 있는 변형을 골라 한 열에 넣었고, 그 결과 Verified 96 과 Pro 64.6 이 나란히 서서 능력차로 읽혔습니다. 지금은 열의 기준을 하나로 고정하고, 그 기준에 값이 없는 모델은 낮은 점수가 아니라 '확인 필요' 로 비웁니다. 기본 기준은 손으로 정한 것이 아니라 지금 데이터에서 가장 많은 모델을 같은 자로 잴 수 있는 변형이 자동으로 뽑힙니다.",
  "usage.factSheet.benchNoVariantRow":
    "이 모델은 {variant} 기준 공식 수치가 없습니다(다른 변형의 점수로 대신 채우지 않습니다).",

  // ── ★단가 + SWE-bench 막대차트 ──────────────────────────
  "usage.factSheet.chart.title": "단가 · 성능 한눈 비교",
  "usage.factSheet.chart.subtitle":
    "{variant} 점수 높은 순. 공식 수치가 있는 {n}/{total} 모델만 막대가 그려지고, 나머지는 길이 0 이 아니라 '확인 필요' 입니다. 단가와 점수는 단위가 달라 축을 공유하지 않습니다(두 패널).",
  "usage.factSheet.chart.priceAxis": "단가 $/1M 토큰",
  "usage.factSheet.chart.priceTip":
    "모델 레지스트리 단가 그대로입니다. 위쪽 연한 막대가 input, 아래쪽 진한 막대가 output 입니다. 코딩 에이전트 비용은 대개 output 이 지배합니다.",
  "usage.factSheet.chart.benchAxis": "{variant} % resolved",
  "usage.factSheet.chart.benchTip":
    "축은 항상 0~100 고정입니다. 최고점에 맞춰 축을 좁히면 1위가 만점처럼 보이고 모델 간 차이도 실제보다 커 보입니다.",
  "usage.factSheet.chart.input": "input",
  "usage.factSheet.chart.inputTip": "입력 토큰 100만 개당 단가.",
  "usage.factSheet.chart.output": "output",
  "usage.factSheet.chart.outputTip": "출력 토큰 100만 개당 단가.",
  "usage.factSheet.chart.noScoreLegend": "막대 없음 = 확인 필요",
  "usage.factSheet.chart.noScoreTip":
    "이 기준의 공식 수치를 못 찾은 모델입니다. 0 점이 아니라 미확인이라, 막대를 그리지 않습니다.",
  "usage.factSheet.chart.rowPriceTip":
    "{model} — input {input} / output {output} (100만 토큰당)",
  "usage.factSheet.chart.rowBenchTip":
    "{model} — {variant} {score}% · 스캐폴드 {harness}",
  "usage.factSheet.maxOutput": "최대 출력 {n}",
  "usage.factSheet.estimated": "추정",
  "usage.factSheet.estimatedTip":
    "벤더 공식 리스트 단가를 그대로 쓸 수 없는 칸입니다(정액 구독 경로라 실 한계비용이 다르거나, 과금축 자체가 다름). 과소보고를 피하는 방향의 보수적 상한입니다.",
  "usage.factSheet.unknown": "확인 필요",
  "usage.factSheet.benchNoRow": "이 모델의 벤치 참조 행이 아직 없습니다.",
  "usage.factSheet.altMeasure": "타 측정 {harness} · {date}: {score}%",
  "usage.factSheet.altMeasureTip":
    "같은 모델·같은 벤치의 다른 측정입니다. 스캐폴드가 다르거나(벤더 자체 vs 공식 리더보드), 같은 벤더가 다른 날 다시 발표한 값입니다. 이만큼 움직이므로 이 열은 순위표가 아니라 자릿수 감각입니다.",
  // ── 티어 묶음(프리미어 · 일반작업 · 가성비) ──────────────
  "usage.factSheet.tier.all": "전체",
  "usage.factSheet.tier.count": "{n}개",
  "usage.factSheet.tier.premier": "프리미어",
  "usage.factSheet.tier.premierDesc": "최고 성능이 필요할 때",
  "usage.factSheet.tier.standard": "일반작업",
  "usage.factSheet.tier.standardDesc": "중간 등급",
  "usage.factSheet.tier.value": "가성비",
  "usage.factSheet.tier.valueDesc": "저단가 · 성능 준수",
  "usage.factSheet.tier.ruleTip":
    "티어는 모델 목록을 손으로 적어 둔 것이 아니라 이 표의 사실에서 파생됩니다. 기본은 레지스트리 능력등급(frontier·top → 프리미어, mid → 일반작업, cheap → 가성비)이고, 여기에 가성비 판정이 한 방향으로만 더해집니다: 일반작업 중 output 단가가 표 중앙값 이하이면서 성능/단가 비가 중앙값 이상인 모델만 가성비로 올립니다. 성능은 서로 다른 벤치를 섞지 않도록 같은 벤치 최고점 대비 비율로 환산해 씁니다. 값이 싸다는 이유로 프리미어를 내리지는 않습니다 — 싼 프리미어는 여전히 프리미어입니다.",
  "usage.factSheet.tierFooter":
    "티어는 위 숫자에서 자동으로 파생됩니다(레지스트리 능력등급 + 성능/단가 비). 새 모델이 레지스트리에 추가되면 이 표에서 알아서 제 묶음에 들어갑니다. 공식 벤치 수치가 없는 모델은 '싸다'만 알고 '성능이 준수하다'는 모르므로 가성비로 올리지 않습니다. 벤치 조건이 모델마다 달라 이 구분도 정밀한 순위가 아니라 **개략**입니다. 티어는 모델 고유 속성이라 위의 기준(벤치 변형)을 바꿔도 흔들리지 않습니다 — 표의 셀은 고른 변형을 그리지만, 티어는 그 모델의 대표 벤치 한 칸으로만 판정합니다.",
  "usage.factSheet.footer":
    "단가는 모델 레지스트리(electron/model-registry.ts) 단일소스에서 그대로 읽습니다 — 레지스트리에 모델이 추가되면 이 표에 자동 반영됩니다. SWE-bench 는 문제집합이 다른 4종이고 모델마다 벤치·스캐폴드 조건이 달라 **개략** 값입니다. 각 수치의 1차 출처와 관측일은 셀 아래 링크에 있고, 공식 수치를 못 찾은 칸은 지어내지 않고 '확인 필요' 로 둡니다.",

  // ── Relative reset time (fmtReset) ──────────────────────
  "usage.reset.soon": "곧",
  "usage.reset.days": "{n}일 후",
  "usage.reset.hours": "{n}시간 후",
  "usage.reset.minutes": "{n}분 후",
};
