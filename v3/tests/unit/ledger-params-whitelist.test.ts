/**
 * 원장 `params` 화이트리스트 (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★이 파일이 지키는 계약: `types/audit.ts` 가 주석으로만 적어두고 구현이 지키지
 * 않던 문장 — "툴 인자 원문은 원장에 남지 않는다" — 을 실행 가능한 형태로 옮긴다.
 * 주석은 갈라져도 조용하지만 이 테스트는 빨개진다.
 */
import { describe, expect, it } from "vitest";
import {
  LEDGER_PARAMS_POLICY,
  LEDGER_PARAM_TEXT_MAX_CHARS,
  PARAMS_HASH_PREFIX,
  buildLedgerEvent,
  projectParamsForLedger,
} from "../../electron/mcp-server/ledger";

const base = {
  projectId: "GFB8JnJrrX6AgahqmGB3",
  agentId: "agent-1",
  toolName: "add_activity",
  result: "ok",
  duration: 3,
  success: true,
};

describe("projectParamsForLedger — 화이트리스트 (블랙리스트 아님)", () => {
  it("화이트리스트에 없는 키는 값을 통째로 버리고 키 이름만 남긴다", () => {
    const out = projectParamsForLedger({
      task_id: "IEQFEEoWdhuRXZBRAYnF",
      brand_new_tool_arg: "여기에 사장님 지시문이 통째로 들어올 수 있다",
    });

    expect(out.params).toEqual({ task_id: "IEQFEEoWdhuRXZBRAYnF" });
    expect(out.params).not.toHaveProperty("brand_new_tool_arg");
    expect(out.omitted).toEqual(["brand_new_tool_arg"]);
  });

  it("모르는 키만 들어오면 params 는 빈 객체가 된다 — 새 툴이 새 키를 들고 와도 안 샌다", () => {
    const out = projectParamsForLedger({
      unknown_a: "secret prose",
      unknown_b: { nested: "more prose" },
    });

    expect(out.params).toEqual({});
    expect(out.omitted).toEqual(["unknown_a", "unknown_b"]);
  });

  it("식별자/열거값 키는 그대로 남는다 — ActivityStreamPanel·상태전이 회귀 방지", () => {
    const out = projectParamsForLedger({
      task_id: "IEQFEEoWdhuRXZBRAYnF",
      role: "backend",
      status: "IN_PROGRESS",
      from: "CLAIMED",
      to: "IN_PROGRESS",
      blocking: false,
      limit: 50,
    });

    expect(out.params).toEqual({
      task_id: "IEQFEEoWdhuRXZBRAYnF",
      role: "backend",
      status: "IN_PROGRESS",
      from: "CLAIMED",
      to: "IN_PROGRESS",
      blocking: false,
      limit: 50,
    });
    expect(out.omitted).toEqual([]);
  });

  it("식별자 키라도 값이 PII 면 버린다 — mail_send 의 to 가 수신자 메일이다", () => {
    const out = projectParamsForLedger({ to: "owner@example.com" });

    expect(out.params).toEqual({});
    expect(out.omitted).toEqual(["to"]);
  });

  it("식별자 키의 값이 식별자 길이를 넘으면 버린다 — 자유 텍스트가 id 칸으로 들어오는 경로", () => {
    const out = projectParamsForLedger({ status: "S".repeat(400) });

    expect(out.params).toEqual({});
    expect(out.omitted).toEqual(["status"]);
  });

  it("자유 텍스트 키는 원문이 아니라 레드액트본으로 남는다", () => {
    const raw =
      "티켓 본문: OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz 로 owner@example.com 에 배포";

    const out = projectParamsForLedger({ message: raw });

    expect(out.params.message).not.toBe(raw);
    expect(String(out.params.message)).toContain("<REDACTED>");
    expect(String(out.params.message)).toContain("<EMAIL>");
    expect(String(out.params.message)).not.toContain(
      "sk-proj-abcdefghijklmnopqrstuvwxyz",
    );
    expect(String(out.params.message)).not.toContain("owner@example.com");
  });

  it("자유 텍스트는 길이를 자른다 — 티켓 본문 전문이 원장에 눕지 않는다", () => {
    const raw = "가".repeat(LEDGER_PARAM_TEXT_MAX_CHARS + 500);

    const out = projectParamsForLedger({ message: raw });

    expect(String(out.params.message).length).toBeLessThanOrEqual(
      LEDGER_PARAM_TEXT_MAX_CHARS,
    );
    expect(String(out.params.message)).not.toBe(raw);
  });

  it("마스킹이 미덥지 않으면 그 키를 통째로 버린다 — 반쯤 가린 값을 남기지 않는다", () => {
    const out = projectParamsForLedger({
      message: "Authorization: Bearer oauth_access_token_1234567890 로 호출",
    });

    expect(out.params).toEqual({});
    expect(out.omitted).toEqual(["message"]);
  });

  it("지시문은 params 로 두 번 담지 않는다 — instructionHash/instructionRedacted 가 유일한 자리다", () => {
    const out = projectParamsForLedger({
      instruction: "에이전트 지시문 원문",
      initial_prompt: "스폰 프롬프트 원문",
      prompt: "프롬프트 원문",
    });

    expect(out.params).toEqual({});
    expect(out.omitted).toEqual(["instruction", "initial_prompt", "prompt"]);
  });

  it("중첩 객체도 같은 화이트리스트로 걸린다 — submit_for_review 의 summary", () => {
    const out = projectParamsForLedger({
      summary: {
        problem: "원문 노출",
        changes: "화이트리스트 도입",
        secret_backdoor: "여기로 새면 안 된다",
      },
      pr: "https://github.com/acme/repo/pull/1",
    });

    expect(out.params.summary).toEqual({
      problem: "원문 노출",
      changes: "화이트리스트 도입",
    });
    expect(out.params.pr).toBe("https://github.com/acme/repo/pull/1");
  });

  it("배열은 길이를 보존한다 — create_tasks_bulk 의 tasks.length 요약이 살아 있어야 한다", () => {
    const out = projectParamsForLedger({
      tasks: [
        { title: "첫 티켓", role: "backend", secret_field: "누설" },
        { title: "둘째 티켓", role: "frontend" },
      ],
    });

    expect(Array.isArray(out.params.tasks)).toBe(true);
    expect((out.params.tasks as unknown[]).length).toBe(2);
    expect((out.params.tasks as Record<string, unknown>[])[0]).toEqual({
      title: "첫 티켓",
      role: "backend",
    });
  });

  it("원문 해시는 남긴다 — 원문은 못 보여도 '무엇이 넘어갔는지' 는 대조할 수 있다", () => {
    const a = projectParamsForLedger({ message: "원문 A" });
    const b = projectParamsForLedger({ message: "원문 B" });

    expect(a.hash).toMatch(new RegExp(`^${PARAMS_HASH_PREFIX}[0-9a-f]{64}$`));
    expect(a.hash).not.toBe(b.hash);
  });

  it("키 순서가 달라도 같은 해시다 — 정규화된 입력을 해싱한다", () => {
    const a = projectParamsForLedger({ task_id: "t1", role: "backend" });
    const b = projectParamsForLedger({ role: "backend", task_id: "t1" });

    expect(a.hash).toBe(b.hash);
  });

  it("빈 params 는 해시가 없다 — 없는 사실을 지어내지 않는다", () => {
    expect(projectParamsForLedger({}).hash).toBeNull();
  });
});

describe("buildLedgerEvent — 원장에 실제로 실리는 것", () => {
  it("툴 인자 원문이 원장 이벤트에 실리지 않는다", () => {
    const raw = "사장님 지시문 원문과 /Users/dongwonkim 경로";

    const event = buildLedgerEvent({
      ...base,
      params: { message: raw, internal_note: raw },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("/Users/dongwonkim");
    expect(event.params).not.toHaveProperty("internal_note");
    expect(event.paramsOmitted).toContain("internal_note");
  });

  it("정책 표식을 박는다 — 뷰가 '이 문서는 걸러졌다' 를 판별할 유일한 근거다", () => {
    const event = buildLedgerEvent({ ...base, params: { task_id: "t1" } });

    expect(event.paramsPolicy).toBe(LEDGER_PARAMS_POLICY);
  });

  it("params 를 걸러도 taskId 귀속은 원본에서 살아 있다", () => {
    const event = buildLedgerEvent({
      ...base,
      params: { task_id: "IEQFEEoWdhuRXZBRAYnF", junk: "x" },
    });

    expect(event.taskId).toBe("IEQFEEoWdhuRXZBRAYnF");
  });
});
