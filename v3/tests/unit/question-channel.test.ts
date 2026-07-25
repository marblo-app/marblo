// P5-1 타입드 질문 채널 — 상관관계(questionId)·무손실(300자 절단 우회)·상태 규칙.
import { describe, expect, it } from "vitest";
import {
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS_PER_TASK,
  answerQuestion,
  appendQuestion,
  clampQuestionText,
  formatAnswerDelivery,
  formatQuestionLine,
  formatQuestionNotification,
  markAnswerDelivery,
  newQuestionId,
  openQuestions,
  parseQuestionId,
  readQuestions,
  type QuestionEntry,
} from "../../electron/mcp-server/question-channel";

function q(over: Partial<QuestionEntry> = {}): QuestionEntry {
  return {
    id: "task1#qabc",
    question: "무엇을 쓸까요",
    status: "open",
    askedBy: "agent-1",
    askedAt: 1,
    blocking: false,
    ...over,
  };
}

describe("questionId — 질문↔답변 상관키", () => {
  it("taskId 를 품어 답변자가 티켓을 되찾을 수 있다", () => {
    const id = newQuestionId("taskABC", "z9");
    expect(id).toBe("taskABC#qz9");
    expect(parseQuestionId(id)).toEqual({ taskId: "taskABC", ok: true });
  });

  it("형식이 아니면 ok:false — 조용히 엉뚱한 티켓을 건드리지 않는다", () => {
    expect(parseQuestionId("no-marker").ok).toBe(false);
    expect(parseQuestionId("#qonly").ok).toBe(false);
  });
});

describe("300자 절단 우회", () => {
  it("★add_activity 프리뷰 한도(300자)를 훌쩍 넘겨도 무손실", () => {
    const long = "가".repeat(5000);
    const clamped = clampQuestionText(long);
    expect(clamped.truncated).toBe(false);
    expect(clamped.value).toBe(long);
    expect(clamped.value.length).toBe(5000);

    // 왕복(질문 → 오케 알림 → 답변 → 질문자 전달) 어디에서도 안 잘린다.
    const notification = formatQuestionNotification({
      questionId: "t#q1",
      taskId: "t",
      taskTitle: "T",
      askedBy: "a1",
      roleLabel: "backend",
      question: clamped.value,
      blocking: false,
    });
    expect(notification).toContain(long);
    expect(notification).toContain("question_id=t#q1");

    const answerBody = "나".repeat(4000);
    const delivery = formatAnswerDelivery({
      questionId: "t#q1",
      taskId: "t",
      question: clamped.value,
      answer: answerBody,
      answeredBy: "orch",
    });
    expect(delivery).toContain(answerBody);
    expect(delivery).toContain("question_id=t#q1");
  });

  it("문서 상한을 넘으면 자르되 잘렸다는 사실을 명시한다(조용한 절단 금지)", () => {
    const huge = "x".repeat(MAX_QUESTION_CHARS + 500);
    const clamped = clampQuestionText(huge);
    expect(clamped.truncated).toBe(true);
    expect(clamped.originalLength).toBe(MAX_QUESTION_CHARS + 500);
    expect(clamped.value).toContain("잘렸습니다");
  });
});

describe("질문 상태(open/answered)", () => {
  it("답변이 상관키로 이어지고 상태가 뒤집힌다", () => {
    const entries = [q({ id: "t#q1" }), q({ id: "t#q2" })];
    const res = answerQuestion(entries, "t#q2", "sonnet 을 쓰세요", "orch", 99);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry).toMatchObject({
      id: "t#q2",
      status: "answered",
      answer: "sonnet 을 쓰세요",
      answeredBy: "orch",
      answeredAt: 99,
    });
    // 다른 질문은 건드리지 않는다.
    expect(res.entries[0].status).toBe("open");
    expect(openQuestions(res.entries).map((e) => e.id)).toEqual(["t#q1"]);
  });

  it("없는 questionId 는 not-found 로 명시 실패", () => {
    const res = answerQuestion([q()], "t#nope", "a", "orch", 1);
    expect(res).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("이미 답한 질문을 덮어쓰지 않는다(답변 이력 보존)", () => {
    const answered = q({
      status: "answered",
      answer: "첫 답",
      answeredBy: "o",
    });
    const res = answerQuestion([answered], answered.id, "둘째 답", "o2", 2);
    expect(res).toMatchObject({ ok: false, reason: "already-answered" });
    if (res.ok) return;
    expect(res.entry?.answer).toBe("첫 답");
  });

  it("전달 결과를 해당 질문에만 기록한다", () => {
    const entries = [q({ id: "t#q1" }), q({ id: "t#q2" })];
    const next = markAnswerDelivery(entries, "t#q2", "failed");
    expect(next[0].answerDelivery).toBeUndefined();
    expect(next[1].answerDelivery).toBe("failed");
  });
});

describe("보관 상한", () => {
  it("★미답(open) 질문은 정리에 밀려 사라지지 않는다", () => {
    // answered 로만 상한을 채운 뒤 새 질문을 넣으면 answered 가 먼저 밀린다.
    const existing = Array.from({ length: MAX_QUESTIONS_PER_TASK }, (_, i) =>
      q({ id: `t#a${i}`, status: "answered", answer: "x" }),
    );
    const next = appendQuestion(existing, q({ id: "t#new" }));
    expect(next).toHaveLength(MAX_QUESTIONS_PER_TASK);
    expect(next.at(-1)?.id).toBe("t#new");
    expect(next.find((e) => e.id === "t#a0")).toBeUndefined();
    expect(openQuestions(next).map((e) => e.id)).toEqual(["t#new"]);
  });

  it("모두 미답이면 가장 오래된 것부터 밀리되 새 질문은 남는다", () => {
    const existing = Array.from({ length: MAX_QUESTIONS_PER_TASK }, (_, i) =>
      q({ id: `t#o${i}` }),
    );
    const next = appendQuestion(existing, q({ id: "t#new" }));
    expect(next).toHaveLength(MAX_QUESTIONS_PER_TASK);
    expect(next.find((e) => e.id === "t#o0")).toBeUndefined();
    expect(next.at(-1)?.id).toBe("t#new");
  });
});

describe("readQuestions — Firestore 임의 값 복원", () => {
  it("배열이 아니거나 형식이 깨진 원소는 조용히 버린다", () => {
    expect(readQuestions(undefined)).toEqual([]);
    expect(readQuestions("nope")).toEqual([]);
    expect(readQuestions([null, 3, { id: 1 }, { question: "no id" }])).toEqual(
      [],
    );
  });

  it("정상 원소는 필드를 보존하고 status 는 안전한 기본값으로 좁힌다", () => {
    const restored = readQuestions([
      {
        id: "t#q1",
        question: "본문",
        status: "weird",
        askedBy: "a1",
        askedAt: 5,
        blocking: true,
        answerDelivery: "queued",
      },
    ]);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: "t#q1",
      status: "open",
      blocking: true,
      answerDelivery: "queued",
    });
  });
});

describe("표시 포맷", () => {
  it("blocking 질문은 오케 알림에 ★차단 표식이 붙는다", () => {
    const out = formatQuestionNotification({
      questionId: "t#q1",
      taskId: "t",
      taskTitle: "제목",
      askedBy: "a1",
      roleLabel: "backend",
      question: "본문",
      blocking: true,
    });
    expect(out.startsWith("[Question] ★차단(blocking)")).toBe(true);
    expect(out).toContain('answer_question(question_id="t#q1"');
  });

  it("목록 줄은 상태와 답을 함께 보여준다", () => {
    const line = formatQuestionLine(
      q({ status: "answered", answer: "그렇게 하세요" }),
      "제목",
    );
    expect(line).toContain("(answered, agent=agent-1)");
    expect(line).toContain("A: 그렇게 하세요");
  });
});
