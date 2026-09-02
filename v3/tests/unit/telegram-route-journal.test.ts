/**
 * 티켓 c1R9C8v5MrBycZYSdTeB — 인바운드 경로 시계열.
 *
 * 검증하는 것: 조용한 구간에도 표본이 남고, 그 표본 하나로 "루프가 멈춘 것"과
 * "루프는 도는데 주입이 거부되는 것"을 가를 수 있다. 그리고 이 관측은
 * 무한히 자라지 않고, 실패해도 앱을 흔들지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  TelegramRouteJournal,
  classifyRoute,
  type RouteSample,
} from "../../electron/telegram-route-journal";
import type { TelegramRouteHealth } from "../../electron/telegram-poller";

const PROJECT = "proj1";
const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };

function health(over: Partial<TelegramRouteHealth> = {}): TelegramRouteHealth {
  return {
    projectId: PROJECT,
    loopRunning: true,
    lastChatIdKnown: true,
    pendingReply: false,
    lastInboundAt: null,
    lastDeliveredUpdateId: null,
    lastDeliveredTarget: null,
    reliability: { unanswered: 0, sendFailures: 0 },
    lastPollStartedAt: 1_000,
    lastPollCompletedAt: 1_000,
    consecutivePollErrors: 0,
    lastPollErrorAt: null,
    hold: null,
    ...over,
  };
}

let tmpDir: string;
function journalFile(): string {
  return path.join(tmpDir, "route.jsonl");
}
function readLines(): RouteSample[] {
  return fs
    .readFileSync(journalFile(), "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RouteSample);
}

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-journal-")),
  );
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("classifyRoute — 같은 침묵을 원인별로 가른다", () => {
  const now = 2_000;

  it("보류가 없고 루프가 최근에 돌았으면 idle-ok", () => {
    expect(classifyRoute(health(), now)).toBe("idle-ok");
  });

  it("루프 핸들이 없으면 loop-stopped", () => {
    expect(classifyRoute(health({ loopRunning: false }), now)).toBe(
      "loop-stopped",
    );
  });

  it("★loopRunning 이 true 라도 마지막 왕복이 예산을 넘겼으면 loop-stalled", () => {
    // 물린 fetch 안에서는 핸들이 등록된 채로 루프가 돌지 않는다 — 그래서
    // loopRunning 만 보면 이 상태를 정상으로 오독한다.
    expect(
      classifyRoute(health({ lastPollCompletedAt: 1_000 }), 1_000 + 200_000),
    ).toBe("loop-stalled");
  });

  it("아직 한 바퀴도 못 돈 갓 시작한 루프를 멈췄다고 부르지 않는다", () => {
    expect(
      classifyRoute(
        health({ lastPollStartedAt: null, lastPollCompletedAt: null }),
        now,
      ),
    ).toBe("idle-ok");
  });

  it("보류가 있으면 그게 답이다 — 루프 판정보다 앞선다", () => {
    const stalledButHeld = health({
      lastPollCompletedAt: 1_000,
      hold: {
        reason: "inject-refused",
        updateId: 7,
        since: 0,
        heldMs: 500_000,
        attempts: 40,
        detail: {
          refusal: "pty-refused",
          composer: "occupied",
          detail: "컴포저에 미제출 텍스트",
        },
      },
    });
    // 보류가 걸렸다는 것 자체가 "루프는 메시지를 봤다"는 뜻이다.
    expect(classifyRoute(stalledButHeld, 1_000 + 500_000)).toBe(
      "held-inject-refused",
    );
  });

  it("오케 부재와 주입 거부는 다른 결론이다", () => {
    const base = {
      updateId: 1,
      since: 0,
      heldMs: 10,
      attempts: 1,
      detail: null,
    };
    expect(
      classifyRoute(
        health({ hold: { ...base, reason: "no-orchestrator" } }),
        now,
      ),
    ).toBe("held-no-orchestrator");
    expect(
      classifyRoute(health({ hold: { ...base, reason: "inject-threw" } }), now),
    ).toBe("held-inject-threw");
  });
});

describe("TelegramRouteJournal — 조용한 구간에도 기록이 남는다", () => {
  it("표본을 파일에 적고, 보류 사유와 자리비움(idle)을 같은 줄에 남긴다", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () =>
        health({
          hold: {
            reason: "inject-refused",
            updateId: 42,
            since: 0,
            heldMs: 90_000,
            attempts: 30,
            detail: {
              refusal: "pty-refused",
              composer: "occupied",
              detail: "컴포저에 미제출 텍스트가 있다",
            },
          },
        }),
      getSystemIdleSeconds: () => 3600,
      filePath: journalFile(),
      logger: quietLogger,
    });

    const samples = journal.sample("test");
    expect(samples).toHaveLength(1);

    const [line] = readLines();
    expect(line.projectId).toBe(PROJECT);
    expect(line.verdict).toBe("held-inject-refused");
    expect(line.hold?.composer).toBe("occupied");
    expect(line.hold?.attempts).toBe(30);
    // ★자리비움과의 상관관계는 이 필드로만 사후에 볼 수 있다.
    expect(line.idleSec).toBe(3600);
    // 메모리 사본도 같은 것을 말한다.
    expect(journal.recentSamples()).toHaveLength(1);
  });

  it("본문·chatId 같은 내용물은 표본에 담기지 않는다", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () => health({ lastDeliveredUpdateId: 9 }),
      filePath: journalFile(),
      logger: quietLogger,
    });
    journal.sample("test");
    const raw = fs.readFileSync(journalFile(), "utf8");
    // 표본의 키 집합은 고정이다 — 새 필드가 본문을 실어 나르면 여기서 걸린다.
    const keys = Object.keys(JSON.parse(raw.trim())).sort();
    expect(keys).toEqual(
      [
        "at",
        "consecutivePollErrors",
        "driftMs",
        "hold",
        "idleSec",
        "lastDeliveredUpdateId",
        "lastInboundAgoMs",
        "loopRunning",
        "pendingReply",
        "pollCompletedAgoMs",
        "pollStartedAgoMs",
        "projectId",
        "reason",
        "submit",
        "verdict",
      ].sort(),
    );
  });

  it("★미확인 제출 시각이 같은 줄에 남는다 — 우리가 우리 컴포저를 막았는지의 고리", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () =>
        health({
          hold: {
            reason: "inject-refused",
            updateId: 5,
            since: 0,
            heldMs: 1_000,
            attempts: 3,
            detail: {
              refusal: "pty-refused",
              composer: "occupied",
              detail: "컴포저에 미제출 텍스트가 있다",
            },
          },
        }),
      getSubmitTally: () => ({
        confirmed: 4,
        unconfirmed: 1,
        indeterminate: 0,
        refused: 3,
        lastUnconfirmedAt: Date.now() - 30_000,
        lastRefusalAt: Date.now(),
        lastRefusal: "composer-occupied",
      }),
      filePath: journalFile(),
      logger: quietLogger,
    });
    const [line] = journal.sample("test");
    // 미확인 제출 직후부터 컴포저가 막힌 채 보류가 쌓인다 — 한 줄로 읽힌다.
    expect(line.submit?.unconfirmed).toBe(1);
    expect(line.submit?.lastUnconfirmedAgoMs).toBeGreaterThanOrEqual(30_000);
    expect(line.submit?.lastRefusal).toBe("composer-occupied");
    expect(line.hold?.composer).toBe("occupied");
  });

  it("제출 집계를 못 읽어도 표본은 뜬다", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () =>
        health({
          lastPollStartedAt: Date.now(),
          lastPollCompletedAt: Date.now(),
        }),
      getSubmitTally: () => {
        throw new Error("no pty");
      },
      filePath: journalFile(),
      logger: quietLogger,
    });
    const [line] = journal.sample("test");
    expect(line.submit).toBeNull();
    expect(line.verdict).toBe("idle-ok");
  });

  it("파일이 무한히 자라지 않는다 — 상한을 넘으면 최근 절반만 남는다", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () => health(),
      filePath: journalFile(),
      maxLines: 10,
      logger: quietLogger,
    });
    for (let i = 0; i < 12; i += 1) journal.sample(`s${i}`);
    const lines = readLines();
    expect(lines.length).toBeLessThanOrEqual(10);
    // 남은 것은 최근 것이다(가장 오래된 s0 는 밀려났다).
    expect(lines.some((l) => l.reason === "s0")).toBe(false);
    expect(lines[lines.length - 1].reason).toBe("s11");
  });

  it("파일에 쓸 수 없어도 앱을 흔들지 않는다", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () => health(),
      // 디렉터리를 파일 자리에 놓아 append 를 실패시킨다.
      filePath: tmpDir,
      logger: quietLogger,
    });
    expect(() => journal.sample("test")).not.toThrow();
    // 그래도 표본은 메모리에 남아 즉시 조회가 가능하다.
    expect(journal.recentSamples()).toHaveLength(1);
  });

  it("getRouteHealth 가 던져도 다른 프로젝트의 표본은 계속 뜬다", () => {
    const journal = new TelegramRouteJournal({
      listProjects: () => ["bad", "good"],
      getRouteHealth: (id) => {
        if (id === "bad") throw new Error("boom");
        return health({ projectId: id });
      },
      filePath: journalFile(),
      logger: quietLogger,
    });
    const samples = journal.sample("test");
    expect(samples.map((s) => s.projectId)).toEqual(["good"]);
  });

  it("주기 tick 의 지각(driftMs)이 기록된다 — 앱 단위 스로틀링의 유일한 관측점", async () => {
    let clock = 0;
    const journal = new TelegramRouteJournal({
      listProjects: () => [PROJECT],
      getRouteHealth: () => health(),
      filePath: journalFile(),
      sampleIntervalMs: 1_000,
      now: () => clock,
      logger: quietLogger,
    });
    // start() 가 기준 시각을 잡고 첫 표본을 뜬다(수동 표본이라 drift 는 0).
    journal.start();
    expect(journal.recentSamples()[0].driftMs).toBe(0);
    // 1초 간격 타이머가 실제로는 5초 만에 깨어난 상황.
    clock = 5_000;
    journal.sample("tick");
    journal.stop();
    const last = journal.recentSamples().pop() as RouteSample;
    expect(last.driftMs).toBe(4_000);
  });
});
