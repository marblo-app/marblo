/**
 * 에스컬레이션 판정 — "오케가 답할 수 있나, 사장님께 물어야 하나"
 * (P5-3, v3/docs/INTELLIGENT-ROUTING-PLAN.md §6 넷-뉴 2).
 *
 * 설계문서가 지적한 갭 ④: 질문 채널은 생겼지만(P5-1) **누가 답할 질문인지**
 * 정하는 규칙이 코드 어디에도 없었다. 그래서 실무에서 두 실패가 번갈아 났다 —
 * 오케가 스스로 답할 수 있는 것을 사장님께 올려 알림 피로를 만들거나, 반대로
 * 사장님만 답할 수 있는 것(제품 판단·비용 결정·비가역 승인)을 오케가 추측으로
 * 때웠다. 후자가 훨씬 비싸다.
 *
 * ── 이 모듈의 지위: 힌트다, 권위가 아니다 ────────────────────────────────
 * 판정은 **오케 PTY 알림에 붙는 한 줄**이고, 최종 결정은 오케가 한다. 규칙기반
 * 분류기가 자연어를 100% 맞출 수 없다는 게 자명하므로, 틀렸을 때의 비용이 낮은
 * 쪽으로 기본값을 잡는다:
 *
 *   §6-2-3 "판정 불명이면 오케가 먼저 답을 시도하고, 근거를 못 찾으면 승격한다
 *   (기본값을 '사장님께 묻기' 로 두면 알림 피로가 온다)."
 *
 * 그래서 **미분류 = orchestrator** 다. owner 판정은 아래 규칙에 걸릴 때만 난다.
 *
 * ── 오검출을 줄이는 방법: 주제어 + 결정단서 ─────────────────────────────
 * "배포 스크립트가 어느 파일에 있나요" 는 `배포` 라는 낱말이 들어 있을 뿐
 * 승인 요청이 아니다. 그래서 비용·비가역·제품판단 세 범주는 **주제어와 결정단서
 * (승인/해도 되나/할까요/…)가 함께** 나타날 때만 owner 로 판정한다. 반대로
 * 관측불가(스크린샷)·모순중재·명시적 지목은 그 자체로 신호가 충분해 단서를
 * 요구하지 않는다.
 */

export type QuestionAudience = "orchestrator" | "owner";

/** 판정 근거를 감사할 수 있게 규칙 id 를 노출한다(로그·테스트가 이걸 본다). */
export type AudienceRule =
  | "explicit-owner"
  | "unobservable"
  | "contradiction"
  | "cost-decision"
  | "irreversible-action"
  | "product-judgment"
  | "codebase-answerable"
  | "scope-recheck"
  | "default-orchestrator-first";

export interface AudienceVerdict {
  audience: QuestionAudience;
  rule: AudienceRule;
  /** 실제로 매칭된 표현들 — 사람이 판정을 즉시 검증할 수 있게. */
  matched: string[];
  /** 사람에게 보여줄 한 줄 근거. */
  reason: string;
}

/** 승인/판단을 구하는 표현. 주제어와 함께 나타나야 owner 로 승격한다. */
const DECISION_CUES: readonly string[] = [
  "승인",
  "허가",
  "허락",
  "재가",
  "해도 되",
  "해도 될",
  "해도 됩",
  "해도되",
  "해도 무방",
  "해도 괜찮",
  "되나요",
  "됩니까",
  "하면 될",
  "진행해도",
  "괜찮을까",
  "괜찮은가",
  "괜찮습니까",
  "될까요",
  "될까",
  "할까요",
  "할까",
  "하시겠",
  "결정해",
  "결정 부탁",
  "결정이 필요",
  "판단 부탁",
  "판단이 필요",
  "어느 쪽",
  "어느쪽",
  "골라",
  "선택해",
  "선택 부탁",
  "approve",
  "approval",
  "should i",
  "should we",
  "may i",
  "ok to",
  "okay to",
  "go ahead",
  "sign off",
];

/** 비용/과금 결정. */
const COST_TOPICS: readonly string[] = [
  "비용",
  "과금",
  "요금",
  "단가",
  "예산",
  "결제",
  "크레딧",
  "구독",
  "청구",
  "지출",
  "cost",
  "pricing",
  "billing",
  "budget",
  "spend",
  // 고비용 effort 상단 — 이 두 낱말이 나오면 사실상 비용 결정이다.
  "max effort",
  "ultra effort",
];

/** 비가역·외부영향 행위. */
const IRREVERSIBLE_TOPICS: readonly string[] = [
  "배포",
  "릴리스",
  "릴리즈",
  "머지",
  "병합",
  "푸시",
  "force-push",
  "강제 푸시",
  "발송",
  "메일 보내",
  "이메일 보내",
  "전송",
  "공개",
  "삭제",
  "드롭",
  "롤백",
  "deploy",
  "release",
  "merge",
  "publish",
  "rollback",
  "drop table",
  "send email",
  "broadcast",
];

/** 제품 판단(무엇을 만들지). */
const PRODUCT_TOPICS: readonly string[] = [
  "제품 방향",
  "제품 판단",
  "무엇을 만들",
  "뭘 만들",
  "만들지",
  "스펙 결정",
  "요구사항 결정",
  "ux",
  "사용자 경험",
  "문구",
  "네이밍",
  "가격 정책",
  "기능을 넣",
  "기능 추가할",
  "roadmap",
  "product direction",
  "which feature",
];

/**
 * 오케가 관측할 수 없는 것. ★"화면" 같은 흔한 낱말은 단독으로 쓰지 않는다 —
 * 프론트엔드 작업 질문 전체가 owner 로 새기 때문에 관측 행위와 붙은 구를 쓴다.
 */
const UNOBSERVABLE_TOPICS: readonly string[] = [
  "스크린샷",
  "스샷",
  "캡처해",
  "캡쳐해",
  "육안",
  "눈으로",
  "화면에 보이",
  "화면을 보고",
  "화면 보고",
  "실제로 보이",
  "직접 보이",
  "앱에서 보이",
  "라이브에서 보이",
  "어떻게 보이",
  "screenshot",
  "what do you see",
  "can you see",
];

/** 서로 모순되는 지시의 중재. */
const CONTRADICTION_TOPICS: readonly string[] = [
  "모순",
  "상충",
  "충돌하는 지시",
  "지시가 다르",
  "지시가 서로",
  "앞서 말씀과 다르",
  "이전 지시와 다르",
  "어느 지시를 따라",
  "conflicting instruction",
  "contradict",
];

/** 사장님(사용자)을 직접 지목한 경우. */
const EXPLICIT_OWNER_TOPICS: readonly string[] = [
  "사장님께",
  "사장님 확인",
  "사장님 승인",
  "사장님이 결정",
  "사장님 결정 필요",
  "대표님",
  "사용자 승인",
  "사용자에게 확인",
  "owner approval",
  "user approval",
  "ask the owner",
];

/** 오케가 코드베이스/이력에서 답할 수 있는 부류. */
const CODEBASE_TOPICS: readonly string[] = [
  "어느 파일",
  "어디에 있",
  "어디 있",
  "무슨 함수",
  "어떤 함수",
  "코드베이스",
  "구현이 어디",
  "git 이력",
  "커밋",
  "로그를 보면",
  "테스트가 어디",
  "which file",
  "where is",
  "codebase",
];

/** 티켓 본문/스코프/우선순위 재확인 — 이미 결정된 사안. */
const SCOPE_TOPICS: readonly string[] = [
  "스코프",
  "범위에 포함",
  "이 티켓에",
  "티켓 본문",
  "우선순위",
  "선행 티켓",
  "의존성",
  "이미 결정",
  "재확인",
  "scope",
  "priority",
  "already decided",
];

function findMatches(haystack: string, needles: readonly string[]): string[] {
  return needles.filter((n) => haystack.includes(n));
}

/**
 * 질문 본문으로 수신자를 판정한다. 순수 함수 — 같은 입력에 늘 같은 판정이라
 * 유닛으로 기준 자체를 고정할 수 있다(티켓 완료기준 "판정기준 유닛").
 */
export function classifyQuestionAudience(text: string): AudienceVerdict {
  const t = (text || "").toLowerCase();

  // ── 단서 없이도 owner 인 세 범주(신호가 그 자체로 충분) ────────────
  const explicit = findMatches(t, EXPLICIT_OWNER_TOPICS);
  if (explicit.length) {
    return {
      audience: "owner",
      rule: "explicit-owner",
      matched: explicit,
      reason: "질문이 사용자(사장님) 판단을 직접 지목했다.",
    };
  }

  const unobservable = findMatches(t, UNOBSERVABLE_TOPICS);
  if (unobservable.length) {
    return {
      audience: "owner",
      rule: "unobservable",
      matched: unobservable,
      reason:
        "오케가 관측할 수 없는 것(화면·스크린샷·라이브 상태)을 묻고 있다 — 코드로 답할 수 없다.",
    };
  }

  const contradiction = findMatches(t, CONTRADICTION_TOPICS);
  if (contradiction.length) {
    return {
      audience: "owner",
      rule: "contradiction",
      matched: contradiction,
      reason: "서로 모순되는 지시의 중재는 지시를 낸 쪽만 풀 수 있다.",
    };
  }

  // ── 주제어 + 결정단서가 함께여야 owner 인 세 범주 ──────────────────
  const cues = findMatches(t, DECISION_CUES);
  if (cues.length) {
    const cost = findMatches(t, COST_TOPICS);
    if (cost.length) {
      return {
        audience: "owner",
        rule: "cost-decision",
        matched: [...cost, ...cues],
        reason: "비용/과금 결정은 사장님 몫이다(§6-2).",
      };
    }
    const irreversible = findMatches(t, IRREVERSIBLE_TOPICS);
    if (irreversible.length) {
      return {
        audience: "owner",
        rule: "irreversible-action",
        matched: [...irreversible, ...cues],
        reason:
          "비가역·외부영향 행위(배포·머지·발송·삭제) 승인은 사장님 몫이다(§6-2).",
      };
    }
    const product = findMatches(t, PRODUCT_TOPICS);
    if (product.length) {
      return {
        audience: "owner",
        rule: "product-judgment",
        matched: [...product, ...cues],
        reason: "무엇을 만들지에 대한 제품 판단은 사장님 몫이다(§6-2).",
      };
    }
  }

  // ── 오케 자체해결 신호 ────────────────────────────────────────────
  const codebase = findMatches(t, CODEBASE_TOPICS);
  if (codebase.length) {
    return {
      audience: "orchestrator",
      rule: "codebase-answerable",
      matched: codebase,
      reason:
        "코드베이스·git 이력에서 답이 나오는 질문 — 오케가 직접 확인해 답한다.",
    };
  }
  const scope = findMatches(t, SCOPE_TOPICS);
  if (scope.length) {
    return {
      audience: "orchestrator",
      rule: "scope-recheck",
      matched: scope,
      reason:
        "스코프·우선순위·이미 결정된 사안의 재확인 — 티켓 본문과 결정 이력으로 답한다.",
    };
  }

  // ── 미분류 = 오케 우선(§6-2-3). 근거를 못 찾으면 그때 승격한다. ──
  return {
    audience: "orchestrator",
    rule: "default-orchestrator-first",
    matched: [],
    reason:
      "판정 불명 — §6-2-3 대로 오케가 먼저 답을 시도하고, 근거를 못 찾으면 escalate_to_owner 로 승격한다.",
  };
}

/** 오케 PTY 알림 하단에 붙는 판정 한 줄(+ 승격 방법). */
export function formatAudienceHint(
  verdict: AudienceVerdict,
  questionId: string,
): string {
  if (verdict.audience === "owner") {
    return [
      `★판정: 사장님 필요 (${verdict.rule}) — ${verdict.reason}`,
      verdict.matched.length
        ? `  근거 표현: ${verdict.matched.join(", ")}`
        : "",
      `  → 사장님께 물으려면: escalate_to_owner(question_id="${questionId}")`,
      "  (판정은 힌트다 — 오케가 직접 답할 근거가 있으면 그대로 answer_question 하라.)",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `판정: 오케 자체해결 (${verdict.rule}) — ${verdict.reason}`,
    `  → 근거를 못 찾으면 승격: escalate_to_owner(question_id="${questionId}")`,
  ].join("\n");
}

/**
 * 사장님께 보낼 텔레그램 본문. ★전문을 싣는다 — 300자 절단은 이 채널이
 * 없애려던 바로 그 결함이다(§6 갭 ②). 텔레그램 자체 한도(4096자)는 호출자가
 * 다루고, 여기서는 잘렸다는 사실을 숨기지 않는다.
 */
export function formatOwnerEscalation(input: {
  questionId: string;
  taskId: string;
  taskTitle: string;
  askedBy: string;
  question: string;
  verdict?: AudienceVerdict;
  note?: string;
}): string {
  const lines = [
    `[사장님 확인 요청] ${input.taskTitle}`,
    `티켓 ${input.taskId} / 질문 ${input.questionId} / 에이전트 ${
      input.askedBy || "unknown"
    }`,
  ];
  if (input.verdict) {
    lines.push(`판정: ${input.verdict.rule} — ${input.verdict.reason}`);
  }
  lines.push("", input.question);
  if (input.note?.trim()) {
    lines.push("", `[오케 메모] ${input.note.trim()}`);
  }
  lines.push(
    "",
    "이 메시지에 그대로 답장하시면 오케가 받아 에이전트에게 전달합니다.",
  );
  return lines.join("\n");
}

/** 텔레그램 1건 한도(공식 4096자). 넘치면 잘렸다는 사실을 본문에 남긴다. */
export const TELEGRAM_MAX_CHARS = 4096;

export function clampForTelegram(body: string): {
  value: string;
  truncated: boolean;
} {
  if (body.length <= TELEGRAM_MAX_CHARS) {
    return { value: body, truncated: false };
  }
  const notice = `\n\n[…원문 ${body.length}자 중 뒷부분이 잘렸습니다. 전문은 get_open_questions 로 확인]`;
  return {
    value: `${body.slice(0, TELEGRAM_MAX_CHARS - notice.length)}${notice}`,
    truncated: true,
  };
}
