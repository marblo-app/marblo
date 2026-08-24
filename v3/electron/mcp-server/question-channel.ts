/**
 * 타입드 질문 채널 (P5-1, INTELLIGENT-ROUTING-PLAN §6).
 *
 * 지금까지 에이전트의 질문은 `add_activity` 평문으로만 흘렀다. 그래서
 *   - 질문·진행보고·완료보고가 한 스트림에 섞이고,
 *   - 질문 id 도 "답변 대기" 상태도 없어 답과 질문을 이을 수 없고,
 *   - 오케 PTY 로 나갈 때 300자에서 잘려(`tools.ts` add_activity) 긴 질의는 몸통이 사라졌다.
 *
 * 이 모듈은 그 위에 최소 프로토콜만 얹는다: 질문에 id 를 주고(`ask_orchestrator`),
 * 답을 그 id 로 잇고(`answer_question`), 상태(open/answered)를 티켓에 남긴다.
 * Firestore/네트워크 의존이 없어 상관관계·무손실·용량 규칙을 유닛으로 고정할 수 있다.
 *
 * 저장 위치: `tasks/{taskId}.questions` 배열. 새 컬렉션을 만들지 않은 이유는
 * 보안룰(firestore.rules)이 기본 거부라 새 컬렉션은 룰 배포가 선행돼야 하는데,
 * tasks 는 이미 프로젝트 멤버 업데이트가 허용돼 있어 배포 없이 바로 산다.
 * 시각은 Firestore Timestamp 가 아니라 epoch ms 정수로 둔다 — 배열 원소로 다루기
 * 쉽고 이 모듈을 순수하게 유지한다.
 */

import type { QuestionAudience } from "./escalation-policy.js";

export type QuestionStatus = "open" | "answered";

/** 사장님 승격 기록 — 언제·누가 올렸고 실제로 전달됐는지(P5-3). */
export interface OwnerEscalation {
  at: number;
  /** 승격을 실행한 주체(오케 id). */
  by: string;
  /** 텔레그램 전달 결과. failed 는 숨기지 않는다(조용한 유실 금지). */
  delivery: "sent" | "failed";
  /** 실패 사유 또는 오케 메모. */
  note?: string;
}

export interface QuestionEntry {
  /** `<taskId>#q<base36>` — 티켓을 자기기술하는 상관키(§아래 parseQuestionId). */
  id: string;
  /** 질문 전문. ★300자 절단 금지 — 이 채널의 존재 이유. */
  question: string;
  status: QuestionStatus;
  /** 질문한 에이전트 id (답변 회신 대상). 없으면 "". */
  askedBy: string;
  /** epoch ms. */
  askedAt: number;
  /** 진짜 진행 불가일 때만 true. 기본은 비차단(역할스킬 규정). */
  blocking: boolean;
  answer?: string;
  answeredBy?: string;
  answeredAt?: number;
  /**
   * 답변을 질문자 PTY 로 보낸 결과 — queued(전달 큐 등록) / failed(전달 불가).
   *
   * ★"queued" 를 "전달 완료" 로 읽지 마라. 이 값은 pendingInstructions 문서를
   *   만든 시점에 찍히며, 그 뒤의 PTY 주입 결과는 여기로 돌아오지 않는다.
   *   그리고 주입 자체도 성공을 보장하지 못한다 — 실측(tests/integration/
   *   answer-delivery-composer.cjs)에서 (a) 컴포저에 초안이 물려 있으면 답이
   *   초안과 한 덩어리로 섞여 제출되고, (b) 턴 중이면 제출이 0건인데도
   *   writeAndSubmit 이 true 를 돌려주며, (c) 확인 다이얼로그에 서 있으면 답의
   *   첫 글자가 선택으로 소비된다. 즉 queued 는 **'큐에 넣었다'** 그 이상도
   *   이하도 아니다. 답 이후의 침묵을 에이전트 탓으로 읽기 전에 이 사실을 먼저
   *   떠올려야 한다(agent-stall-policy.ts evaluateAnswerQuiet).
   */
  answerDelivery?: "queued" | "failed";
  /**
   * P5-3 판정: 이 질문을 누가 답해야 하나(`escalation-policy` 의 규칙기반 힌트).
   * ★권위가 아니라 힌트다 — 최종 판단은 오케가 한다.
   */
  audience?: QuestionAudience;
  /** 사장님께 승격된 기록. 없으면 아직 오케 선에서 다루는 질문이다. */
  ownerEscalation?: OwnerEscalation;
  /**
   * 고비용 칸 승인 요청 질문이면 그 칸 라벨(`model@effort`).
   * 승인 레코드(`tasks/{id}.modelEscalations`)와 이 질문을 잇는 열쇠.
   */
  approvalFor?: string;
}

/** 티켓 1건이 보관하는 질문 수 상한(문서 비대 방지). 넘치면 오래된 answered 부터 정리. */
export const MAX_QUESTIONS_PER_TASK = 40;

/**
 * 질문/답변 1건의 문자 상한. 300자 절단을 없애는 게 목적이므로 넉넉하게 두되,
 * Firestore 문서 1MB 한도를 지키기 위한 안전선은 남긴다. 잘릴 때는 반드시
 * 잘렸다는 사실을 본문과 호출 결과에 명시한다(조용한 절단 금지).
 */
export const MAX_QUESTION_CHARS = 20_000;

export interface ClampResult {
  value: string;
  truncated: boolean;
  originalLength: number;
}

export function clampQuestionText(
  raw: string,
  max = MAX_QUESTION_CHARS,
): ClampResult {
  const originalLength = raw.length;
  if (originalLength <= max) {
    return { value: raw, truncated: false, originalLength };
  }
  const notice = `\n\n[...${
    originalLength - max
  }자 초과분이 잘렸습니다 — 원문 ${originalLength}자]`;
  return {
    value: `${raw.slice(0, max)}${notice}`,
    truncated: true,
    originalLength,
  };
}

/**
 * questionId 는 taskId 를 접두로 품는다. 답변자가 task_id 를 따로 안 넘겨도
 * 어느 티켓의 질문인지 되찾을 수 있어야 상관관계가 실무에서 끊기지 않는다
 * (Firestore 배열 원소는 인덱스 조회가 불가능하다).
 */
export function newQuestionId(taskId: string, seed: string): string {
  return `${taskId}#q${seed}`;
}

export function parseQuestionId(
  questionId: string,
): { taskId: string; ok: true } | { taskId: null; ok: false } {
  const idx = questionId.indexOf("#q");
  if (idx <= 0) return { taskId: null, ok: false };
  return { taskId: questionId.slice(0, idx), ok: true };
}

/** Firestore 에서 읽은 임의 값에서 질문 배열을 안전하게 복원한다. */
export function readQuestions(value: unknown): QuestionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: QuestionEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.question !== "string") continue;
    const status: QuestionStatus =
      r.status === "answered" ? "answered" : "open";
    const entry: QuestionEntry = {
      id: r.id,
      question: r.question,
      status,
      askedBy: typeof r.askedBy === "string" ? r.askedBy : "",
      askedAt: typeof r.askedAt === "number" ? r.askedAt : 0,
      blocking: r.blocking === true,
    };
    if (typeof r.answer === "string") entry.answer = r.answer;
    if (typeof r.answeredBy === "string") entry.answeredBy = r.answeredBy;
    if (typeof r.answeredAt === "number") entry.answeredAt = r.answeredAt;
    if (r.answerDelivery === "queued" || r.answerDelivery === "failed") {
      entry.answerDelivery = r.answerDelivery;
    }
    if (r.audience === "owner" || r.audience === "orchestrator") {
      entry.audience = r.audience;
    }
    if (typeof r.approvalFor === "string") entry.approvalFor = r.approvalFor;
    const esc = r.ownerEscalation;
    if (esc && typeof esc === "object") {
      const e = esc as Record<string, unknown>;
      if (e.delivery === "sent" || e.delivery === "failed") {
        entry.ownerEscalation = {
          at: typeof e.at === "number" ? e.at : 0,
          by: typeof e.by === "string" ? e.by : "",
          delivery: e.delivery,
          ...(typeof e.note === "string" ? { note: e.note } : {}),
        };
      }
    }
    out.push(entry);
  }
  return out;
}

/**
 * 질문을 추가한다. 상한을 넘으면 **답변이 끝난** 오래된 질문부터 비운다 —
 * 미답 질문(open)은 마지막까지 남긴다. 답을 기다리는 질문이 정리에 밀려
 * 사라지는 것이 이 채널이 막으려던 바로 그 유실이기 때문이다.
 */
export function appendQuestion(
  existing: QuestionEntry[],
  entry: QuestionEntry,
  max = MAX_QUESTIONS_PER_TASK,
): QuestionEntry[] {
  const next = [...existing, entry];
  if (next.length <= max) return next;

  const overflow = next.length - max;
  const answeredIdx = next
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.status === "answered")
    .slice(0, overflow)
    .map(({ i }) => i);
  const dropping = new Set(answeredIdx);
  // answered 만으로 부족하면 가장 오래된 것부터(방금 넣은 것 제외) 마저 비운다.
  for (let i = 0; i < next.length - 1 && dropping.size < overflow; i++) {
    dropping.add(i);
  }
  return next.filter((_, i) => !dropping.has(i));
}

export type AnswerOutcome =
  | { ok: true; entries: QuestionEntry[]; entry: QuestionEntry }
  | {
      ok: false;
      reason: "not-found" | "already-answered";
      entry?: QuestionEntry;
    };

/**
 * 질문에 답을 잇는다. 이미 답이 달린 질문에 덮어쓰지 않는다 — 답변 이력이
 * 조용히 교체되면 "누가 무엇을 답했나" 가 사라지므로 명시적으로 거부한다.
 */
export function answerQuestion(
  entries: QuestionEntry[],
  questionId: string,
  answer: string,
  answeredBy: string,
  answeredAt: number,
): AnswerOutcome {
  const idx = entries.findIndex((q) => q.id === questionId);
  if (idx < 0) return { ok: false, reason: "not-found" };
  const found = entries[idx];
  if (found.status === "answered") {
    return { ok: false, reason: "already-answered", entry: found };
  }
  const updated: QuestionEntry = {
    ...found,
    status: "answered",
    answer,
    answeredBy,
    answeredAt,
  };
  const next = [...entries];
  next[idx] = updated;
  return { ok: true, entries: next, entry: updated };
}

/** 답변 전달 결과를 해당 질문에 기록한다(전달 실패도 티켓에 남긴다). */
export function markAnswerDelivery(
  entries: QuestionEntry[],
  questionId: string,
  delivery: "queued" | "failed",
): QuestionEntry[] {
  return entries.map((q) =>
    q.id === questionId ? { ...q, answerDelivery: delivery } : q,
  );
}

export function openQuestions(entries: QuestionEntry[]): QuestionEntry[] {
  return entries.filter((q) => q.status === "open");
}

/**
 * 오케 PTY 로 나갈 질문 알림. ★전문을 그대로 싣는다(300자 절단 없음) —
 * 잘린 질문은 답할 수 없기 때문에 이 채널의 핵심 계약이다.
 */
export function formatQuestionNotification(input: {
  questionId: string;
  taskId: string;
  taskTitle: string;
  askedBy: string;
  roleLabel: string;
  question: string;
  blocking: boolean;
  /** P5-3 판정 힌트(escalation-policy.formatAudienceHint). 없으면 생략. */
  audienceHint?: string;
}): string {
  const flag = input.blocking ? " ★차단(blocking)" : "";
  return [
    `[Question]${flag} "${input.taskTitle}" (${input.roleLabel}, task=${input.taskId}, agent=${input.askedBy})`,
    `question_id=${input.questionId}`,
    "",
    input.question,
    "",
    ...(input.audienceHint ? [input.audienceHint, ""] : []),
    `→ 답변: answer_question(question_id="${input.questionId}", answer="...")`,
    "  답은 질문한 에이전트 PTY 로 자동 전달된다(전달 실패 시 명시 보고).",
  ].join("\n");
}

/** 사장님 승격 결과를 해당 질문에 기록한다(전달 실패도 남긴다). */
export function markOwnerEscalation(
  entries: QuestionEntry[],
  questionId: string,
  escalation: OwnerEscalation,
): QuestionEntry[] {
  return entries.map((q) =>
    q.id === questionId ? { ...q, ownerEscalation: escalation } : q,
  );
}

/** 질문자 PTY 로 주입할 답변 본문. 질문 요약을 함께 실어 문맥이 끊기지 않게. */
export function formatAnswerDelivery(input: {
  questionId: string;
  taskId: string;
  question: string;
  answer: string;
  answeredBy: string;
}): string {
  const askedPreview =
    input.question.length > 200
      ? `${input.question.slice(0, 200)}...`
      : input.question;
  return [
    `[답변 도착] question_id=${input.questionId} (task=${input.taskId}, from=${input.answeredBy})`,
    `- 질문: ${askedPreview}`,
    "",
    input.answer,
    "",
    "이 답을 반영해 막혔던 부분을 이어서 진행하세요.",
  ].join("\n");
}

/** 목록 출력 한 줄. 오케가 놓친 질문을 되찾는 복구 경로(get_open_questions)용. */
export function formatQuestionLine(
  entry: QuestionEntry,
  taskTitle?: string,
): string {
  const where = taskTitle ? ` [${taskTitle}]` : "";
  const flag = entry.blocking ? " ★blocking" : "";
  // 판정·승격 상태를 목록에서 바로 보여준다 — "사장님께 올렸는데 답이 없는
  // 질문" 이 open 더미에 섞여 안 보이면 승격 자체가 유실과 다를 바 없다.
  const marks = [
    entry.approvalFor ? `★승인요청 ${entry.approvalFor}` : "",
    entry.audience === "owner" ? "판정=사장님" : "",
    entry.ownerEscalation
      ? `승격 ${entry.ownerEscalation.delivery === "sent" ? "전달됨" : "전달실패"}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  const head = `- ${entry.id}${where}${flag} (${entry.status}, agent=${
    entry.askedBy || "unknown"
  }${marks ? `, ${marks}` : ""})`;
  if (entry.status === "answered") {
    return `${head}\n  Q: ${entry.question}\n  A: ${entry.answer ?? ""}`;
  }
  return `${head}\n  Q: ${entry.question}`;
}

/** post-answer-quiet 축이 보는 최소 사실. agent-stall-policy 의 AnsweredQuestionRef
 * 와 같은 모양이되, 이 모듈은 순수하게 유지하려고 타입을 가져오지 않는다. */
export interface LatestAnswer {
  questionId: string;
  answeredAt: number;
  delivery: "queued" | "failed" | null;
  blocking: boolean;
}

/**
 * 가장 최근에 **답변된** 질문 1건. 없으면 null.
 *
 * ★왜 "가장 최근" 하나만인가: 이 축이 재는 것은 "우리가 마지막으로 밀어넣은
 *   것에 대한 반응" 이다. 오래된 답변까지 각각 재면 같은 침묵이 여러 번 신호로
 *   올라가 오케를 지치게 한다(워치독 repeatMs 규율과 같은 이유).
 * ★answeredAt 이 없거나 숫자가 아닌 항목은 기준점이 될 수 없으므로 건너뛴다 —
 *   "시각을 모르니 방금이다" 로 기울지 않는다.
 */
export function latestAnsweredQuestion(
  entries: QuestionEntry[],
): LatestAnswer | null {
  let best: LatestAnswer | null = null;
  for (const q of entries) {
    if (q.status !== "answered") continue;
    const at = q.answeredAt;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (best !== null && at <= best.answeredAt) continue;
    best = {
      questionId: q.id,
      answeredAt: at,
      delivery: q.answerDelivery ?? null,
      blocking: q.blocking === true,
    };
  }
  return best;
}

/**
 * ★오케가 **자기 손으로** 티켓에 남기는 활동의 요약 접두사들.
 *
 * 왜 이게 필요한가(티켓 igGI6QpXkEfrkkKN3rU0 에서 발견): answer_question 과
 * resolve_model_escalation 은 답을 기록하면서 applyProjection 을 부르고,
 * computeTaskProjection 은 `lastActivityAt: now` 를 **무조건** 찍는다
 * (projection.ts). 즉 **오케가 답을 다는 행위 자체가 보드 활동 시계를 지금으로
 * 되돌린다.**
 *
 * 그대로 두면 두 가지가 깨진다:
 *   1. post-answer-quiet 축이 죽는다 — "답변 이후 보드 활동이 있다" 가 답변
 *      직후 항상 참이 되어 영원히 acted 로 빠진다.
 *   2. board-quiet(20/45분) 의 시계도 답변 시점에서 다시 시작한다 — 에이전트의
 *      침묵이 그만큼 늦게 보인다.
 *
 * 그래서 "마지막 보드 활동이 **에이전트의 흔적인가, 우리 자신의 기록인가**" 를
 * 갈라야 한다. 시간 여유(guard window)로 어림하지 않는 이유는 답 기록이
 * Firestore 왕복 3회를 거쳐 지연이 들쭉날쭉하기 때문이다 — 대신 그 활동이 남긴
 * **요약 접두사**로 정확히 식별한다.
 *
 * ★새 오케측 활동 종류를 추가한다면 여기에도 접두사를 더해야 한다.
 */
export const ORCHESTRATOR_ACTIVITY_PREFIXES = ["[답변]", "[승인결정]"] as const;

/** projection.lastActivitySummary 가 오케 자신의 기록인가. */
export function isOrchestratorActivitySummary(summary: unknown): boolean {
  if (typeof summary !== "string") return false;
  const trimmed = summary.trimStart();
  return ORCHESTRATOR_ACTIVITY_PREFIXES.some((p) => trimmed.startsWith(p));
}
