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

export type QuestionStatus = "open" | "answered";

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
  /** 답변을 질문자 PTY 로 보낸 결과 — queued(전달 큐 등록) / failed(전달 불가). */
  answerDelivery?: "queued" | "failed";
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
}): string {
  const flag = input.blocking ? " ★차단(blocking)" : "";
  return [
    `[Question]${flag} "${input.taskTitle}" (${input.roleLabel}, task=${input.taskId}, agent=${input.askedBy})`,
    `question_id=${input.questionId}`,
    "",
    input.question,
    "",
    `→ 답변: answer_question(question_id="${input.questionId}", answer="...")`,
    "  답은 질문한 에이전트 PTY 로 자동 전달된다(전달 실패 시 명시 보고).",
  ].join("\n");
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
  const head = `- ${entry.id}${where}${flag} (${entry.status}, agent=${
    entry.askedBy || "unknown"
  })`;
  if (entry.status === "answered") {
    return `${head}\n  Q: ${entry.question}\n  A: ${entry.answer ?? ""}`;
  }
  return `${head}\n  Q: ${entry.question}`;
}
