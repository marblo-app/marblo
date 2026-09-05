/**
 * 워크체인 조회 출력의 읽는 형태 (티켓 lrtaQ5P8PANBYHHvSFyo).
 *
 * 못 박는 것은 셋이다.
 *   ① 기본 보기는 항목당 한 줄이다 — open=56 이 화면 수백 줄이면 훑을 수가 없다.
 *   ② 접는 것과 지우는 것은 다르다 — 펼치면 사유·출처·근거·노트가 전부 돌아온다.
 *      정보 손실 0 을 여기서 고정한다.
 *   ③ 도구 사용법은 항목마다가 아니라 목록 끝에 한 번이다.
 */
import { describe, expect, it } from "vitest";
import {
  deriveWorkChain,
  displayWidth,
  formatWorkChain,
  truncateToWidth,
  WORK_CHAIN_COMPACT_WHAT_WIDTH,
  type TaskStatusLookup,
  type WorkChainItem,
} from "../../electron/mcp-server/work-chain-core";

const QUOTE =
  "텔레그램 인증을 기기에 묶어야 합니다. A 기기에서 인증한 것이 B 기기로 " +
  "조용히 넘어가지 않게 세션 토큰을 기기 지문과 함께 저장해야 합니다";

/** 오늘 실물 그대로 — 자동 포착 항목의 why 에는 도구 사용법이 박혀 있다. */
const AUTO_WHY =
  `오케가 약속 어미로 말함(야 합니다) — 자동 포착. 원문: "${QUOTE}". ` +
  `틀렸으면 update_work_chain_item(close="dropped", reason=...) 로 닫아라.`;

function autoItem(n: number, over: Partial<WorkChainItem> = {}): WorkChainItem {
  return {
    id: `wc_auto${String(n).padStart(6, "0")}`,
    what: `자동 포착 항목 ${n} — 텔레그램 인증을 기기에 묶는 후속 작업`,
    why: AUTO_WHY,
    afterTaskIds: [],
    afterItemIds: [],
    taskIds: [`t${n}`],
    doneWhen: "done",
    source: "auto",
    sourceTool: "send_telegram_message",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "orchestrator-p1",
    ...over,
  };
}

/** 2026-09-05 실측 재현 — open=56, 근거 티켓이 사라진 항목 3개, 사장님 미션 2개. */
function realWorldChain(): {
  items: WorkChainItem[];
  statuses: TaskStatusLookup;
} {
  const items: WorkChainItem[] = [];
  const statuses: TaskStatusLookup = {};
  for (let n = 1; n <= 56; n++) {
    items.push(autoItem(n));
    statuses[`t${n}`] = "IN_PROGRESS";
  }
  ["wc_g7qfon89a4", "wc_6rcw7nfe0l", "wc_3ksuc59s24"].forEach((id, i) => {
    items[i * 7].id = id;
    statuses[items[i * 7].taskIds[0]] = null;
  });
  items[3].source = "owner";
  items[9].source = "owner";
  for (let i = 20; i < 32; i++) items[i].afterTaskIds = ["tblock"];
  statuses.tblock = "IN_PROGRESS";
  items[5].note = "배포가 급해 보류 — 카나리 끝나면 재개.";
  return { items, statuses };
}

const lineCount = (s: string) => s.split("\n").length;
/** 100칼럼 터미널에서 실제로 먹는 줄 수 — 긴 산문의 대가는 여기서 드러난다. */
const wrappedLines = (s: string, cols = 100) =>
  s
    .split("\n")
    .reduce((a, l) => a + Math.max(1, Math.ceil(displayWidth(l) / cols)), 0);

describe("기본 보기 — 항목당 한 줄", () => {
  it("open=56 이 항목당 한 줄로 접힌다", () => {
    const { items, statuses } = realWorldChain();
    const derived = deriveWorkChain(items, statuses, {});
    const out = formatWorkChain(derived, { taskStatuses: statuses });

    expect(derived.open).toHaveLength(56);
    // 항목 줄 = 56. 나머지는 머리줄·▶다음·섹션 제목·범례뿐이다.
    const itemLines = out
      .split("\n")
      .filter((l) => /\s(READY|WAITING)\s/.test(l));
    expect(itemLines).toHaveLength(56);
    for (const l of itemLines) expect(displayWidth(l)).toBeLessThanOrEqual(100);
  });

  it("현행(full) 대비 줄 수가 확 준다 — 접기가 실제로 일하는지의 수치", () => {
    const { items, statuses } = realWorldChain();
    const derived = deriveWorkChain(items, statuses, {});
    const compact = formatWorkChain(derived, { taskStatuses: statuses });
    const full = formatWorkChain(derived, {
      taskStatuses: statuses,
      detail: "full",
    });

    // ★뮤테이션 감지점: 접기 로직을 지워 compact 가 full 로 돌아가면 여기서 깨진다.
    expect(lineCount(compact)).toBeLessThan(lineCount(full) / 3);
    expect(wrappedLines(compact)).toBeLessThan(wrappedLines(full) / 4);
    expect(lineCount(compact)).toBeLessThan(80);
  });

  it("한 줄에 무엇을·상태·근거 티켓 수·막힌 것·id 가 다 있다", () => {
    const items = [
      autoItem(1, { id: "wc_aaaaaaaaaa", what: "센트리 마감" }),
      autoItem(2, {
        id: "wc_bbbbbbbbbb",
        what: "후속",
        taskIds: [],
        afterTaskIds: ["tlive"],
      }),
    ];
    const statuses: TaskStatusLookup = { t1: "REVIEW", tlive: "TODO" };
    const out = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    const row = (id: string) =>
      out.split("\n").find((l) => /^\s*\d+ /.test(l) && l.includes(id)) ?? "";
    const ready = row("wc_aaaaaaaaaa");
    const waiting = row("wc_bbbbbbbbbb");
    expect(ready).toMatch(/▶ READY\s+센트리 마감\s+ev 0\/1\s+wc_aaaaaaaaaa/);
    expect(waiting).toMatch(/WAITING\s+후속\s+ev –\s+⏸1\s+wc_bbbbbbbbbb/);
  });

  it("긴 what 은 잘리되 펼치면 원문 그대로 돌아온다", () => {
    const long = "가".repeat(120);
    const items = [autoItem(1, { id: "wc_aaaaaaaaaa", what: long })];
    const statuses: TaskStatusLookup = { t1: "TODO" };
    const compact = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    expect(compact).toContain("…");
    expect(compact).not.toContain(long);
    const full = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
      detail: "full",
    });
    expect(full).toContain(long);
  });
});

describe("★정보 손실 0 — 접는 것과 지우는 것은 다르다", () => {
  const everything = (): {
    items: WorkChainItem[];
    statuses: TaskStatusLookup;
  } => ({
    items: [
      autoItem(1, {
        id: "wc_aaaaaaaaaa",
        what: "모든 필드가 찬 항목",
        why: AUTO_WHY,
        taskIds: ["t1", "tgone"],
        afterTaskIds: ["tafter"],
        note: "배포가 급해 보류 — 카나리 끝나면 재개.",
        missionLabel: "Replay Wiring",
      }),
    ],
    statuses: { t1: "REVIEW", tgone: null, tafter: "DONE" },
  });

  it("펼치면 why 원문·인용·노트·출처·근거·경고가 하나도 빠지지 않는다", () => {
    const { items, statuses } = everything();
    const full = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
      taskTitles: { t1: "센트리" },
      detail: "full",
    });
    // why 는 통째로 — 세션이 갈리면 "왜 이게 여기 있는가" 는 이 문장뿐이다.
    expect(full).toContain(AUTO_WHY);
    expect(full).toContain(QUOTE);
    expect(full).toContain("note: 배포가 급해 보류 — 카나리 끝나면 재개.");
    expect(full).toContain("source: auto(send_telegram_message)");
    expect(full).toContain("evidence(doneWhen=done): 센트리 t1=REVIEW");
    expect(full).toContain("tgone=MISSING");
    expect(full).toContain("⚠️ 보드에 없는 티켓: tgone");
    expect(full).toContain("mission: 'Replay Wiring'");
    expect(full).toContain("after: task tafter (모두 충족)");
    expect(full).toContain("모든 필드가 찬 항목");
  });

  it("item_ids 로 고른 항목만 펼쳐도 그 항목 내용은 full 과 같다", () => {
    const { items, statuses } = everything();
    items.push(autoItem(2, { id: "wc_bbbbbbbbbb", what: "옆 항목" }));
    statuses.t2 = "TODO";
    const derived = deriveWorkChain(items, statuses, {});
    const opts = { taskStatuses: statuses, taskTitles: { t1: "센트리" } };
    const one = formatWorkChain(derived, {
      ...opts,
      expandItemIds: ["wc_aaaaaaaaaa"],
    });
    const all = formatWorkChain(derived, { ...opts, detail: "full" });

    // 펼친 항목의 본문은 두 출력에서 글자까지 같다.
    const body = (s: string) =>
      s
        .split("\n")
        .filter((l) => l.startsWith("   ") || l.includes("wc_aaaaaaaaaa"))
        .join("\n");
    expect(body(one)).toContain(AUTO_WHY);
    expect(all).toContain(AUTO_WHY);
    // 안 고른 항목은 여전히 한 줄이다.
    expect(one).not.toContain("옆 항목\n   why:");
    expect(one.split("\n").some((l) => l.includes("wc_bbbbbbbbbb"))).toBe(true);
  });

  it("접힌 기본 보기에도 모든 항목의 id 는 남는다 — 펼칠 손잡이를 잃지 않는다", () => {
    const { items, statuses } = realWorldChain();
    const out = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    for (const it of items) expect(out).toContain(it.id);
  });
});

describe("★도구 사용법은 목록 끝에 한 번", () => {
  it('close="dropped" 안내가 56개 항목에 반복되지 않는다', () => {
    const { items, statuses } = realWorldChain();
    const out = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    // 예전엔 항목마다 두 번씩 = 112번. 이제 범례에 한 번씩만.
    expect(out.split('close="dropped"').length - 1).toBeLessThanOrEqual(3);
    // 범례 두 줄(사장님 미션 / 근거 없음)이 각각 한 번씩 쓴다 — 항목 반복이 아니다.
    expect(out.split("add_task_ids").length - 1).toBe(2);
    expect(out).toContain("── 도구 사용법 (목록 전체에 한 번) ──");
  });

  it("범례는 그 목록에 실제로 있는 것만 싣는다", () => {
    const plain = [
      {
        ...autoItem(1, { id: "wc_aaaaaaaaaa", what: "수기 항목" }),
        source: undefined,
        sourceTool: undefined,
        taskIds: [],
      },
    ];
    const out = formatWorkChain(deriveWorkChain(plain, {}, {}), {});
    expect(out).not.toContain("source=auto");
    expect(out).not.toContain("source=owner");
    expect(out).not.toContain("⚠근거없음 항목은");
  });

  it("펼친 항목 본문에는 사용법이 안 들어간다 — 사실만 남는다", () => {
    const items = [
      autoItem(1, { id: "wc_aaaaaaaaaa", what: "x", taskIds: ["tgone"] }),
    ];
    const statuses: TaskStatusLookup = { tgone: null };
    const full = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
      detail: "full",
    });
    const bodyLines = full.split("\n").filter((l) => l.startsWith("   "));
    // 사실(보드에 없는 티켓)은 항목에, 처방(add_task_ids)은 범례에.
    expect(bodyLines.join("\n")).toContain("⚠️ 보드에 없는 티켓: tgone");
    expect(bodyLines.join("\n")).not.toContain("add_task_ids");
    expect(full).toContain("add_task_ids");
  });
});

describe("눈에 띄어야 할 것을 위로", () => {
  it("근거 티켓이 사라진 항목 3개가 맨 위 묶음으로 올라온다", () => {
    const { items, statuses } = realWorldChain();
    const out = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    const lines = out.split("\n");
    const header = lines.findIndex((l) =>
      l.includes("근거 티켓이 보드에 없는 항목 3개"),
    );
    expect(header).toBeGreaterThan(-1);
    // 바로 다음 세 줄이 그 셋이다 — 흩어 두면 아무도 처리하지 않는다.
    expect(lines.slice(header + 1, header + 4).join("\n")).toContain(
      "wc_g7qfon89a4",
    );
    expect(lines.slice(header + 1, header + 4).join("\n")).toContain(
      "wc_6rcw7nfe0l",
    );
    expect(lines.slice(header + 1, header + 4).join("\n")).toContain(
      "wc_3ksuc59s24",
    );
    // 사장님 미션 묶음은 그 아래, 나머지는 더 아래.
    const owner = lines.findIndex((l) => l.includes("★ 사장님 미션"));
    const rest = lines.findIndex((l) => /^항목 \d+개$/.test(l));
    expect(header).toBeLessThan(owner);
    expect(owner).toBeLessThan(rest);
  });

  it("▶ 표시는 다음에 할 항목 한 줄에만 붙는다", () => {
    const { items, statuses } = realWorldChain();
    const derived = deriveWorkChain(items, statuses, {});
    const out = formatWorkChain(derived, { taskStatuses: statuses });
    const marked = out.split("\n").filter((l) => /^\s*\d+ ▶ /.test(l));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(derived.next?.item.id ?? "?");
  });

  it("표시 번호는 묶어 보여줘도 배열 위치 그대로다", () => {
    const { items, statuses } = realWorldChain();
    const out = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    // items[3] 은 사장님 미션이라 아래 묶음으로 내려가지만 번호는 4 그대로.
    const line = out.split("\n").find((l) => l.includes(items[3].id));
    expect(line?.trimStart().startsWith("4 ")).toBe(true);
  });
});

describe("표시폭 — 한글이 섞여도 열이 맞는다", () => {
  it("★열이 실제로 맞는다 — id 칸이 모든 줄에서 같은 자리에서 시작한다", () => {
    const { items, statuses } = realWorldChain();
    const out = formatWorkChain(deriveWorkChain(items, statuses, {}), {
      taskStatuses: statuses,
    });
    const starts = new Set(
      out
        .split("\n")
        .filter((l) => /^\s*\d+ /.test(l))
        .map((l) => displayWidth(l.slice(0, l.lastIndexOf("wc_")))),
    );
    expect(starts.size).toBe(1);
  });

  it("한글은 두 칸, ASCII 는 한 칸", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("가나다")).toBe(6);
    expect(displayWidth("가a")).toBe(3);
  });
  it("자를 때도 표시폭 기준이고 … 를 붙인다", () => {
    expect(truncateToWidth("가나다라", 4)).toBe("가…");
    expect(truncateToWidth("짧다", 10)).toBe("짧다");
    expect(
      displayWidth(truncateToWidth("가".repeat(80), 44)),
    ).toBeLessThanOrEqual(WORK_CHAIN_COMPACT_WHAT_WIDTH);
  });
});
