/**
 * 실행 원장 섹션의 **표시 규율**을 못박는다.
 *
 * 이 파일이 지키는 것은 두 줄로 요약된다. 둘 다 어기면 발표에서 틀린 숫자가
 * 나가고, 둘 다 주석으로만 적혀 있으면 다음 사람이 조용히 되돌린다(이 리포에서
 * 이미 여러 번 있었던 실패 모드다):
 *
 *   1. **미측정을 0 으로 그리지 않는다.** 비용 롤업이 없는 티켓 칸에는 금액이
 *      한 글자도 나오면 안 된다 — `$0.00` 도, 흐린 `0` 도, `—` 도 안 된다.
 *      실측 0 인 티켓만 `$0.00` 을 그린다.
 *   2. **하네스를 실제 모델로 그리지 않는다.** `claude`/`codex` 는 실행기 축이다.
 *      실제 모델이 없으면 그 칸은 "미측정" 이고, 하네스는 '하네스' 라고 이름표가
 *      붙은 칩에만 나온다.
 *
 * ★목 데이터다. 진짜 uid·프로젝트 id·지시문은 한 글자도 없다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ExecutionLedgerSection, {
  coverageSentence,
  formatCost,
  UNMEASURED_LABEL,
  type ExecutionLedgerRow,
  type ExecutionLedgerCoverage,
} from "./ExecutionLedgerSection";

// ── 자(尺) ──────────────────────────────────────────────────────────────────

/** 태그·속성(title 툴팁)을 걷고 **보이는 글자만** 남긴다. 툴팁으로 설명하는
 *  것과 칸에 숫자를 그리는 것은 정반대라, 속성까지 재면 정직한 설명이 결함으로
 *  잡힌다. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** 화면에 찍힌 금액 전부. */
const MONEY = /\$\s*[\d,]/;
/** 한 엘리먼트의 전체 텍스트가 0 인 자리 — 흐리게 칠해도 0 으로 읽힌다. */
const BARE_ZERO = />\s*[-−]?0(?:\.0+)?\s*</;

// ── 목 행 ───────────────────────────────────────────────────────────────────

function row(over: Partial<ExecutionLedgerRow> = {}): ExecutionLedgerRow {
  return {
    taskId: "task-1",
    missionId: "mission-1",
    missionGoal: "테스트 미션 목표",
    ticketTitle: "테스트 티켓",
    role: "backend",
    claimedBy: "agent-1",
    agentId: "agent-1",
    agentName: "backend-1",
    agentResolved: true,
    model: {
      actual: "claude-opus-5",
      actualSource: "spawnedModel",
      harness: "claude",
    },
    cost: {
      total: 2.25,
      inputTokens: 1000,
      outputTokens: 200,
      retries: 0,
    },
    result: {
      status: "DONE",
      completedAt: "2026-09-05T00:00:00.000Z",
      prUrl: "https://github.com/example/repo/pull/1",
      merged: true,
      actions: 4,
      failedActions: 0,
    },
    at: "2026-09-05T00:00:00.000Z",
    ...over,
  };
}

function coverage(
  over: Partial<ExecutionLedgerCoverage> = {}
): ExecutionLedgerCoverage {
  return {
    rows: 1,
    ticketsWithoutExecution: 0,
    modelMeasured: 1,
    costMeasured: 1,
    agentResolved: 1,
    costMeasuredTotal: 2.25,
    ...over,
  };
}

function render(
  rows: ExecutionLedgerRow[],
  cov: ExecutionLedgerCoverage
): string {
  return renderToStaticMarkup(
    <ExecutionLedgerSection rows={rows} coverage={cov} />
  );
}

/** 표의 한 행(<tr>)만 떼어낸다 — 헤더·합계 문구의 숫자가 섞여 들어오지 않게. */
function bodyRow(html: string): string {
  const body = html.split("<tbody>")[1] ?? "";
  return body.split("</tbody>")[0] ?? "";
}

/**
 * ★한 **칸**만 떼어낸다.
 *
 * 행 전체 텍스트로 재면 옆 칸(토큰 수·원장 호출 수)의 숫자가 섞여서, 비용 칸이
 * $0.00 으로 바뀌어도 행 전체는 여전히 달라 보인다 — 가드가 꺼져도 테스트가
 * 초록으로 남는 구멍이다. 그래서 칸 단위로 잰다.
 */
function cell(html: string, axis: "cost" | "model"): string {
  const marker = `<td data-axis="${axis}"`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${axis} 칸을 찾지 못했다`);
  const end = html.indexOf("</td>", start);
  return html.slice(start, end);
}

// ── 1. 한 줄로 이어지는가 ───────────────────────────────────────────────────

test("실행 원장: 미션·티켓·에이전트·모델·비용·결과가 한 행에 함께 나온다", () => {
  const html = render([row()], coverage());
  const tr = textOf(bodyRow(html));
  for (const piece of [
    "테스트 미션 목표",
    "테스트 티켓",
    "backend-1",
    "claude-opus-5",
    "$2.25",
    "DONE",
  ]) {
    assert.ok(tr.includes(piece), `한 행에 "${piece}" 가 없다: ${tr}`);
  }
});

test("실행 원장: 표 헤더가 여섯 축을 그대로 세운다", () => {
  const html = render([row()], coverage());
  const head = textOf(html.split("<thead>")[1]?.split("</thead>")[0] ?? "");
  assert.deepEqual(
    ["미션", "티켓", "에이전트", "모델", "비용", "결과"].filter(
      (h) => !head.includes(h)
    ),
    []
  );
});

// ── 2. ★미측정 ≠ 0 ─────────────────────────────────────────────────────────

test("★비용 롤업이 없는 티켓 칸에는 금액이 한 글자도 안 나온다", () => {
  const html = render(
    [
      row({
        taskId: "no-cost",
        cost: {
          total: null,
          inputTokens: null,
          outputTokens: null,
          retries: null,
        },
      }),
    ],
    coverage({ costMeasured: 0, costMeasuredTotal: 0 })
  );
  const costCell = cell(html, "cost");
  assert.ok(
    textOf(costCell).includes(UNMEASURED_LABEL),
    "미측정이라는 글자가 있어야 한다"
  );
  assert.doesNotMatch(costCell, MONEY, "미측정 칸에 금액을 그리면 안 된다");
  assert.doesNotMatch(costCell, BARE_ZERO, "흐린 0 도 0 으로 읽힌다");
  // 토큰 수도 0 으로 지어내지 않는다.
  assert.equal(
    textOf(costCell).includes("0 in"),
    false,
    "미측정 토큰을 0 으로 그리면 안 된다"
  );
  assert.doesNotMatch(bodyRow(html), MONEY, "행 어디에도 금액이 없어야 한다");
});

test("★실측 0 인 티켓은 $0.00 을 그린다 — null 로 접지 않는다", () => {
  const html = render(
    [
      row({
        taskId: "zero-cost",
        cost: { total: 0, inputTokens: 0, outputTokens: 0, retries: 0 },
      }),
    ],
    coverage({ costMeasuredTotal: 0 })
  );
  const tr = textOf(bodyRow(html));
  assert.ok(tr.includes("$0.00"), "실측 0 은 0 으로 그린다");
  assert.equal(
    tr.includes(UNMEASURED_LABEL),
    false,
    "실측 0 을 미측정으로 접으면 안 된다"
  );
});

test("★미측정 행과 실측 0 행은 서로 다르게 그려진다", () => {
  const unmeasured = bodyRow(
    render(
      [
        row({
          cost: {
            total: null,
            inputTokens: null,
            outputTokens: null,
            retries: null,
          },
        }),
      ],
      coverage({ costMeasured: 0, costMeasuredTotal: 0 })
    )
  );
  const zero = bodyRow(
    render(
      [row({ cost: { total: 0, inputTokens: 0, outputTokens: 0, retries: 0 } })],
      coverage({ costMeasuredTotal: 0 })
    )
  );
  assert.notEqual(
    textOf(cell(unmeasured, "cost")),
    textOf(cell(zero, "cost")),
    "둘이 같게 그려지면 화면이 거짓말을 한다"
  );
  // ★그리고 방향까지 못박는다 — 미측정 칸에는 금액이 없고, 실측 0 칸에는 있다.
  assert.doesNotMatch(cell(unmeasured, "cost"), MONEY);
  assert.match(cell(zero, "cost"), MONEY);
});

test("formatCost: 1센트 미만을 $0.00 으로 반올림해 0 원으로 위장하지 않는다", () => {
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.004), "<$0.01");
  assert.equal(formatCost(2.25), "$2.25");
});

// ── 3. ★하네스 축 ≠ 실제 모델 ──────────────────────────────────────────────

test("★실제 모델이 없으면 모델 칸은 미측정이고 하네스는 이름표가 붙는다", () => {
  const html = render(
    [
      row({
        model: { actual: null, actualSource: null, harness: "codex" },
      }),
    ],
    coverage({ modelMeasured: 0 })
  );
  const tr = textOf(bodyRow(html));
  assert.ok(tr.includes(UNMEASURED_LABEL), "실제 모델은 미측정으로 그린다");
  assert.ok(
    tr.includes("하네스 codex"),
    "하네스 값은 '하네스' 라는 이름표와 함께만 나온다"
  );
});

test("★하네스가 실제 모델 칸으로 승격되지 않는다 (actual=null 이면 어디에도 단독 표기 없음)", () => {
  const html = render(
    [row({ model: { actual: null, actualSource: null, harness: "claude" } })],
    coverage({ modelMeasured: 0 })
  );
  const modelCell = textOf(cell(html, "model"));
  // "claude" 는 오직 "하네스 claude" 라는 형태로만 등장해야 한다.
  const occurrences = modelCell.split("claude").length - 1;
  const labeled = modelCell.split("하네스 claude").length - 1;
  assert.equal(
    occurrences,
    labeled,
    `claude 가 이름표 없이 ${occurrences - labeled}회 등장했다`
  );
  assert.ok(
    modelCell.startsWith(UNMEASURED_LABEL) ||
      modelCell.indexOf(UNMEASURED_LABEL) < modelCell.indexOf("하네스"),
    "모델 칸의 첫 값은 '미측정' 이어야 한다 — 하네스가 먼저 오면 그게 모델로 읽힌다"
  );
});

// ── 4. ★분모를 밝힌다 ──────────────────────────────────────────────────────

test("★합계는 실측 행만 더하고 분모를 화면에 적는다", () => {
  const html = render(
    [
      row({
        taskId: "a",
        cost: { total: 2.25, inputTokens: 1, outputTokens: 1, retries: 0 },
      }),
      row({
        taskId: "b",
        cost: { total: null, inputTokens: null, outputTokens: null, retries: null },
      }),
    ],
    coverage({
      rows: 2,
      modelMeasured: 1,
      costMeasured: 1,
      costMeasuredTotal: 2.25,
    })
  );
  const text = textOf(html);
  assert.ok(text.includes("비용이 실측된 1건"), "분모를 명시해야 한다");
  assert.ok(
    text.includes("1건은 0 원이") && text.includes("미측정"),
    "나머지가 0 이 아니라는 것을 글로 밝혀야 한다"
  );
});

test("coverageSentence: 항상 분모(N건 중)를 낸다", () => {
  assert.equal(
    coverageSentence(coverage({ rows: 9, modelMeasured: 4, costMeasured: 7 })),
    "실행 9건 · 실제 모델 실측 4/9 · 티켓 비용 실측 7/9"
  );
  assert.equal(
    coverageSentence(coverage({ rows: 0 })),
    "실행 기록이 아직 없습니다."
  );
});

test("실행 흔적 없는 티켓 수를 조용히 감추지 않는다", () => {
  const html = render([row()], coverage({ ticketsWithoutExecution: 3 }));
  assert.ok(textOf(html).includes("3건 있습니다"));
});

// ── 5. 빈 상태 ──────────────────────────────────────────────────────────────

test("빈 상태: 표를 세우지 않고 이유를 말한다(0 원 합계를 그리지 않는다)", () => {
  const html = render(
    [],
    coverage({
      rows: 0,
      modelMeasured: 0,
      costMeasured: 0,
      costMeasuredTotal: 0,
    })
  );
  assert.equal(html.includes("<table"), false, "빈 표를 세우면 채워질 칸으로 읽힌다");
  assert.doesNotMatch(html, MONEY, "빈 상태에 합계 금액을 그리면 안 된다");
  assert.ok(textOf(html).includes("아직 실행 기록이 없습니다"));
});

// ── 6. ★민감 필드 — 이 표는 자유 텍스트를 새로 늘리지 않는다 ───────────────

test("★에이전트 문서가 사라진 행은 '문서 없음' 으로 밝히고 모델을 지어내지 않는다", () => {
  const html = render(
    [
      row({
        agentResolved: false,
        agentId: null,
        agentName: null,
        claimedBy: "gone-agent",
        model: { actual: null, actualSource: null, harness: "grok" },
      }),
    ],
    coverage({ modelMeasured: 0, agentResolved: 0 })
  );
  const tr = textOf(bodyRow(html));
  assert.ok(tr.includes("gone-agent"), "물린 문자열 자체는 지우지 않는다");
  assert.ok(tr.includes("문서 없음"));
  assert.ok(tr.includes(UNMEASURED_LABEL));
});

// ── 7. ★기준(basis) — 이 표의 숫자가 무엇을 잰 것인지 화면이 말한다 ────────
//
// 왜 테스트로 두나: 이 문구가 없으면 비용이 **계정·조직 지출**로, 에이전트 열이
// **사람 축**으로 읽힌다. 지금 실행이 사실상 한 계정에서 나오므로 사람 축을
// 그렸다면 막대가 하나로 뭉쳤을 것이고, 그걸 "우리 조직 지출" 로 소개하면
// 발표에서 틀린 숫자가 나간다. 이 화면은 사람 축을 아예 그리지 않으며, 그
// 사실을 화면이 직접 말해야 한다.

/** JSX 줄바꿈이 만든 공백을 접는다 — 문구 검사는 줄바꿈 위치에 걸리면 안 된다. */
function flat(html: string): string {
  return textOf(html).replace(/\s+/g, " ");
}

test("★기준 문구: 비용이 티켓 단위 적립값이고 계정 합계가 아님을 밝힌다", () => {
  const text = flat(render([row()], coverage()));
  assert.ok(text.includes("티켓 단위로 적립"), "무엇을 잰 값인지 말해야 한다");
  assert.ok(
    text.includes("계정·조직 지출 합계가 아니고"),
    "무엇이 아닌지도 말해야 한다 — 이게 오독을 막는 절반이다"
  );
  assert.ok(
    text.includes("전역 집계를 다시 더한 값도 아닙니다"),
    "cost_logs 전역 SUM 이 아니라는 것까지 밝혀야 한다"
  );
});

test("★기준 문구: 행위자 열이 사람 축이 아님을 밝힌다", () => {
  const text = flat(render([row()], coverage()));
  assert.ok(text.includes("에이전트(실행 단위)"));
  assert.ok(
    text.includes("사람 축을 그리지 않습니다"),
    "사람 축이 없다는 사실을 숨기면 에이전트 열이 사람으로 읽힌다"
  );
});
