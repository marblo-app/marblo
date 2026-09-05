/**
 * 티켓 nMpBzIMJmkSFqrrZfSKz — **"텔레그램은 텔레그램대로 큐에 있다가 다시
 * 들어가도록"** (사장님, 2026-09-05).
 *
 * 이 파일은 사장님이 설계에 물으신 네 가지를 테스트로 고정한다.
 *
 *   1. 큐를 어디에 두는가        → 디스크. 오프셋과 분리된 별도 파일.
 *   2. 재시도 정책               → 지수 백오프 + 상한. ★포기는 없다.
 *   3. 앱이 재시작돼도 살아남나  → ★살아남는다. 이 파일이 그걸 증명한다.
 *   4. 큐 상태를 사람이 볼 수 있나 → snapshot(깊이·대기시간·시도횟수).
 *
 * 그리고 이 큐의 규율 — **사람의 말이다** — 을 못 박는다. 형제 티켓의 전진 신호
 * 큐는 중복 억제·합치기가 정책이지만, 여기서는 그 둘이 **금지**다. 사장님이 두
 * 문장을 보내셨으면 두 문장 다, 보내신 순서로 들어가야 한다.
 *
 * ★GUI 없음. 임시 디렉터리와 가짜 시계만 쓴다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramInboundQueue } from "../../electron/telegram-inbound-queue";

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const P = "proj1";

let tmpDir: string;
let now = 1_000_000;

function file(): string {
  return path.join(tmpDir, "inbound-queue.json");
}
function makeQueue(): TelegramInboundQueue {
  return new TelegramInboundQueue({
    filePath: file(),
    logger: quiet,
    now: () => now,
  });
}
function entry(updateId: number, text: string) {
  return {
    updateId,
    chatId: "-100123",
    from: "@boss",
    text,
    queuedAt: now,
  };
}

beforeEach(() => {
  tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "marblo-tg-queue-")),
  );
  now = 1_000_000;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("사람의 말 — 유실 불가 · 순서 유지 · 합치기 금지", () => {
  it("넣은 순서대로 맨 앞부터 나온다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(96862774, "첫 번째"));
    q.enqueue(P, entry(96862775, "두 번째"));
    q.enqueue(P, entry(96862776, "세 번째"));
    expect(q.depth(P)).toBe(3);
    expect(q.head(P)?.updateId).toBe(96862774);
    q.ack(P, 96862774);
    expect(q.head(P)?.updateId).toBe(96862775);
  });

  it("★늦게 도착한 낮은 update_id 도 제자리에 꽂힌다 — 순서의 원본은 우리다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(776, "세 번째"));
    q.enqueue(P, entry(774, "첫 번째"));
    q.enqueue(P, entry(775, "두 번째"));
    expect(q.head(P)?.text).toBe("첫 번째");
  });

  it("★같은 말을 두 번 하지 않는다 — 같은 update_id 재삽입은 무시된다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(774, "왜 조용해"));
    q.enqueue(P, entry(774, "왜 조용해"));
    expect(q.depth(P)).toBe(1);
  });

  it("★내용이 같아도 update_id 가 다르면 두 건이다 — 합치지 않는다", () => {
    // 형제 티켓의 전진 신호 큐라면 합쳐도 되지만, 여기서는 사장님이 같은 말을
    // 두 번 하신 것이고 두 번 다 들어가야 한다.
    const q = makeQueue();
    q.enqueue(P, entry(774, "왜 조용해"));
    q.enqueue(P, entry(775, "왜 조용해"));
    expect(q.depth(P)).toBe(2);
  });

  it("★실패해도 큐에서 빠지지 않는다 — 이 큐에 '포기' 는 없다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(774, "왜 조용해"));
    for (let i = 0; i < 500; i += 1) {
      q.deferHead(P, 1, "composer-occupied");
    }
    expect(q.depth(P)).toBe(1);
    expect(q.head(P)?.attempts).toBe(500);
  });
});

describe("★앱이 재시작돼도 살아남는다 (사장님 질문 3)", () => {
  it("사장님이 자리를 비우신 사이 온 메시지가 재시작 뒤에도 큐에 있다", () => {
    const first = makeQueue();
    first.enqueue(P, entry(96862774, "지금 상황 어때"));
    first.enqueue(P, entry(96862775, "그거 됐어?"));

    // 앱이 죽었다 살아난다 = 같은 파일로 새 인스턴스.
    const revived = makeQueue();
    expect(revived.depth(P)).toBe(2);
    expect(revived.head(P)?.text).toBe("지금 상황 어때");
    expect(revived.snapshot(P).headUpdateId).toBe(96862774);
  });

  it("★재시작 직후에는 백오프를 끌고 오지 않는다 — 꺼져 있던 시간이 이미 대기다", () => {
    const first = makeQueue();
    first.enqueue(P, entry(774, "왜 조용해"));
    first.deferHead(P, 60_000, "composer-occupied"); // 1분 뒤에 재시도 예약

    const revived = makeQueue();
    expect(revived.nextReady(P)?.updateId).toBe(774); // 즉시 시도 가능
  });

  it("파일이 깨져 있으면 빈 큐로 시작하고 던지지 않는다", () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), "{ this is not json", "utf-8");
    expect(() => makeQueue()).not.toThrow();
    expect(makeQueue().depth(P)).toBe(0);
  });

  it("★쓰기에 실패하면 enqueue 가 false 를 준다 — 호출부가 오프셋을 붙잡는 신호다", () => {
    // 파일 자리에 디렉터리를 놓아 쓰기를 실패시킨다.
    fs.mkdirSync(file(), { recursive: true });
    const q = makeQueue();
    expect(q.enqueue(P, entry(774, "왜 조용해"))).toBe(false);
    // ★메모리도 되돌아간다 — "넣었다고 믿는데 파일엔 없는" 상태를 남기지 않는다.
    expect(q.depth(P)).toBe(0);
  });
});

describe("★재시도 백오프 (사장님 질문 2)", () => {
  it("다음 시도 시각이 미뤄지고, 그 전에는 nextReady 가 안 준다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(774, "왜 조용해"));
    expect(q.nextReady(P)?.updateId).toBe(774);
    q.deferHead(P, 5_000, "composer-occupied");
    expect(q.nextReady(P)).toBeNull(); // 백오프 중
    now += 5_000;
    expect(q.nextReady(P)?.updateId).toBe(774); // 시각이 되면 다시 준다
  });

  it("시도 횟수와 마지막 사유가 쌓인다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(774, "왜 조용해"));
    q.deferHead(P, 1, "composer-occupied");
    q.deferHead(P, 1, "no-orchestrator");
    const head = q.head(P);
    expect(head?.attempts).toBe(2);
    expect(head?.lastError).toBe("no-orchestrator");
  });
});

describe("★큐 상태를 사람이 볼 수 있다 (사장님 질문 4)", () => {
  it("몇 건이 얼마나 기다렸고 몇 번 시도했는지 말한다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(774, "첫 번째"));
    q.enqueue(P, entry(775, "두 번째"));
    now += 90_000;
    q.deferHead(P, 1, "composer-occupied");

    const snap = q.snapshot(P);
    expect(snap.depth).toBe(2);
    expect(snap.headUpdateId).toBe(774);
    expect(snap.headWaitingMs).toBe(90_000);
    expect(snap.headAttempts).toBe(1);
    expect(snap.headLastError).toBe("composer-occupied");
  });

  it("비어 있으면 깊이 0 이고 머리가 없다", () => {
    expect(makeQueue().snapshot(P)).toMatchObject({
      depth: 0,
      headUpdateId: null,
      headWaitingMs: null,
    });
  });

  it("프로젝트끼리 섞이지 않는다", () => {
    const q = makeQueue();
    q.enqueue(P, entry(1, "a"));
    q.enqueue("proj2", entry(2, "b"));
    expect(q.depth(P)).toBe(1);
    expect(q.depth("proj2")).toBe(1);
    expect(q.projectsWithWork().sort()).toEqual([P, "proj2"]);
  });
});
