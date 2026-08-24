/**
 * post-answer-quiet 축 (티켓 igGI6QpXkEfrkkKN3rU0).
 *
 * 고정하는 것:
 *   · 답변 후 흔적(보드 활동·MCP 호출)이 있으면 **절대 신호되지 않는다** — 오탐 금지
 *   · 유예 안이면 '조용함' 이 아니라 '이름' 이다(within-grace)
 *   · 판정 불가(사람 대기 / 죽음 / 관측수단 없음)를 멈춤으로 뚝치지 않는다
 *   · 전달 실패가 원장에 있으면 침묵의 책임을 에이전트에 지우지 않는다
 *   · 임계는 프로브 축(12분)에서 파생된다 — 숫자가 갈라지지 않는다
 *   · 신호 문구가 "queued 는 봤다가 아니다" 를 반드시 말한다
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALL_POLICY,
  STALL_ANSWER_QUIET_MS,
  STALL_PROBE_GRACE_MS,
  evaluateAnswerQuiet,
  resolveStallPolicy,
  type AnsweredQuestionRef,
} from "../../electron/agent-stall-policy";
import {
  isOrchestratorActivitySummary,
  latestAnsweredQuestion,
  readQuestions,
} from "../../electron/mcp-server/question-channel";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const answer = (
  over: Partial<AnsweredQuestionRef> = {},
): AnsweredQuestionRef => ({
  questionId: "T1#q7",
  answeredAt: NOW - 30 * MIN,
  delivery: "queued",
  blocking: false,
  ...over,
});

const base = {
  now: NOW,
  lastBoardActivityMs: null as number | null,
  lastMcpCallMs: null as number | null,
  pty: "silent" as const,
};

describe("evaluateAnswerQuiet — 기준점은 answeredAt 이다", () => {
  it("답변된 질문이 없으면 이 축은 의견을 내지 않는다(null)", () => {
    expect(
      evaluateAnswerQuiet({ ...base, answer: null, lastBoardActivityMs: NOW }),
    ).toBeNull();
  });

  it("answeredAt 이 숫자가 아니면 기준점이 못 되므로 판정하지 않는다", () => {
    expect(
      evaluateAnswerQuiet({
        ...base,
        answer: answer({ answeredAt: Number.NaN }),
      }),
    ).toBeNull();
  });
});

describe("★오탐 금지 — 답변 직후 정상적으로 일하는 에이전트", () => {
  it("답변 이후 보드 활동이 있으면 acted (신호 없음)", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer(),
      lastBoardActivityMs: NOW - 2 * MIN,
    })!;
    expect(v.outcome).toBe("acted");
    expect(v.evidence).toBe("board-activity");
  });

  it("보드는 조용해도 답변 이후 MCP 호출이 있으면 acted", () => {
    // 읽기전용 MCP 호출(check_feedback/get_task)은 보드를 안 올린다 —
    // 그 구간을 침묵으로 오인하지 않는 것이 프로브 축과 공유하는 규율이다.
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer(),
      lastBoardActivityMs: NOW - 40 * MIN,
      lastMcpCallMs: NOW - MIN,
    })!;
    expect(v.outcome).toBe("acted");
    expect(v.evidence).toBe("mcp-call");
  });

  it("PTY 가 busy 여도 답변 이후 흔적이 있으면 acted 다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      pty: "busy",
      answer: answer(),
      lastMcpCallMs: NOW - MIN,
    })!;
    expect(v.outcome).toBe("acted");
  });

  it("★흔적이 답변보다 이르면 acted 가 아니다 — 경계는 엄격히 answeredAt 이후", () => {
    const a = answer({ answeredAt: NOW - 30 * MIN });
    // 답변 1분 전 활동. '최근 활동' 이지만 답변에 대한 반응은 아니다.
    const v = evaluateAnswerQuiet({
      ...base,
      answer: a,
      lastBoardActivityMs: a.answeredAt - MIN,
    })!;
    expect(v.outcome).toBe("quiet");
  });

  it("정확히 answeredAt 과 같은 시각의 활동은 '이후' 가 아니다", () => {
    const a = answer();
    const v = evaluateAnswerQuiet({
      ...base,
      answer: a,
      lastBoardActivityMs: a.answeredAt,
    })!;
    expect(v.outcome).toBe("quiet");
  });
});

describe("★판정 불가를 멈춤으로 뚝치지 않는다(프로브 축과 같은 규율)", () => {
  it("유예 안이면 within-grace — 조용한 게 아니라 이르다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt: NOW - 5 * MIN }),
    })!;
    expect(v.outcome).toBe("indeterminate");
    expect(v.evidence).toBe("within-grace");
  });

  it("임계 직전 1ms 는 아직 within-grace, 정확히 임계면 판정한다", () => {
    const justBefore = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt: NOW - STALL_ANSWER_QUIET_MS + 1 }),
    })!;
    expect(justBefore.evidence).toBe("within-grace");

    const atThreshold = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt: NOW - STALL_ANSWER_QUIET_MS }),
      lastBoardActivityMs: NOW - 60 * MIN,
    })!;
    expect(atThreshold.outcome).toBe("quiet");
  });

  it("사람 확인 대기(awaiting-input)면 에이전트를 탓하지 않는다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      pty: "awaiting-input",
      answer: answer(),
      lastBoardActivityMs: NOW - 60 * MIN,
    })!;
    expect(v.outcome).toBe("indeterminate");
    expect(v.evidence).toBe("awaiting-input");
    // 실측 S5 — 그 상태에 밀어넣은 답은 첫 글자가 선택으로 먹힌다.
    expect(v.reason).toContain("첫 글자");
  });

  it("PTY 가 dead/missing 이면 exit 축의 몫으로 넘긴다", () => {
    for (const pty of ["dead", "missing"] as const) {
      const v = evaluateAnswerQuiet({
        ...base,
        pty,
        answer: answer(),
        lastBoardActivityMs: NOW - 60 * MIN,
      })!;
      expect(v.outcome).toBe("indeterminate");
      expect(v.evidence).toBe("pty-not-applicable");
    }
  });

  it("보드 이력도 MCP 이력도 없으면 잴 기준이 없다 → no-observation", () => {
    const v = evaluateAnswerQuiet({ ...base, answer: answer() })!;
    expect(v.outcome).toBe("indeterminate");
    expect(v.evidence).toBe("no-observation");
  });
});

describe("★신호 — 침묵의 책임을 먼저 에이전트에 지우지 않는다", () => {
  const quietInput = {
    ...base,
    answer: answer(),
    lastBoardActivityMs: NOW - 60 * MIN,
  };

  it("유예를 넘겨 흔적이 0건이면 quiet 신호", () => {
    const v = evaluateAnswerQuiet(quietInput)!;
    expect(v.outcome).toBe("quiet");
    expect(v.evidence).toBe("silent-after-answer");
    expect(v.questionId).toBe("T1#q7");
    expect(v.sinceAnswerMs).toBe(30 * MIN);
  });

  it("★문구가 'queued 는 전달 큐 등록이지 봤다가 아니다' 를 말한다", () => {
    const v = evaluateAnswerQuiet(quietInput)!;
    expect(v.reason).toContain("queued");
    expect(v.reason).toContain("에이전트가 봤다");
  });

  it("★문구가 '에이전트를 먼저 탓하지 마라' 와 실측 근거를 담는다", () => {
    const v = evaluateAnswerQuiet(quietInput)!;
    expect(v.reason).toContain("먼저 몰지 마라");
    expect(v.reason).toContain("answer-delivery-composer");
  });

  it("전달 실패가 원장에 있으면 책임을 전달로 돌린다", () => {
    const v = evaluateAnswerQuiet({
      ...quietInput,
      answer: answer({ delivery: "failed" }),
    })!;
    expect(v.outcome).toBe("quiet");
    expect(v.evidence).toBe("delivery-failed");
    expect(v.reason).toContain("에이전트가 아니라 전달이다");
  });

  it("blocking 질문이면 그 사실이 문구에 실린다", () => {
    const v = evaluateAnswerQuiet({
      ...quietInput,
      answer: answer({ blocking: true }),
    })!;
    expect(v.reason).toContain("blocking");
  });
});

describe("임계 — 숫자가 갈라지지 않는다", () => {
  it("기본값은 프로브 유예(12분)에서 파생된다", () => {
    expect(STALL_ANSWER_QUIET_MS).toBe(STALL_PROBE_GRACE_MS);
    expect(DEFAULT_STALL_POLICY.answerQuietMs).toBe(STALL_PROBE_GRACE_MS);
  });

  it("전용 env 를 안 주면 MARBLO_STALL_PROBE_MS 를 따라간다", () => {
    const p = resolveStallPolicy({ MARBLO_STALL_PROBE_MS: "900000" });
    expect(p.probeGraceMs).toBe(900_000);
    expect(p.answerQuietMs).toBe(900_000);
  });

  it("전용 env 가 있으면 그쪽이 이긴다", () => {
    const p = resolveStallPolicy({
      MARBLO_STALL_PROBE_MS: "900000",
      MARBLO_STALL_ANSWER_QUIET_MS: "60000",
    });
    expect(p.probeGraceMs).toBe(900_000);
    expect(p.answerQuietMs).toBe(60_000);
  });

  it("policy 를 넘기면 그 임계로 잰다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt: NOW - 3 * MIN }),
      lastBoardActivityMs: NOW - 60 * MIN,
      policy: { ...DEFAULT_STALL_POLICY, answerQuietMs: 2 * MIN },
    })!;
    expect(v.outcome).toBe("quiet");
    expect(v.thresholdMs).toBe(2 * MIN);
  });
});

describe("latestAnsweredQuestion — 기준점 선택", () => {
  it("답변된 질문 중 가장 최근 것 하나만 고른다", () => {
    const got = latestAnsweredQuestion(
      readQuestions([
        {
          id: "T1#qa",
          question: "q",
          status: "answered",
          answeredAt: 100,
          answerDelivery: "queued",
        },
        {
          id: "T1#qb",
          question: "q",
          status: "answered",
          answeredAt: 300,
          answerDelivery: "failed",
          blocking: true,
        },
        {
          id: "T1#qc",
          question: "q",
          status: "answered",
          answeredAt: 200,
        },
      ]),
    );
    expect(got).toEqual({
      questionId: "T1#qb",
      answeredAt: 300,
      delivery: "failed",
      blocking: true,
    });
  });

  it("미답(open) 질문은 기준점이 아니다", () => {
    const got = latestAnsweredQuestion(
      readQuestions([
        { id: "T1#qa", question: "q", status: "open", askedAt: 999 },
      ]),
    );
    expect(got).toBeNull();
  });

  it("answeredAt 이 없는 answered 항목은 건너뛴다 — '모르니 방금' 으로 안 기운다", () => {
    const got = latestAnsweredQuestion(
      readQuestions([
        { id: "T1#qa", question: "q", status: "answered" },
        { id: "T1#qb", question: "q", status: "answered", answeredAt: 50 },
      ]),
    );
    expect(got?.questionId).toBe("T1#qb");
  });

  it("질문이 아예 없으면 null", () => {
    expect(latestAnsweredQuestion(readQuestions(undefined))).toBeNull();
  });
});

describe("★오케 자신의 기록은 에이전트의 반응이 아니다", () => {
  // 이 축이 죽은 코드가 되지 않게 막는 테스트다. answer_question 은 답을
  // 기록하며 applyProjection 을 부르고, computeTaskProjection 은
  // lastActivityAt 을 무조건 지금으로 찍는다 — 즉 "답변 이후 보드 활동" 은
  // 답변 직후 **항상** 참이 된다.
  const answeredAt = NOW - 30 * MIN;

  it("답변 기록이 유일한 '이후 활동' 이면 acted 가 아니라 quiet 다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt }),
      // 답 기록이 찍은 활동(답변 시각보다 조금 뒤).
      lastBoardActivityMs: answeredAt + 400,
      lastBoardActivityByOrchestrator: true,
    })!;
    expect(v.outcome).toBe("quiet");
    expect(v.reason).toContain("오케 자신의 답변 기록");
  });

  it("플래그가 없으면(옛 호스트) 종전대로 acted — 회귀 안전 쪽으로 기운다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt }),
      lastBoardActivityMs: answeredAt + 400,
    })!;
    expect(v.outcome).toBe("acted");
  });

  it("오케 기록이어도 에이전트의 MCP 호출이 있으면 acted 다", () => {
    const v = evaluateAnswerQuiet({
      ...base,
      answer: answer({ answeredAt }),
      lastBoardActivityMs: answeredAt + 400,
      lastBoardActivityByOrchestrator: true,
      lastMcpCallMs: NOW - MIN,
    })!;
    expect(v.outcome).toBe("acted");
    expect(v.evidence).toBe("mcp-call");
  });

  it("접두사 판별 — 답변/승인결정만 오케 기록이다", () => {
    expect(isOrchestratorActivitySummary("[답변] 네, 배포하세요")).toBe(true);
    expect(isOrchestratorActivitySummary("[승인결정] opus@high approved")).toBe(
      true,
    );
    expect(isOrchestratorActivitySummary("  [답변] 앞 공백 허용")).toBe(true);
    expect(isOrchestratorActivitySummary("구현 완료: 라우터 정리")).toBe(false);
    expect(isOrchestratorActivitySummary("[질문] 이거 맞나요")).toBe(false);
    expect(isOrchestratorActivitySummary(undefined)).toBe(false);
    expect(isOrchestratorActivitySummary(123)).toBe(false);
  });
});
